import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillStatus,
  OrderItemStatus,
  OrderStatus,
  Payment,
  Prisma,
  TableSessionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EventsService } from '../realtime/events.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money, round2 } from '../common/utils/money';
import { OPEN_ORDER, PAYABLE } from '../common/utils/order-status';
import { RateLimiter } from '../common/utils/rate-limiter';
import { serializeItem, serializeOrder } from '../common/utils/serialize-order';
import { calcTotals, fmtVnd } from '../common/utils/totals';
import {
  normalizeOfferCode,
  offerDiscountAmount,
  offerMinReason,
  offerUnavailableReason,
} from '../offers/offer-rules';
import { PrintService } from '../printers/print.service';
import { PayOrderDto } from '../orders/dto/order.dto';
import {
  AddBillDiscountDto,
  BillListQueryDto,
  ItemLineDto,
  PayBillDto,
  SplitPreviewDto,
} from './dto/bill.dto';
import {
  BILL_OPEN,
  ensureBillTx,
  lockBillRow,
  movedFromForTable,
  lockTables,
  recalcBill,
  releaseRedemptions,
  sessionTableIds,
  settleBillTx,
  Tx,
  UNSERVED_ITEM,
} from './bill-core';

const MANAGER_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];

/** Han muc giam gia mac dinh cua thu ngan (PO chua chot, Q3): 10% tam tinh va 100.000d */
const DEFAULT_CASHIER_MAX_PERCENT = 10;
const DEFAULT_CASHIER_MAX_AMOUNT = 100000;

/** Nhap sai mat khau quan ly nhieu lan: toi da 10 lan / 5 phut cho moi nguoi goi (chong do mat khau) */
const approverLimiter = new RateLimiter(10, 5 * 60_000);

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tien mat',
  TRANSFER: 'Chuyen khoan',
  QR_BANK: 'Quet ma QR',
  CARD: 'The',
  WALLET: 'Vi dien tu',
};

const itemInclude = {
  items: { include: { options: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  table: { select: { id: true, code: true, name: true } },
} satisfies Prisma.OrderInclude;

/** Loi 409 kem ma de frontend nhan dien (ngoai `message`) */
function conflict(message: string, code: string, extra: Record<string, unknown> = {}) {
  return new ConflictException({ statusCode: 409, message, error: 'Conflict', code, ...extra });
}

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly print: PrintService,
  ) {}

  // ================= DOC: PHIEN BAN + HOA DON =================

  /** Phien dang mo cua ban + hoa don/tam tinh (POS). Khong co phien thi session = null. */
  async tableSession(user: JwtUser, storeId: string, tableId: string) {
    assertStoreAccess(user, storeId);
    const table = await this.prisma.table.findFirst({ where: { id: tableId, storeId } });
    if (!table) throw new NotFoundException('Bàn không tồn tại');
    const seat = await this.prisma.tableSessionTable.findFirst({
      where: { tableId, leftAt: null, session: { storeId, status: TableSessionStatus.OPEN } },
      select: { sessionId: true },
    });
    if (!seat) {
      return {
        session: null,
        tables: [],
        orders: [],
        bill: null,
        preview: null,
        unservedItems: 0,
      };
    }
    return this.sessionView(storeId, seat.sessionId);
  }

  async getBill(user: JwtUser, storeId: string, billId: string) {
    assertStoreAccess(user, storeId);
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
    return this.sessionView(storeId, bill.sessionId);
  }

  async listBills(user: JwtUser, storeId: string, q: BillListQueryDto) {
    assertStoreAccess(user, storeId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.BillWhereInput = { storeId };
    if (q.status) where.status = q.status as BillStatus;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          session: {
            select: {
              id: true,
              status: true,
              tables: { select: { table: { select: { code: true } } } },
            },
          },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      data: rows.map((b) => ({
        ...this.billDto(b),
        sessionId: b.sessionId,
        tableCodes: Array.from(new Set(b.session.tables.map((t) => t.table.code))),
      })),
    };
  }

  /** Tao hoac lay hoa don cua phien (idempotent) */
  async ensureBill(user: JwtUser, storeId: string, sessionId: string) {
    assertStoreAccess(user, storeId);
    const session = await this.prisma.tableSession.findFirst({ where: { id: sessionId, storeId } });
    if (!session) throw new NotFoundException('Phiên bàn không tồn tại');
    if (session.status !== TableSessionStatus.OPEN) {
      const b = await this.prisma.bill.findUnique({ where: { sessionId } });
      if (!b) throw new ConflictException('Phiên bàn đã kết thúc');
      return this.sessionView(storeId, sessionId);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await lockTables(tx, await sessionTableIds(tx, sessionId));
      const cur = await tx.tableSession.findUnique({ where: { id: sessionId } });
      if (cur?.status !== TableSessionStatus.OPEN) throw conflict('Phiên bàn vừa thay đổi, vui lòng tải lại', 'SESSION_CHANGED');
      const open = await tx.order.count({ where: { sessionId, status: { in: OPEN_ORDER } } });
      if (open === 0) throw new BadRequestException('Phiên bàn chưa có đơn nào để lập hóa đơn');
      const existed = await tx.bill.findUnique({ where: { sessionId }, select: { id: true } });
      const bill = await ensureBillTx(tx, storeId, sessionId);
      return { bill, isNew: !existed };
    });
    if (created.isNew) {
      await this.audit.log({
        action: 'bill_create',
        entityType: 'Bill',
        entityId: created.bill.id,
        storeId,
        userId: user.id,
        afterData: { billNo: created.bill.billNo, sessionId },
      });
    }
    return this.sessionView(storeId, sessionId);
  }

  // ================= GIAM GIA CAP BAN =================

  async addDiscount(user: JwtUser, storeId: string, billId: string, dto: AddBillDiscountDto) {
    assertStoreAccess(user, storeId);
    if (dto.type === 'PERCENT' && dto.value > 100) {
      throw new BadRequestException('Giảm giá theo phần trăm tối đa 100%');
    }
    if (dto.type === 'AMOUNT' && !Number.isInteger(dto.value)) {
      throw new BadRequestException('Số tiền giảm giá phải là số nguyên đồng');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Vui lòng nhập lý do giảm giá');

    const result = await this.prisma.$transaction(async (tx) => {
      const bill = await this.lockOpenBill(tx, storeId, billId);
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== bill.version) {
        throw conflict('Hóa đơn đã thay đổi, vui lòng tải lại', 'BILL_CHANGED', { version: bill.version });
      }
      const subtotal = money(bill.subtotal);
      // Giam theo %: lam tron half-up ve dong nguyen (vd 0,5% cua 90.000 = 450); giam theo so tien da la so nguyen
      const amount = dto.type === 'PERCENT' ? Math.round((subtotal * dto.value) / 100) : dto.value;
      const newTotalDiscount = round2(money(bill.discountAmount) + amount);
      if (newTotalDiscount > subtotal) {
        throw new BadRequestException(
          `Giảm giá (${fmtVnd(newTotalDiscount)}) không được vượt quá tạm tính (${fmtVnd(subtotal)})`,
        );
      }

      // Han muc theo vai tro: thu ngan bi gioi han tren TONG giam gia cua bill; quan ly/chu quan khong gioi han
      let approvedBy: string | null = null;
      if (!MANAGER_ROLES.includes(user.role)) {
        const limits = await this.discountLimits(tx, storeId);
        const overPercent =
          limits.maxPercent !== null && subtotal > 0 && (newTotalDiscount / subtotal) * 100 > limits.maxPercent;
        const overAmount = limits.maxAmount !== null && newTotalDiscount > limits.maxAmount;
        if (overPercent || overAmount) {
          if (!dto.approver) {
            throw new ForbiddenException({
              statusCode: 403,
              message: 'Giảm giá vượt hạn mức, cần quản lý duyệt',
              error: 'Forbidden',
              code: 'NEED_APPROVAL',
              limits: { cashierMaxPercent: limits.maxPercent, cashierMaxAmount: limits.maxAmount },
            });
          }
          approvedBy = await this.verifyApprover(tx, storeId, user.id, dto.approver);
        }
      }

      const discount = await tx.billDiscount.create({
        data: {
          billId,
          kind: 'MANUAL',
          amount,
          percent: dto.type === 'PERCENT' ? dto.value : null,
          reason,
          createdByUserId: user.id,
          approvedByUserId: approvedBy,
        },
      });
      const after = await recalcBill(tx, billId);
      if (money(after.totalAmount) < money(after.paidAmount)) {
        throw conflict(
          `Giảm giá làm tổng (${fmtVnd(money(after.totalAmount))}) thấp hơn số đã thu (${fmtVnd(money(after.paidAmount))})`,
          'BELOW_PAID',
        );
      }
      return { before: bill, after, discount, approvedBy };
    });

    await this.audit.log({
      action: 'bill_discount_add',
      entityType: 'Bill',
      entityId: billId,
      storeId,
      userId: user.id,
      beforeData: { discountAmount: money(result.before.discountAmount), totalAmount: money(result.before.totalAmount) },
      afterData: {
        discountId: result.discount.id,
        type: dto.type,
        value: dto.value,
        amount: money(result.discount.amount),
        reason,
        approvedByUserId: result.approvedBy,
        discountAmount: money(result.after.discountAmount),
        totalAmount: money(result.after.totalAmount),
      },
    });
    return this.sessionView(storeId, result.after.sessionId);
  }

  async removeDiscount(user: JwtUser, storeId: string, billId: string, discountId: string) {
    assertStoreAccess(user, storeId);
    const result = await this.prisma.$transaction(async (tx) => {
      const bill = await this.lockOpenBill(tx, storeId, billId);
      const d = await tx.billDiscount.findFirst({ where: { id: discountId, billId } });
      if (!d) throw new NotFoundException('Khoản giảm giá không tồn tại');
      if (money(bill.paidAmount) > 0) {
        throw conflict('Hóa đơn đã thu tiền, không thể gỡ giảm giá', 'BILL_HAS_PAYMENT');
      }
      if (!MANAGER_ROLES.includes(user.role) && d.createdByUserId !== user.id) {
        throw new ForbiddenException('Chỉ người tạo hoặc quản lý mới được gỡ giảm giá');
      }
      await tx.billDiscount.delete({ where: { id: discountId } });
      if (d.offerId) await releaseRedemptions(tx, billId, { onlyOfferId: d.offerId });
      const after = await recalcBill(tx, billId);
      return { before: bill, after, d };
    });
    await this.audit.log({
      action: 'bill_discount_remove',
      entityType: 'Bill',
      entityId: billId,
      storeId,
      userId: user.id,
      beforeData: {
        discountId,
        amount: money(result.d.amount),
        reason: result.d.reason,
        totalAmount: money(result.before.totalAmount),
      },
      afterData: { totalAmount: money(result.after.totalAmount) },
    });
    return this.sessionView(storeId, result.after.sessionId);
  }

  // ================= XEM TRUOC CHIA BILL =================

  async splitPreview(user: JwtUser, storeId: string, billId: string, dto: SplitPreviewDto) {
    assertStoreAccess(user, storeId);
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
    if (!BILL_OPEN.includes(bill.status)) {
      throw conflict('Hóa đơn đã đóng, không thể chia', 'BILL_CLOSED');
    }
    const remaining = round2(money(bill.totalAmount) - money(bill.paidAmount));

    if (dto.mode === 'EVEN') {
      if (!dto.parts) throw new BadRequestException('Chia đều cần số phần (parts)');
      return {
        mode: 'EVEN',
        billVersion: bill.version,
        remaining,
        parts: dto.parts,
        amounts: splitEven(remaining, dto.parts),
      };
    }

    if (!dto.groups?.length) throw new BadRequestException('Chia theo món cần danh sách nhóm (groups)');
    const calc = await this.computeItemGroups(
      this.prisma,
      bill,
      dto.groups.map((g) => ({ label: g.label, lines: g.lines })),
      false,
    );
    return {
      mode: 'ITEMS',
      billVersion: bill.version,
      remaining,
      groups: calc.groups.map((g) => ({ label: g.label ?? null, amount: g.amount, lines: g.lines })),
      allAssigned: calc.allAssigned,
      unassigned: calc.unassigned,
    };
  }

  // ================= THANH TOAN HOA DON =================

  async pay(user: JwtUser, storeId: string, billId: string, dto: PayBillDto) {
    assertStoreAccess(user, storeId);
    const bill0 = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill0) throw new NotFoundException('Hóa đơn không tồn tại');

    const key = dto.idempotencyKey.trim();
    let r: PayTxResult;
    try {
      r = await this.prisma.$transaction(
        async (tx) => {
          await lockTables(tx, await sessionTableIds(tx, bill0.sessionId));
          await lockBillRow(tx, billId);
          // Gui lai cung khoa -> tra Payment cu (kiem tra SAU khi co khoa de thang dua da commit xong)
          const prior = await tx.payment.findUnique({
            where: { storeId_idempotencyKey: { storeId, idempotencyKey: key } },
          });
          if (prior) {
            if (prior.billId !== billId) {
              throw conflict('Khóa idempotencyKey đã được dùng cho giao dịch khác', 'IDEMPOTENCY_KEY_REUSED');
            }
            return { replayed: true, payment: prior, tables: [], settled: false } as PayTxResult;
          }
          const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
          if (!BILL_OPEN.includes(bill.status)) {
            throw conflict(
              bill.status === BillStatus.PAID ? 'Hóa đơn đã được thanh toán đủ' : `Hóa đơn ${bill.status} không thể thanh toán`,
              'BILL_CLOSED',
            );
          }
          const fresh = await recalcBill(tx, billId);
          if (dto.expectedVersion !== undefined && dto.expectedVersion !== fresh.version) {
            throw conflict('Hóa đơn đã thay đổi, vui lòng tải lại', 'BILL_CHANGED', { version: fresh.version });
          }
          return this.applyPaymentTx(tx, fresh, user, {
            method: dto.method,
            amount: dto.amount,
            cashReceived: dto.cashReceived,
            payerLabel: dto.payerLabel,
            allocation: dto.allocation,
            idempotencyKey: key,
            confirmUnserved: dto.confirmUnserved === true,
          });
        },
        { timeout: 15000 },
      );
    } catch (e) {
      // 2 yeu cau cung khoa dong thoi: nguoi thua nhan lai Payment cua nguoi thang
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const prior = await this.prisma.payment.findUnique({
          where: { storeId_idempotencyKey: { storeId, idempotencyKey: key } },
        });
        if (prior && prior.billId === billId) {
          r = { replayed: true, payment: prior, tables: [], settled: false };
        } else throw e;
      } else throw e;
    }

    if (!r.replayed) {
      await this.audit.log({
        action: 'bill_payment',
        entityType: 'Payment',
        entityId: r.payment.id,
        storeId,
        userId: user.id,
        afterData: {
          billId,
          billNo: bill0.billNo,
          method: r.payment.method,
          amount: money(r.payment.amount),
          settled: r.settled,
        },
      });
      if (r.settled) await this.afterSettled(storeId, billId, r.payment, r.orderIds ?? []);
    }

    const view = await this.sessionView(storeId, bill0.sessionId);
    const remaining = view.bill ? view.bill.remaining : 0;
    const cash = r.payment.cashReceived !== null ? money(r.payment.cashReceived) : null;
    return {
      replayed: r.replayed,
      bill: view.bill,
      payment: this.paymentDto(r.payment),
      remaining,
      change: r.payment.method === 'CASH' && cash !== null ? Math.max(0, round2(cash - money(r.payment.amount))) : null,
      tablesStatus: r.replayed ? await this.tablesStatus(bill0.sessionId) : r.tables,
    };
  }

  /**
   * Duong cu `POST pos/orders/:id/payment` cho don THUOC PHIEN: chay qua co che bill.
   * Phien chi co dung 1 don mo -> thanh toan du bill (giam gia = khoan giam cap ban, co han muc);
   * nhieu don -> 409 yeu cau thanh toan theo ban.
   */
  async payLegacyOrder(
    user: JwtUser,
    storeId: string,
    orderId: string,
    sessionId: string,
    dto: PayOrderDto,
  ) {
    const r = await this.prisma.$transaction(
      async (tx) => {
        await lockTables(tx, await sessionTableIds(tx, sessionId));
        const order = await tx.order.findFirst({ where: { id: orderId, storeId } });
        if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
        if (!PAYABLE.includes(order.status)) {
          throw new ConflictException(`Đơn ${order.status} không thể thanh toán`);
        }
        const open = await tx.order.count({ where: { sessionId, status: { in: PAYABLE } } });
        if (open > 1) {
          throw conflict('Bàn có nhiều đơn, vui lòng thanh toán theo bàn', 'TABLE_HAS_MULTIPLE_ORDERS', {
            orderCount: open,
          });
        }
        const active = await tx.orderItem.count({
          where: { orderId, status: { not: OrderItemStatus.CANCELLED } },
        });
        if (active === 0) throw new BadRequestException('Đơn không còn món nào để thanh toán');

        let bill = await ensureBillTx(tx, storeId, sessionId);
        await lockBillRow(tx, bill.id);
        bill = await recalcBill(tx, bill.id);
        const subtotal = money(bill.subtotal);

        // Giam gia truyen kem (cach cu): ghi thanh khoan giam cap ban, ap han muc nhu API moi
        const extra = dto.discountAmount ?? 0;
        if (extra > 0) {
          const newTotal = round2(money(bill.discountAmount) + extra);
          if (newTotal > subtotal) {
            throw new BadRequestException(
              `Giảm giá (${fmtVnd(newTotal)}) không được vượt quá tạm tính (${fmtVnd(subtotal)})`,
            );
          }
          if (!MANAGER_ROLES.includes(user.role)) {
            const limits = await this.discountLimits(tx, storeId);
            const over =
              (limits.maxPercent !== null && subtotal > 0 && (newTotal / subtotal) * 100 > limits.maxPercent) ||
              (limits.maxAmount !== null && newTotal > limits.maxAmount);
            if (over) {
              throw new ForbiddenException({
                statusCode: 403,
                message: 'Giảm giá vượt hạn mức, cần quản lý duyệt',
                error: 'Forbidden',
                code: 'NEED_APPROVAL',
              });
            }
          }
          await tx.billDiscount.create({
            data: {
              billId: bill.id,
              kind: 'MANUAL',
              amount: extra,
              reason: 'Giảm giá khi thanh toán đơn (API cũ)',
              createdByUserId: user.id,
            },
          });
          bill = await recalcBill(tx, bill.id);
        }

        const total = money(bill.totalAmount);
        const remaining = round2(total - money(bill.paidAmount));
        if (dto.method === 'CASH' && dto.cashReceived !== undefined && dto.cashReceived < remaining) {
          throw new BadRequestException(
            `Tiền khách đưa (${fmtVnd(dto.cashReceived)}) chưa đủ tổng cần thu (${fmtVnd(remaining)})`,
          );
        }
        const res = await this.applyPaymentTx(tx, bill, user, {
          method: dto.method,
          cashReceived: dto.method === 'CASH' ? dto.cashReceived : undefined,
          idempotencyKey: undefined,
          confirmUnserved: true,
        });
        const updatedOrder = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } }, table: true },
        });
        return { ...res, order: updatedOrder, billId: bill.id };
      },
      { timeout: 15000 },
    );

    await this.audit.log({
      action: 'payment',
      entityType: 'Payment',
      entityId: r.payment.id,
      storeId,
      userId: user.id,
      afterData: {
        orderId,
        orderNumber: r.order.orderNumber,
        billId: r.billId,
        method: dto.method,
        discount: dto.discountAmount ?? 0,
        total: money(r.order.totalAmount),
      },
    });
    if (r.settled) await this.afterSettled(storeId, r.billId, r.payment, r.orderIds ?? []);

    return {
      payment: this.paymentDto(r.payment),
      order: serializeOrder(r.order),
      table: {
        id: r.order.table.id,
        code: r.order.table.code,
        status: r.tables.find((t) => t.id === r.order.tableId)?.status ?? r.order.table.status,
      },
      change:
        dto.method === 'CASH' && dto.cashReceived !== undefined
          ? Math.max(0, round2(dto.cashReceived - money(r.payment.amount)))
          : null,
    };
  }

  // ================= IN BILL / TAM TINH =================

  /** In tam tinh (PRE_BILL) hoac bill (BILL, chi khi da thanh toan) tu hoa don ban */
  async printBill(user: JwtUser, storeId: string, billId: string, kind: 'PRE_BILL' | 'BILL') {
    assertStoreAccess(user, storeId);
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
    if (kind === 'PRE_BILL' && !BILL_OPEN.includes(bill.status)) {
      throw conflict('Hóa đơn đã đóng, không in tạm tính', 'BILL_CLOSED');
    }
    if (kind === 'BILL' && bill.status !== BillStatus.PAID) {
      throw conflict('Chỉ in bill khi hóa đơn đã thanh toán đủ (hãy dùng tạm tính)', 'BILL_NOT_PAID');
    }
    const prior = await this.prisma.printJob.count({
      where: { storeId, billId, jobType: kind === 'BILL' ? { in: ['BILL', 'REPRINT'] } : 'PRE_BILL' },
    });
    const r = await this.print.enqueueBill(storeId, billId, {
      pre: kind === 'PRE_BILL',
      reprintCount: kind === 'BILL' ? Math.max(1, prior) : undefined,
      cashier: user.name,
    });
    await this.audit.log({
      action: kind === 'BILL' ? 'reprint' : 'print_pre_bill',
      entityType: 'Bill',
      entityId: billId,
      storeId,
      userId: user.id,
      afterData: { kind },
    });
    const job = await this.prisma.printJob.findFirst({
      where: { storeId, billId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, failedReason: true },
    });
    return {
      queued: r.queued,
      mode: r.reason === 'KDS_ONLY' ? 'KDS_ONLY' : 'AGENT',
      jobId: job?.id ?? null,
      status: job?.status ?? null,
      failedReason: job?.failedReason ?? (r.reason === 'KDS_ONLY' ? null : (r.reason ?? null)),
    };
  }

  // ================= THANH TOAN QR / GIAO DICH NGAN HANG =================

  /**
   * Diem DUY NHAT ghi nhan tien QR vao hoa don (thu ngan xac nhan tay, giao dich ngan hang tu khop, gan thu cong).
   * Khong nem loi khi hoa don da dong: tra ve ket qua de ben goi phan loai (DUPLICATE_PAYMENT / LATE_CLOSED).
   * Chong dong thoi: khoa ban + khoa hoa don, idempotent theo idempotencyKey.
   */
  async confirmQrPayment(a: {
    storeId: string;
    billId: string;
    amount: number;
    confirmedBy: 'CASHIER' | 'BANK_FEED';
    actorId: string | null;
    idempotencyKey: string;
    intentId?: string;
    bankTransactionId?: string;
    /** Thieu tien: khong ghi nhan (de giao dich vao hang cho xu ly) */
    rejectPartial?: boolean;
    method?: 'QR_BANK' | 'TRANSFER';
  }): Promise<QrApplyResult> {
    const bill0 = await this.prisma.bill.findFirst({ where: { id: a.billId, storeId: a.storeId } });
    if (!bill0) return { kind: 'BILL_NOT_FOUND' };
    const r = await this.prisma.$transaction(
      async (tx): Promise<QrApplyResult> => {
        await lockTables(tx, await sessionTableIds(tx, bill0.sessionId));
        await lockBillRow(tx, a.billId);
        const prior = await tx.payment.findUnique({
          where: { storeId_idempotencyKey: { storeId: a.storeId, idempotencyKey: a.idempotencyKey } },
        });
        if (prior) {
          return { kind: 'APPLIED', replayed: true, payment: prior, applied: money(prior.amount), excess: 0, remainingBefore: 0, settled: false, orderIds: [] };
        }
        const cur = await tx.bill.findUniqueOrThrow({ where: { id: a.billId } });
        if (cur.status === BillStatus.VOID || cur.status === BillStatus.REFUNDED) return { kind: 'BILL_CLOSED' };
        if (cur.status === BillStatus.PAID) return { kind: 'BILL_PAID' };
        const bill = await recalcBill(tx, a.billId);
        const remaining = round2(money(bill.totalAmount) - money(bill.paidAmount));
        if (remaining <= 0 && money(bill.totalAmount) > 0) return { kind: 'BILL_PAID' };
        if (a.amount < remaining && a.rejectPartial) return { kind: 'PARTIAL_REJECTED', remaining };
        const applied = Math.min(a.amount, remaining);
        const excess = round2(a.amount - applied);
        const res = await this.applyPaymentTx(tx, bill, { id: a.actorId }, {
          method: a.method ?? 'QR_BANK',
          amount: applied,
          idempotencyKey: a.idempotencyKey,
          intentId: a.intentId,
          bankTransactionId: a.bankTransactionId,
          confirmedBy: a.confirmedBy,
          confirmUnserved: true,
        });
        const now = new Date();
        if (a.intentId) {
          const it = await tx.paymentIntent.findUnique({ where: { id: a.intentId } });
          if (it) {
            const paidAmount = round2(money(it.paidAmount) + applied);
            const full = paidAmount >= money(it.amount);
            await tx.paymentIntent.update({
              where: { id: it.id },
              data: {
                paidAmount,
                status: full ? 'PAID' : 'PARTIALLY_PAID',
                paidAt: full ? now : null,
              },
            });
          }
        }
        if (a.bankTransactionId) {
          await tx.bankTransaction.update({
            where: { id: a.bankTransactionId },
            data: {
              status: excess > 0 ? 'OVERPAID' : applied < remaining ? 'PARTIAL' : 'MATCHED',
              billId: a.billId,
              intentId: a.intentId ?? null,
              appliedAmount: applied,
              excessAmount: excess,
              ...(a.confirmedBy === 'CASHIER' ? { resolvedByUserId: a.actorId, resolvedAt: now } : {}),
            },
          });
        }
        return {
          kind: 'APPLIED',
          replayed: false,
          payment: res.payment,
          applied,
          excess,
          remainingBefore: remaining,
          settled: res.settled,
          orderIds: res.orderIds ?? [],
        };
      },
      { timeout: 15000 },
    );
    if (r.kind === 'APPLIED' && !r.replayed) {
      await this.audit.log({
        action: a.confirmedBy === 'CASHIER' ? 'qr_manual_confirm' : 'bank_txn_matched',
        entityType: 'Payment',
        entityId: r.payment.id,
        storeId: a.storeId,
        userId: a.actorId ?? undefined,
        afterData: {
          billId: a.billId,
          amount: r.applied,
          excess: r.excess,
          intentId: a.intentId ?? null,
          bankTransactionId: a.bankTransactionId ?? null,
          actor: a.actorId ? 'user' : 'system',
          settled: r.settled,
        },
      });
      if (r.settled) await this.afterSettled(a.storeId, a.billId, r.payment, r.orderIds);
    }
    return r;
  }

  // ================= UU DAI (MOC A) =================

  /** Kiem tra uu dai cho hoa don (khong co tac dung phu): dung chung cho kiem mem va ap dung that */
  private async evaluateOffer(
    tx: Tx,
    storeId: string,
    bill: { id: string; subtotal: unknown; discountAmount: unknown },
    codeRaw: string,
  ) {
    const code = normalizeOfferCode(codeRaw ?? '');
    const offer = code ? await tx.offer.findUnique({ where: { storeId_code: { storeId, code } } }) : null;
    if (!offer) return { offer: null, code, error: 'Mã ưu đãi không tồn tại' as string | null };
    const unavailable = offerUnavailableReason(offer);
    if (unavailable) return { offer, code, error: unavailable };
    const existing = await tx.billDiscount.findMany({ where: { billId: bill.id } });
    if (existing.some((d) => d.offerId === offer.id)) {
      return { offer, code, error: 'Ưu đãi này đã được áp dụng trên hóa đơn' };
    }
    if (existing.some((d) => d.offerId)) {
      return { offer, code, error: 'Mỗi hóa đơn chỉ áp dụng một ưu đãi' };
    }
    const subtotal = money(bill.subtotal);
    const minReason = offerMinReason(offer, subtotal);
    const manual = existing.filter((d) => !d.offerId && money(d.amount) > 0);
    const room = round2(subtotal - money(bill.discountAmount));
    const amount = Math.min(offerDiscountAmount(offer, subtotal), room);
    return { offer, code, error: null, minReason, hasManual: manual.length > 0, amount };
  }

  /** Xem truoc ap ma len hoa don (POS): khong tru gi ca */
  async checkOffer(user: JwtUser, storeId: string, billId: string, code: string) {
    assertStoreAccess(user, storeId);
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
    if (!BILL_OPEN.includes(bill.status)) return { valid: false, message: 'Hóa đơn đã đóng' };
    const ev = await this.evaluateOffer(this.prisma, storeId, bill, code);
    if (ev.error) return { valid: false, message: ev.error };
    if (ev.minReason) {
      return { valid: false, message: ev.minReason, canOverride: true, offerId: ev.offer!.id };
    }
    if (!ev.amount || ev.amount <= 0) return { valid: false, message: 'Ưu đãi không tạo ra khoản giảm cho hóa đơn này' };
    return {
      valid: true,
      offerId: ev.offer!.id,
      amount: ev.amount,
      needsApproval: !!ev.hasManual && !ev.offer!.stackable && !MANAGER_ROLES.includes(user.role),
    };
  }

  /** Ap ma uu dai cho hoa don: BillDiscount kind VOUCHER + luot RESERVED (thanh CONSUMED khi hoa don dong) */
  async applyOffer(
    user: JwtUser,
    storeId: string,
    billId: string,
    dto: {
      code: string;
      override?: boolean;
      reason?: string;
      approver?: { userId?: string; email?: string; password: string };
    },
  ) {
    assertStoreAccess(user, storeId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const bill = await this.lockOpenBill(tx, storeId, billId);
        const ev = await this.evaluateOffer(tx, storeId, bill, dto.code);
        if (ev.error || !ev.offer) {
          throw ev.error === 'Mã ưu đãi không tồn tại'
            ? new NotFoundException(ev.error)
            : conflict(ev.error ?? 'Ưu đãi không hợp lệ', 'OFFER_INVALID');
        }
        const offer = ev.offer;
        if (!offer.cashierCanApply && !MANAGER_ROLES.includes(user.role)) {
          throw new ForbiddenException('Ưu đãi này chỉ quản lý được áp dụng');
        }
        let approvedBy: string | null = null;
        let overrideReason: string | null = null;
        const isManager = MANAGER_ROLES.includes(user.role);
        const needApproval = async (message: string) => {
          if (isManager) return;
          if (!dto.approver) {
            throw new ForbiddenException({ statusCode: 403, message, error: 'Forbidden', code: 'NEED_APPROVAL' });
          }
          approvedBy = await this.verifyApprover(tx, storeId, user.id, dto.approver);
        };
        // Don chua dat toi thieu: chi ngoai le co ly do + quan ly duyet
        if (ev.minReason) {
          if (!dto.override) {
            throw new BadRequestException({ statusCode: 400, message: ev.minReason, error: 'Bad Request', code: 'MIN_SUBTOTAL', canOverride: true });
          }
          const why = dto.reason?.trim();
          if (!why) throw new BadRequestException('Vui lòng nhập lý do áp dụng ngoại lệ');
          await needApproval('Áp dụng ngoại lệ cần quản lý duyệt');
          overrideReason = why;
        }
        // Khong cong don voi giam gia tay tru khi quan ly duyet
        if (ev.hasManual && !offer.stackable && !approvedBy) {
          await needApproval('Hóa đơn đã có giảm giá tay, cộng thêm ưu đãi cần quản lý duyệt');
        }
        const amount = ev.amount ?? 0;
        if (amount <= 0) throw new BadRequestException('Ưu đãi không tạo ra khoản giảm cho hóa đơn này');

        // Han muc luot dung: tang nguyen tu (nguoi sau thua cuoc dua nhan loi)
        const inc = await tx.offer.updateMany({
          where: {
            id: offer.id,
            active: true,
            ...(offer.totalLimit !== null ? { usedCount: { lt: offer.totalLimit } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (inc.count !== 1) throw conflict('Ưu đãi đã hết lượt sử dụng', 'OFFER_EXHAUSTED');

        const disc = await tx.billDiscount.create({
          data: {
            billId,
            kind: 'VOUCHER',
            amount,
            reason: `Ưu đãi ${offer.code}`,
            offerId: offer.id,
            createdByUserId: user.id,
            approvedByUserId: approvedBy,
          },
        });
        const prior = await tx.offerRedemption.findUnique({
          where: { offerId_billId: { offerId: offer.id, billId } },
        });
        if (prior && prior.status !== 'RELEASED') throw conflict('Ưu đãi này đã được áp dụng trên hóa đơn', 'OFFER_INVALID');
        const redData = {
          storeId,
          offerId: offer.id,
          billId,
          discountId: disc.id,
          amount,
          status: 'RESERVED' as const,
          appliedByUserId: user.id,
          overrideReason,
          approvedByUserId: approvedBy,
          consumedAt: null,
          releasedAt: null,
        };
        if (prior) await tx.offerRedemption.update({ where: { id: prior.id }, data: redData });
        else await tx.offerRedemption.create({ data: redData });

        const after = await recalcBill(tx, billId);
        if (money(after.totalAmount) < money(after.paidAmount)) {
          throw conflict('Ưu đãi làm tổng thấp hơn số đã thu', 'BELOW_PAID');
        }
        return { after, offer, amount, approvedBy, overrideReason };
      },
      { timeout: 15000 },
    );
    await this.audit.log({
      action: 'offer_apply',
      entityType: 'Bill',
      entityId: billId,
      storeId,
      userId: user.id,
      afterData: {
        offerId: result.offer.id,
        code: result.offer.code,
        amount: result.amount,
        override: result.overrideReason,
        approvedByUserId: result.approvedBy,
        totalAmount: money(result.after.totalAmount),
      },
    });
    return this.sessionView(storeId, result.after.sessionId);
  }

  // ================= HOAN TIEN =================

  async refund(
    user: JwtUser,
    storeId: string,
    billId: string,
    dto: { reason: string; note?: string },
  ) {
    assertStoreAccess(user, storeId);
    const bill0 = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill0) throw new NotFoundException('Hóa đơn không tồn tại');

    const result = await this.prisma.$transaction(async (tx) => {
      await lockBillRow(tx, billId);
      const now = new Date();
      // Chong hoan 2 lan dong thoi: chi 1 yeu cau chuyen duoc bill PAID -> REFUNDED
      const claimed = await tx.bill.updateMany({
        where: { id: billId, storeId, status: BillStatus.PAID },
        data: { status: BillStatus.REFUNDED, refundedAt: now },
      });
      if (claimed.count !== 1) {
        const cur = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
        throw conflict(
          `Chỉ hóa đơn đã thanh toán mới được hoàn tiền (hiện tại: ${cur.status})`,
          'BILL_NOT_REFUNDABLE',
        );
      }
      const orders = await tx.order.findMany({
        where: { sessionId: bill0.sessionId, status: OrderStatus.COMPLETED },
        include: { table: { select: { code: true, name: true } } },
      });
      const upd = await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, status: OrderStatus.COMPLETED },
        data: { status: OrderStatus.REFUNDED },
      });
      if (upd.count !== orders.length) {
        throw conflict('Có đơn vừa đổi trạng thái, vui lòng thử lại', 'ORDER_CHANGED');
      }

      // Hoan theo dung phuong thuc goc cua tung lan thu (khong gop thanh tien mat)
      const payments = await tx.payment.findMany({
        where: { billId, status: 'COMPLETED' },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      });
      const refunds = [];
      let i = 0;
      for (const p of payments) {
        i++;
        const already = await tx.payment.count({ where: { refundOfPaymentId: p.id } });
        if (already > 0) continue;
        refunds.push(
          await tx.payment.create({
            data: {
              storeId,
              billId,
              orderId: null,
              amount: p.amount,
              method: p.method,
              status: 'REFUNDED',
              paidAt: now,
              cashierId: user.id,
              receiptNo: `RF-${bill0.billNo}-${i}`,
              refundOfPaymentId: p.id,
              payerLabel: p.payerLabel,
              // Tien khong phai tien mat: quan ly can chuyen tra thu cong cho khach
              ...(p.method !== 'CASH'
                ? { refundStatus: 'PENDING_TRANSFER', refundNote: 'Cần chuyển trả thủ công cho khách' }
                : {}),
            },
          }),
        );
      }

      // Hoan hoa don: tra lai luot uu dai da dung
      await releaseRedemptions(tx, billId, { includeConsumed: true });
      // Tru tong chi tieu cua khach (da cong luc thanh toan)
      for (const o of orders) {
        if (o.customerId && money(o.totalAmount) > 0) {
          const c = await tx.customer.findUnique({ where: { id: o.customerId }, select: { totalSpent: true } });
          if (c) {
            const next = Math.max(0, round2(money(c.totalSpent) - money(o.totalAmount)));
            await tx.customer.update({ where: { id: o.customerId }, data: { totalSpent: next } });
          }
        }
      }
      return { orders, refunds };
    });

    const amount = round2(result.refunds.reduce((s, p) => s + money(p.amount), 0));
    await this.audit.log({
      action: 'refund',
      entityType: 'Bill',
      entityId: billId,
      storeId,
      userId: user.id,
      beforeData: { status: 'PAID' },
      afterData: {
        status: 'REFUNDED',
        reason: dto.reason,
        note: dto.note ?? null,
        amount,
        refunds: result.refunds.map((p) => ({ method: p.method, amount: money(p.amount) })),
      },
    });
    for (const o of result.orders) {
      this.pushOrderEvent({ ...o, status: OrderStatus.REFUNDED }, storeId);
    }
    return {
      ok: true,
      refundAmount: amount,
      refunds: result.refunds.map((p) => ({
        id: p.id,
        method: p.method,
        amount: money(p.amount),
        receiptNo: p.receiptNo,
        refundOfPaymentId: p.refundOfPaymentId,
      })),
      bill: (await this.sessionView(storeId, bill0.sessionId)).bill,
    };
  }

  // ================= CONG KHAI (mini app, chi doc) =================

  /** Hoa don ban cho khach, khoa bang token phien (128 bit) */
  async publicByToken(token: string) {
    if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundException('Phiên không tồn tại');
    let session = await this.prisma.tableSession.findUnique({
      where: { publicToken: token },
      select: { id: true, mergedIntoId: true },
    });
    // Phien da gop vao phien khac: tra phien dich
    for (let i = 0; session?.mergedIntoId && i < 5; i++) {
      session = await this.prisma.tableSession.findUnique({
        where: { id: session.mergedIntoId },
        select: { id: true, mergedIntoId: true },
      });
    }
    if (!session) throw new NotFoundException('Phiên không tồn tại');
    return this.publicView(session.id);
  }

  /** Hoa don ban cho khach da biet orderId cua don thuoc phien (don cu chua luu token) */
  async publicByOrder(orderId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, select: { sessionId: true } });
    if (!o) throw new NotFoundException('Đơn hàng không tồn tại');
    if (!o.sessionId) throw new NotFoundException('Đơn này không thuộc hóa đơn bàn');
    return this.publicView(o.sessionId);
  }

  private async publicView(sessionId: string) {
    const s = await this.prisma.tableSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        store: { select: { name: true, settings: true } },
        primaryTable: { select: { code: true, name: true, area: { select: { name: true } } } },
        // Moi ban tung thuoc phien (de hoa don da dong van du ban da gop); ban DA ROI (MOVED_FROM) loc ben duoi
        tables: {
          orderBy: { joinedAt: 'asc' },
          select: { role: true, leftAt: true, table: { select: { code: true, name: true } } },
        },
        bill: { include: { discounts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } },
        orders: {
          where: { status: { in: [...OPEN_ORDER, OrderStatus.COMPLETED] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            table: { select: { code: true } },
            items: {
              where: { status: { not: OrderItemStatus.CANCELLED } },
              include: { options: true },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (s.status !== TableSessionStatus.OPEN) {
      const closed = s.closedAt ? Date.now() - s.closedAt.getTime() : 0;
      if (closed > 24 * 3600 * 1000) throw new NotFoundException('Phiên đã kết thúc');
    }
    const bill = s.bill;
    const openOrders = s.orders.filter((o) => OPEN_ORDER.includes(o.status));
    const settings = (s.store.settings ?? {}) as Record<string, unknown>;
    let summary;
    if (bill) {
      summary = {
        billStatus: bill.status,
        subtotal: money(bill.subtotal),
        discountAmount: money(bill.discountAmount),
        vatAmount: money(bill.vatAmount),
        totalAmount: money(bill.totalAmount),
        paidAmount: money(bill.paidAmount),
        remaining: BILL_OPEN.includes(bill.status) ? round2(money(bill.totalAmount) - money(bill.paidAmount)) : 0,
      };
    } else {
      const subtotal = round2(openOrders.reduce((a, o) => a + money(o.subtotal), 0));
      const t = calcTotals(subtotal, 0, settings);
      summary = {
        billStatus: null,
        subtotal,
        discountAmount: 0,
        vatAmount: t.vatAmount,
        totalAmount: t.totalAmount,
        paidAmount: 0,
        remaining: t.totalAmount,
      };
    }
    const allOrders = s.orders;
    // Khach co the tu tra QR: quan bat customerCanPayQr VA co tai khoan nhan tien dang hoat dong
    const payCfg = (settings.payment ?? {}) as Record<string, unknown>;
    const customerCanPayQr =
      payCfg.customerCanPayQr === true &&
      (await this.prisma.paymentAccount.count({ where: { storeId: s.storeId, isActive: true } })) > 0;
    // Dong giam gia cho khach: chi loai + ma uu dai + so tien (KHONG lo ly do noi bo / nguoi tao / nguoi duyet)
    const offerIds = (bill?.discounts ?? []).filter((d) => d.offerId).map((d) => d.offerId as string);
    const offers = offerIds.length
      ? await this.prisma.offer.findMany({ where: { id: { in: offerIds } }, select: { id: true, code: true, headline: true } })
      : [];
    const offerById = new Map(offers.map((o) => [o.id, o]));
    const discountLines = (bill?.discounts ?? [])
      .filter((d) => money(d.amount) > 0)
      .map((d) => {
        const o = d.offerId ? offerById.get(d.offerId) : undefined;
        return d.kind === 'VOUCHER' && o
          ? { type: 'VOUCHER' as const, label: `Ưu đãi ${o.code}`, code: o.code, title: o.headline, amount: money(d.amount) }
          : { type: 'MANUAL' as const, label: 'Giảm giá của quán', code: null, title: null, amount: money(d.amount) };
      });
    // Doi ban trong 6 gio gan day: bao khach "da chuyen tu ban nao"
    const moved = await this.prisma.tableSessionTable.findFirst({
      where: {
        sessionId,
        role: 'MOVED_FROM',
        leftAt: { gt: new Date(Date.now() - 6 * 3600_000) },
      },
      orderBy: { leftAt: 'desc' },
      select: { leftAt: true, table: { select: { code: true } } },
    });
    // "Da doi tu ban nao" theo TUNG DON (ban hien tai cua don la ban dich cua lan doi)
    const perOrder = new Map<string, { code: string; at: Date } | null>();
    for (const o of allOrders) {
      perOrder.set(o.id, await movedFromForTable(this.prisma, sessionId, o.tableId));
    }
    // Ban cua phien: ban dang giu + ban da gop (ca khi phien da dong); khong gom ban da doi di
    const seen = new Set<string>();
    const sessionTables = s.tables
      .filter((t) => t.role !== 'MOVED_FROM')
      .filter((t) => (seen.has(t.table.code) ? false : (seen.add(t.table.code), true)))
      .map((t) => ({ code: t.table.code, name: t.table.name, role: t.role, active: t.leftAt === null }));
    // Chi du lieu can thiet: khong co nhan vien, khong co khach khac, khong co ghi chu
    return {
      status: s.status,
      storeName: s.store.name,
      table: {
        code: s.primaryTable.code,
        name: s.primaryTable.name,
        areaName: s.primaryTable.area.name,
      },
      tables: sessionTables,
      // Lan doi ban gan nhat cua CA PHIEN (khong gan voi don cu the); xem orders[].movedFrom cho tung don
      movedFrom: moved ? { code: moved.table.code, at: moved.leftAt } : null,
      customerCanPayQr,
      discounts: discountLines,
      summary: { ...summary, customerCanPayQr, discounts: discountLines },
      orders: allOrders.map((o, i) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        round: i + 1,
        status: o.status,
        createdAt: o.createdAt,
        // Ban vat ly cua don + (neu don vua duoc chuyen toi ban nay) ban cu
        tableCode: o.table.code,
        movedFrom: perOrder.get(o.id) ?? null,
        items: o.items.map((it) => ({
          name: it.nameSnapshot,
          quantity: it.quantity,
          totalAmount: money(it.totalAmount),
          status: it.status,
          options: it.options.map((x) => ({ group: x.optionGroup, value: x.optionValue })),
        })),
      })),
    };
  }

  // ================= NOI BO =================

  /** Khoa ban + hoa don, kiem tra con mo (OPEN/PARTIALLY_PAID), tinh lai tong */
  private async lockOpenBill(tx: Tx, storeId: string, billId: string) {
    const b0 = await tx.bill.findFirst({ where: { id: billId, storeId } });
    if (!b0) throw new NotFoundException('Hóa đơn không tồn tại');
    await lockTables(tx, await sessionTableIds(tx, b0.sessionId));
    await lockBillRow(tx, billId);
    const b = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
    if (!BILL_OPEN.includes(b.status)) {
      throw conflict(`Hóa đơn ${b.status} không thể chỉnh sửa`, 'BILL_CLOSED');
    }
    return recalcBill(tx, billId);
  }

  private async discountLimits(tx: Tx, storeId: string) {
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    const pos = ((store?.settings ?? {}) as Record<string, any>).pos ?? {};
    const lim = (pos.discountLimits ?? {}) as Record<string, unknown>;
    // undefined -> mac dinh an toan; null/so am -> khong gioi han chieu do
    const pick = (v: unknown, def: number): number | null =>
      v === undefined ? def : typeof v === 'number' && v >= 0 ? v : null;
    return {
      maxPercent: pick(lim.cashierMaxPercent, DEFAULT_CASHIER_MAX_PERCENT),
      maxAmount: pick(lim.cashierMaxAmount, DEFAULT_CASHIER_MAX_AMOUNT),
    };
  }

  /** Quan ly/chu quan nhap mat khau tai cho de duyet vuot han muc. Tra ve userId nguoi duyet. */
  private async verifyApprover(
    tx: Tx,
    storeId: string,
    actorId: string,
    approver: { userId?: string; email?: string; password: string },
  ): Promise<string> {
    if (!approver.userId && !approver.email) {
      throw new BadRequestException('Vui lòng chọn quản lý duyệt (userId hoặc email)');
    }
    const wait = approverLimiter.hit(`approve|${actorId}`);
    if (wait !== null) {
      throw new ForbiddenException(`Nhập mật khẩu duyệt quá nhiều lần, vui lòng thử lại sau ${wait} giây`);
    }
    const user = await tx.user.findFirst({
      where: {
        storeId,
        status: UserStatus.ACTIVE,
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
        ...(approver.userId ? { id: approver.userId } : { email: approver.email!.trim().toLowerCase() }),
      },
    });
    const ok = user ? await bcrypt.compare(approver.password, user.passwordHash) : false;
    if (!user || !ok) throw new ForbiddenException('Thông tin hoặc mật khẩu quản lý không đúng');
    return user.id;
  }

  /**
   * Diem DUY NHAT tao Payment cho bill. Goi khi da khoa ban + hoa don va da tinh lai tong.
   * Du tien -> dong bill, phan bo tien xuong don, dong phien, ban NEED_CLEAN.
   */
  private async applyPaymentTx(
    tx: Tx,
    bill: Awaited<ReturnType<typeof recalcBill>>,
    user: { id: string | null },
    a: {
      /** Thanh toan QR: lien ket intent + giao dich ngan hang + nguoi xac nhan */
      intentId?: string;
      bankTransactionId?: string;
      confirmedBy?: 'CASHIER' | 'BANK_FEED' | 'SYSTEM';
      method: PayBillDto['method'];
      amount?: number;
      cashReceived?: number;
      payerLabel?: string;
      allocation?: PayBillDto['allocation'];
      idempotencyKey?: string;
      confirmUnserved: boolean;
    },
  ): Promise<PayTxResult> {
    const total = money(bill.totalAmount);
    const paid = money(bill.paidAmount);
    const remaining = round2(total - paid);
    if (remaining <= 0 && !(total === 0 && paid === 0)) {
      throw conflict('Hóa đơn đã được thanh toán đủ', 'BILL_CLOSED');
    }

    // ---- Xac dinh so tien + cach chia ----
    let amount = a.amount;
    let allocationJson: Prisma.InputJsonValue | undefined;
    const al = a.allocation;
    if (al?.mode === 'ITEMS') {
      if (!al.lines?.length) throw new BadRequestException('Chia theo món cần danh sách món (lines)');
      const calc = await this.computeItemGroups(tx, bill, [{ lines: al.lines }], true);
      const g = calc.groups[0];
      if (amount !== undefined && round2(amount) !== g.amount) {
        throw new BadRequestException(
          `Số tiền (${fmtVnd(amount)}) không khớp phần chia theo món (${fmtVnd(g.amount)})`,
        );
      }
      amount = g.amount;
      allocationJson = { mode: 'ITEMS', lines: g.lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) };
    } else if (al?.mode === 'EVEN') {
      if (!al.parts || !al.index || al.index > al.parts) {
        throw new BadRequestException('Chia đều cần parts và index (1..parts)');
      }
      if (amount === undefined) {
        const left = al.parts - al.index + 1;
        amount = al.index === al.parts ? remaining : Math.floor(remaining / left);
      }
      allocationJson = { mode: 'EVEN', parts: al.parts, index: al.index };
    }
    if (amount === undefined) amount = remaining;
    amount = round2(amount);
    if (total === 0 && paid === 0) amount = 0;
    if (amount > remaining) {
      throw new BadRequestException(
        `Số tiền (${fmtVnd(amount)}) vượt quá số còn lại (${fmtVnd(remaining)})`,
      );
    }
    if (amount <= 0 && total > 0) throw new BadRequestException('Số tiền phải lớn hơn 0');

    if (a.method === 'CASH' && a.cashReceived !== undefined && a.cashReceived < amount) {
      throw new BadRequestException(
        `Tiền khách đưa (${fmtVnd(a.cashReceived)}) chưa đủ số cần thu (${fmtVnd(amount)})`,
      );
    }

    const completes = round2(paid + amount) >= total;

    // ---- Con mon chua ra: chi nhac khi lan thu nay dong bill ----
    if (completes) {
      const store = await tx.store.findUnique({ where: { id: bill.storeId }, select: { settings: true } });
      const pos = ((store?.settings ?? {}) as Record<string, any>).pos ?? {};
      if (pos.warnUnservedOnPay !== false && !a.confirmUnserved) {
        const n = await tx.orderItem.count({
          where: {
            status: { in: UNSERVED_ITEM },
            order: { sessionId: bill.sessionId, status: { in: OPEN_ORDER } },
          },
        });
        if (n > 0) {
          throw conflict(`Còn ${n} món chưa ra, vẫn thanh toán?`, 'UNSERVED_ITEMS', { unservedItems: n });
        }
      }
    }

    const now = new Date();
    const seq = (await tx.payment.count({ where: { billId: bill.id, status: 'COMPLETED' } })) + 1;
    const payment = await tx.payment.create({
      data: {
        storeId: bill.storeId,
        billId: bill.id,
        orderId: null,
        amount,
        method: a.method,
        status: 'COMPLETED',
        paidAt: now,
        cashierId: user.id,
        intentId: a.intentId,
        bankTransactionId: a.bankTransactionId,
        confirmedBy: a.confirmedBy ?? 'CASHIER',
        receiptNo: `${bill.billNo}-${seq}`,
        allocation: allocationJson,
        payerLabel: a.payerLabel?.trim() || null,
        idempotencyKey: a.idempotencyKey,
        cashReceived: a.method === 'CASH' && a.cashReceived !== undefined ? a.cashReceived : null,
      },
    });
    // Cap nhat co dieu kien theo so da thu (da giu khoa dong bill, day la lop bao ve thu hai)
    const upd = await tx.bill.updateMany({
      where: { id: bill.id, status: { in: BILL_OPEN }, paidAmount: bill.paidAmount },
      data: { paidAmount: round2(paid + amount), status: BillStatus.PARTIALLY_PAID },
    });
    if (upd.count !== 1) throw conflict('Hóa đơn vừa thay đổi, vui lòng tải lại', 'BILL_CHANGED');

    if (!completes) return { replayed: false, payment, tables: await this.tablesStatusTx(tx, bill.sessionId), settled: false };

    const settled = await settleBillTx(tx, bill.id, user.id, now);
    return { replayed: false, payment, tables: settled.tables, settled: true, orderIds: settled.orderIds };
  }

  /**
   * Chia mon theo nhom. `track` true: chi chap nhan nhom hop le (nem loi), dung khi thanh toan.
   * Tra ve so tien tung nhom tinh o may chu (ti le theo tam tinh; nhom cuoi thu dung so con lai).
   */
  private async computeItemGroups(
    db: Tx,
    bill: { id: string; sessionId: string; subtotal: Prisma.Decimal; totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal },
    groups: { label?: string; lines: ItemLineDto[] }[],
    strict: boolean,
  ) {
    const items = await db.orderItem.findMany({
      where: {
        status: { not: OrderItemStatus.CANCELLED },
        order: { sessionId: bill.sessionId, status: { in: OPEN_ORDER } },
      },
      select: { id: true, nameSnapshot: true, quantity: true, totalAmount: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    // So luong da gan o cac lan thanh toan truoc
    const prev = await db.payment.findMany({
      where: { billId: bill.id, status: 'COMPLETED', allocation: { not: Prisma.DbNull } },
      select: { allocation: true },
    });
    const used = new Map<string, number>();
    for (const p of prev) {
      const al = p.allocation as { mode?: string; lines?: { orderItemId: string; quantity: number }[] } | null;
      if (al?.mode === 'ITEMS') {
        for (const l of al.lines ?? []) used.set(l.orderItemId, (used.get(l.orderItemId) ?? 0) + l.quantity);
      }
    }

    const total = money(bill.totalAmount);
    const subtotal = money(bill.subtotal);
    const remaining = round2(total - money(bill.paidAmount));
    const out: { label?: string; amount: number; subtotal: number; lines: { orderItemId: string; name: string; quantity: number }[] }[] = [];

    for (const g of groups) {
      const merged = new Map<string, number>();
      for (const l of g.lines) merged.set(l.orderItemId, (merged.get(l.orderItemId) ?? 0) + l.quantity);
      let gSub = 0;
      const lines: { orderItemId: string; name: string; quantity: number }[] = [];
      for (const [id, qty] of merged) {
        const it = byId.get(id);
        if (!it) throw new BadRequestException('Có món không thuộc hóa đơn này hoặc đã bị hủy');
        const left = it.quantity - (used.get(id) ?? 0);
        if (qty > left) {
          throw new BadRequestException(
            left <= 0
              ? `Món "${it.nameSnapshot}" đã được gán hết số lượng; muốn chia một món cho nhiều người hãy dùng chia đều`
              : `Món "${it.nameSnapshot}" chỉ còn ${left} chưa gán (yêu cầu ${qty})`,
          );
        }
        used.set(id, (used.get(id) ?? 0) + qty);
        gSub += (money(it.totalAmount) * qty) / it.quantity;
        lines.push({ orderItemId: id, name: it.nameSnapshot, quantity: qty });
      }
      out.push({ label: g.label, amount: 0, subtotal: round2(gSub), lines });
    }

    const unassigned = items
      .map((i) => ({ orderItemId: i.id, name: i.nameSnapshot, quantity: i.quantity - (used.get(i.id) ?? 0) }))
      .filter((u) => u.quantity > 0);
    const allAssigned = unassigned.length === 0;

    let acc = 0;
    out.forEach((g, i) => {
      const isLast = allAssigned && i === out.length - 1;
      g.amount = isLast
        ? round2(remaining - acc)
        : subtotal > 0
          ? Math.round((total * g.subtotal) / subtotal)
          : 0;
      acc = round2(acc + g.amount);
    });
    if (strict) {
      for (const g of out) {
        if (g.amount > remaining) {
          throw new ConflictException(
            `Phần của nhóm (${fmtVnd(g.amount)}) vượt quá số còn lại (${fmtVnd(remaining)})`,
          );
        }
      }
    }
    return { groups: out, unassigned, allAssigned };
  }

  /** Sau commit khi bill vua PAID: in bill gop + sinh su kien realtime cho tung don */
  private async afterSettled(
    storeId: string,
    billId: string,
    payment: { id: string; method: string },
    orderIds: string[],
  ): Promise<void> {
    try {
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { ...itemInclude, table: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const o of orders) this.pushOrderEvent(o, storeId);

      if ((await this.print.printingSettings(storeId)).autoPrintBill) {
        await this.print.enqueueBill(storeId, billId, { paymentId: payment.id });
      }
    } catch (e) {
      // loi in/realtime khong lam hong giao dich da commit
      this.logger.warn(`afterSettled ${billId}: ${(e as Error).message}`);
    }
  }

  private pushOrderEvent(
    o: {
      id: string;
      orderNumber: string;
      status: string;
      totalAmount: unknown;
      source: string | null;
      createdAt: Date;
      table?: { code: string; name?: string | null } | null;
    },
    storeId: string,
  ): void {
    try {
      this.events.orderStatus({
        storeId,
        orderId: o.id,
        orderNumber: o.orderNumber,
        tableCode: o.table?.code ?? '',
        tableName: o.table?.name ?? null,
        status: o.status,
        totalAmount: money(o.totalAmount),
        source: o.source,
        createdAt: o.createdAt.toISOString(),
      });
    } catch {
      // realtime khong anh huong luong chinh
    }
  }

  private async tablesStatusTx(tx: Tx, sessionId: string) {
    const ids = await sessionTableIds(tx, sessionId);
    const rows = await tx.table.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, status: true } });
    return rows;
  }

  private async tablesStatus(sessionId: string) {
    const rows = await this.prisma.tableSessionTable.findMany({
      where: { sessionId },
      select: { table: { select: { id: true, code: true, status: true } } },
    });
    return rows.map((r) => r.table);
  }

  // ================= DTO =================

  private paymentDto(p: {
    id: string;
    amount: unknown;
    method: string;
    status: string;
    paidAt: Date;
    receiptNo: string | null;
    payerLabel: string | null;
    cashReceived: unknown;
    allocation: unknown;
    refundOfPaymentId: string | null;
    confirmedBy?: string;
    intentId?: string | null;
    refundStatus?: string | null;
  }) {
    return {
      id: p.id,
      amount: money(p.amount),
      method: p.method,
      status: p.status,
      paidAt: p.paidAt,
      receiptNo: p.receiptNo,
      payerLabel: p.payerLabel,
      cashReceived: p.cashReceived === null ? null : money(p.cashReceived),
      allocation: p.allocation ?? null,
      refundOfPaymentId: p.refundOfPaymentId,
      confirmedBy: p.confirmedBy ?? 'CASHIER',
      intentId: p.intentId ?? null,
      refundStatus: p.refundStatus ?? null,
    };
  }

  private billDto(
    b: {
      id: string;
      billNo: string;
      status: BillStatus;
      version: number;
      subtotal: unknown;
      discountAmount: unknown;
      vatAmount: unknown;
      totalAmount: unknown;
      paidAmount: unknown;
      paidAt: Date | null;
      refundedAt?: Date | null;
      createdAt: Date;
      discounts?: {
        id: string;
        kind: string;
        amount: unknown;
        percent: unknown;
        reason: string | null;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        createdAt: Date;
      }[];
      payments?: Parameters<BillsService['paymentDto']>[0][];
    },
  ) {
    const total = money(b.totalAmount);
    const paid = money(b.paidAmount);
    return {
      id: b.id,
      billNo: b.billNo,
      status: b.status,
      version: b.version,
      subtotal: money(b.subtotal),
      discountAmount: money(b.discountAmount),
      vatAmount: money(b.vatAmount),
      totalAmount: total,
      paidAmount: paid,
      remaining: BILL_OPEN.includes(b.status) ? round2(total - paid) : 0,
      paidAt: b.paidAt,
      refundedAt: b.refundedAt ?? null,
      createdAt: b.createdAt,
      ...(b.discounts
        ? {
            discounts: b.discounts.map((d) => ({
              id: d.id,
              kind: d.kind,
              type: d.percent !== null ? 'PERCENT' : 'AMOUNT',
              percent: d.percent !== null ? money(d.percent) : null,
              amount: money(d.amount),
              reason: d.reason,
              createdByUserId: d.createdByUserId,
              approvedByUserId: d.approvedByUserId,
              offerId: (d as { offerId?: string | null }).offerId ?? null,
              createdAt: d.createdAt,
            })),
          }
        : {}),
      ...(b.payments ? { payments: b.payments.map((p) => this.paymentDto(p)) } : {}),
    };
  }

  /** Cho SessionsService dung lai dang xem phien/hoa don */
  sessionViewPublic(storeId: string, sessionId: string) {
    return this.sessionView(storeId, sessionId);
  }

  /** Phien + cac ban + don/dot goi + hoa don (neu co) + tam tinh. Chi doc, 1 lan truy van lon. */
  private async sessionView(storeId: string, sessionId: string) {
    const s = await this.prisma.tableSession.findFirstOrThrow({
      where: { id: sessionId, storeId },
      include: {
        store: { select: { settings: true } },
        tables: {
          orderBy: { joinedAt: 'asc' },
          include: { table: { select: { id: true, code: true, name: true, status: true } } },
        },
        orders: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: itemInclude,
        },
        bill: {
          include: {
            discounts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            payments: { orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });
    const settings = (s.store.settings ?? {}) as Record<string, unknown>;
    const open = s.orders.filter((o) => OPEN_ORDER.includes(o.status));
    const unserved = open.reduce(
      (n, o) => n + o.items.filter((it) => UNSERVED_ITEM.includes(it.status)).length,
      0,
    );

    const orders = s.orders.map((o, i) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      round: i + 1,
      status: o.status,
      source: o.source,
      tableId: o.tableId,
      tableCode: o.table.code,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      customerNote: o.customerNote,
      subtotal: money(o.subtotal),
      discountAmount: money(o.discountAmount),
      vatAmount: money(o.vatAmount),
      totalAmount: money(o.totalAmount),
      items: o.items.map(serializeItem),
    }));

    let preview;
    if (s.bill) {
      preview = {
        subtotal: money(s.bill.subtotal),
        discountAmount: money(s.bill.discountAmount),
        vatAmount: money(s.bill.vatAmount),
        totalAmount: money(s.bill.totalAmount),
      };
    } else {
      const subtotal = round2(open.reduce((a, o) => a + money(o.subtotal), 0));
      const t = calcTotals(subtotal, 0, settings);
      preview = { subtotal, discountAmount: 0, vatAmount: t.vatAmount, totalAmount: t.totalAmount };
    }

    return {
      session: {
        id: s.id,
        status: s.status,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        openedVia: s.openedVia,
        primaryTableId: s.primaryTableId,
        guestCount: s.guestCount,
      },
      tables: s.tables.map((t) => ({
        id: t.table.id,
        code: t.table.code,
        name: t.table.name,
        status: t.table.status,
        role: t.role,
        active: t.leftAt === null,
      })),
      orders,
      bill: s.bill ? this.billDto(s.bill) : null,
      preview,
      unservedItems: unserved,
      // Ma uu dai khach khai bao o gio (chi de thu ngan ap nhanh, KHONG tu giam)
      requestedVoucherCodes: Array.from(
        new Set(s.orders.map((o) => o.voucherCode).filter((c): c is string => !!c)),
      ),
    };
  }
}

export type QrApplyResult =
  | { kind: 'BILL_NOT_FOUND' }
  | { kind: 'BILL_PAID' }
  | { kind: 'BILL_CLOSED' }
  | { kind: 'PARTIAL_REJECTED'; remaining: number }
  | {
      kind: 'APPLIED';
      replayed: boolean;
      payment: Payment;
      applied: number;
      excess: number;
      remainingBefore: number;
      settled: boolean;
      orderIds: string[];
    };

interface PayTxResult {
  replayed: boolean;
  payment: Payment;
  tables: { id: string; code: string; status: string }[];
  settled: boolean;
  orderIds?: string[];
}

/**
 * Chia deu `total` thanh n phan nguyen dong, lan luot: phan i = floor(con lai / so phan con lai),
 * phan cuoi lay het so du (100.000 chia 3 = 33.333 / 33.333 / 33.334). Trung voi cach may chu tinh khi thu tung phan.
 */
export function splitEven(total: number, n: number): number[] {
  const out: number[] = [];
  let rem = total;
  for (let i = 0; i < n - 1; i++) {
    const a = Math.floor(rem / (n - i));
    out.push(a);
    rem = round2(rem - a);
  }
  out.push(round2(rem));
  return out;
}
