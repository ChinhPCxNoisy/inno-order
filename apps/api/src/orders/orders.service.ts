import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Order,
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EventsService } from '../realtime/events.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money, round2 } from '../common/utils/money';
import { CLOSED_ORDER, OPEN_ORDER, PAYABLE } from '../common/utils/order-status';
import { serializeOrder } from '../common/utils/serialize-order';
import { calcTotals, fmtVnd } from '../common/utils/totals';
import { PricingInputItem, PricingMenuItem, priceItems } from './order-pricing';
import { PrintService } from '../printers/print.service';
import { BillsService } from '../bills/bills.service';
import {
  afterOrderCancelTx,
  getOrOpenSession,
  movedFromForTable,
  lockTables,
  recalcBill,
  BILL_OPEN,
} from '../bills/bill-core';
import {
  CancelOrderDto,
  CreateOrderDto,
  PayOrderDto,
  RefundOrderDto,
  SetItemStatusDto,
  SetOrderStatusDto,
} from './dto/order.dto';

const ORDER_FLOW: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.COMPLETED,
];
const ITEM_FLOW: OrderItemStatus[] = [
  OrderItemStatus.PENDING,
  OrderItemStatus.ACCEPTED,
  OrderItemStatus.PREPARING,
  OrderItemStatus.READY,
  OrderItemStatus.SERVED,
];

/** Don co the duoc day len READY (tu PENDING/ACCEPTED/PREPARING) */
const READYABLE: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
];
type Tx = Prisma.TransactionClient;

/** Ma uu dai khach khai bao: in hoa, bo khoang trang, chi giu chu-so-gach (>= 1 ky tu), toi da 40 */
function normalizeVoucherInput(raw: string): string | null {
  const v = raw.replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
  return v || null;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Tien mat',
  TRANSFER: 'Chuyen khoan',
  QR_BANK: 'Quet ma QR',
  CARD: 'The',
  WALLET: 'Vi dien tu',
};

export interface CreateOrderInput {
  storeId: string;
  tableId?: string;
  tableCode?: string;
  items: CreateOrderDto['items'];
  customerNote?: string;
  source: OrderSource;
  actor?: JwtUser | null;
  customer?: CreateOrderDto['customer'];
  /** Khoa chong gui trung (tuy chon): trung trong cung quan thi tra ve don cu */
  clientRequestId?: string;
  /** Token phien ban cua khach (duong public): giu dung ban sau khi doi ban */
  sessionToken?: string;
  /** Ma uu dai khach khai bao (chi luu) */
  voucherCode?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly print: PrintService,
    private readonly events: EventsService,
    private readonly bills: BillsService,
  ) {}

  /** Push su kien don ve admin (POS/KDS) — khong duoc loi loi don */
  private pushOrderEvent(
    type: 'order.created' | 'order.status',
    order: {
      id: string;
      orderNumber: string;
      status: string;
      totalAmount: unknown;
      source: string | null;
      createdAt: Date;
      table: { code: string; name?: string | null } | null;
    },
    storeId: string,
  ): void {
    try {
      const base = {
        storeId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableCode: order.table?.code ?? '',
        tableName: order.table?.name ?? null,
        status: order.status,
        totalAmount: money(order.totalAmount),
        source: order.source,
        createdAt: order.createdAt.toISOString(),
      };
      if (type === 'order.created') this.events.orderCreated(base);
      else this.events.orderStatus(base);
    } catch {
      // loi realtime khong anh huong luong chinh
    }
  }

  // ================= HELPER TRANSACTION =================

  /** Khoa dong ban de cac thao tac dong/huy don cua cung 1 ban chay tuan tu */
  private async lockTable(tx: Tx, tableId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tables WHERE id = ${tableId}::uuid FOR UPDATE`;
  }

  /**
   * Sau khi 1 don dong (thanh toan/huy/hoan): neu ban het don mo thi doi trang thai ban,
   * con don mo khac thi giu nguyen OCCUPIED. Phai goi sau khi don da doi trang thai trong cung tx.
   */
  private async releaseTableIfIdle(
    tx: Tx,
    storeId: string,
    tableId: string,
    idleStatus: TableStatus,
  ): Promise<TableStatus> {
    const table = await tx.table.findUnique({ where: { id: tableId }, select: { status: true } });
    if (!table) return TableStatus.AVAILABLE;
    if (table.status !== TableStatus.OCCUPIED) return table.status;
    const open = await tx.order.count({
      where: { storeId, tableId, status: { in: OPEN_ORDER } },
    });
    if (open > 0) return table.status;
    await tx.table.update({ where: { id: tableId }, data: { status: idleStatus } });
    return idleStatus;
  }

  /**
   * Dong bo trang thai don theo trang thai tung mon (bep):
   * moi mon (tru mon huy) READY/SERVED -> READY; co mon dang lam/da xong -> PREPARING.
   * Tra ve trang thai don sau cung.
   */
  private async syncOrderStatusFromItems(tx: Tx, orderId: string): Promise<OrderStatus | null> {
    const o = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, items: { select: { status: true } } },
    });
    if (!o) return null;
    const active = o.items.filter((it) => it.status !== OrderItemStatus.CANCELLED);
    if (active.length === 0) return o.status;
    const done = (s: OrderItemStatus) => s === OrderItemStatus.READY || s === OrderItemStatus.SERVED;
    let next: OrderStatus | null = null;
    if (active.every((it) => done(it.status)) && READYABLE.includes(o.status)) {
      next = OrderStatus.READY;
    } else if (
      (o.status === OrderStatus.PENDING || o.status === OrderStatus.ACCEPTED) &&
      active.some((it) => it.status === OrderItemStatus.PREPARING || done(it.status))
    ) {
      next = OrderStatus.PREPARING;
    }
    if (next && next !== o.status) {
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      return next;
    }
    return o.status;
  }

  // ================= TAO DON (BRD 8.2) =================

  async createOrder(input: CreateOrderInput) {
    const { storeId, tableId, tableCode, source, actor } = input;
    const clientRequestId = input.clientRequestId?.trim() || undefined;
    // Duong nhan vien: bat buoc dung quan cua minh (duong khach public co actor = null)
    if (actor) assertStoreAccess(actor, storeId);
    if (!tableId && !tableCode) {
      throw new BadRequestException('Vui lòng chọn bàn');
    }

    // Gui lai cung clientRequestId -> tra ve don da tao, khong tao don moi / in lai phieu
    if (clientRequestId) {
      const dup = await this.findByClientRequestId(storeId, clientRequestId);
      if (dup) return this.withSessionToken(serializeOrder(dup), dup.sessionId, actor);
    }

    let order: Awaited<ReturnType<OrdersService['createOrderTx']>>;
    try {
      order = await this.prisma.$transaction((tx) =>
        this.createOrderTx(tx, { ...input, clientRequestId }),
      );
    } catch (e) {
      // Hai yeu cau cung clientRequestId den dong thoi: yeu cau den sau nhan lai don cua yeu cau truoc
      if (
        clientRequestId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const dup = await this.findByClientRequestId(storeId, clientRequestId);
        if (dup) return this.withSessionToken(serializeOrder(dup), dup.sessionId, actor);
      }
      throw e;
    }

    // ---- Phieu bep/bar vao hang doi in that (ngoai transaction; loi in duoc ghi nhan + canh bao realtime) ----
    await this.print.enqueueKitchen(storeId, order.id);
    await this.audit.log({
      action: 'create_order',
      entityType: 'Order',
      entityId: order.id,
      storeId,
      userId: actor?.id,
      afterData: {
        orderNumber: order.orderNumber,
        source,
        totalAmount: money(order.totalAmount),
      },
    });

    this.pushOrderEvent('order.created', order, storeId);

    return this.withSessionToken(serializeOrder(order), order.sessionId, actor);
  }

  /**
   * Duong khach (public, actor = null): tra them token phien de mini app xem hoa don cua ban.
   * Token la bi mat, chi tra cho thiet bi vua gui don (khong co o GET /public/orders/:id).
   */
  private async withSessionToken<T extends object>(
    out: T,
    sessionId: string | null,
    actor: JwtUser | null | undefined,
  ): Promise<T & { sessionToken?: string }> {
    if (actor || !sessionId) return out;
    // (token + tableCode hien tai cua don: mini app cap nhat ban neu nhan vien da doi ban)
    const s = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      select: { publicToken: true, status: true },
    });
    const tb = (out as { tableId?: string }).tableId
      ? await this.prisma.table.findUnique({ where: { id: (out as { tableId: string }).tableId }, select: { code: true } })
      : null;
    return s && s.status === 'OPEN'
      ? { ...out, sessionToken: s.publicToken, tableCode: tb?.code }
      : out;
  }

  /**
   * Token phien hop le (con OPEN, theo phien dich neu da gop) va ban khach gui la ban DA ROI phien (MOVED_FROM)
   * -> tra ve ban chinh hien tai cua phien. Truong hop khac: bo qua token (rang buoc vat ly cua ma QR duoc uu tien).
   */
  private async redirectByToken(tx: Tx, storeId: string, token: string, tableId: string) {
    let s = await tx.tableSession.findUnique({ where: { publicToken: token } });
    for (let i = 0; s?.mergedIntoId && i < 5; i++) {
      s = await tx.tableSession.findUnique({ where: { id: s.mergedIntoId } });
    }
    if (!s || s.storeId !== storeId || s.status !== 'OPEN') return null;
    // Ban dang quet la ban dang thuoc phien -> binh thuong (don vao phien cua ban do)
    const active = await tx.tableSessionTable.findFirst({
      where: { sessionId: s.id, tableId, leftAt: null },
      select: { id: true },
    });
    if (active) return null;
    const left = await tx.tableSessionTable.findFirst({
      where: { sessionId: s.id, tableId, role: 'MOVED_FROM' },
    });
    // Ban khong lien quan toi phien: bo qua token (rang buoc vat ly cua ma QR duoc uu tien)
    if (!left) return null;
    // Token cua phien DA CHUYEN SANG ban khac nhung khach quet QR ban cu (co the dang co khach khac ngoi):
    // KHONG BAO GIO tu chuyen don. Tu choi ro rang de mini app hoi khach hoac bo token.
    const to = await tx.table.findFirst({ where: { id: s.primaryTableId, storeId }, select: { code: true, name: true } });
    const scanned = await tx.table.findUnique({ where: { id: tableId }, select: { code: true } });
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'SESSION_MOVED',
      message: `Bạn đã được chuyển sang bàn ${to?.code ?? ''}. Gọi tiếp ở bàn ${to?.code ?? ''}?`,
      movedTo: { code: to?.code ?? null, name: to?.name ?? null },
      scannedTable: { code: scanned?.code ?? null },
    });
  }

  /**
   * Bao gia gio hang (khong ghi gi): cung ham priceItems + calcTotals voi tao don nen khach thay dung so se thu.
   */
  async quoteItems(storeId: string, items: PricingInputItem[]) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    if (!store) throw new NotFoundException('Quán không tồn tại');
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: Array.from(new Set(items.map((i) => i.menuItemId))) }, storeId },
      include: { options: true, category: { select: { active: true } } },
    });
    const priced = priceItems(new Map(menuItems.map((m) => [m.id, m])) as Map<string, PricingMenuItem>, items);
    return {
      subtotal: priced.subtotal,
      lines: priced.lines.map((l) => ({ menuItemId: l.menuItem.id, quantity: l.quantity, lineTotal: l.lineTotal })),
      settings: (store.settings ?? {}) as Record<string, unknown>,
    };
  }

  private async findByClientRequestId(storeId: string, clientRequestId: string) {
    return this.prisma.order.findUnique({
      where: { storeId_clientRequestId: { storeId, clientRequestId } },
      include: {
        items: { include: { options: true }, orderBy: { createdAt: 'asc' } },
        table: true,
      },
    });
  }

  private async createOrderTx(tx: Tx, input: CreateOrderInput) {
    const { storeId, tableId, tableCode, items, customerNote, source, customer, clientRequestId } =
      input;

    const store = await tx.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Quán không tồn tại');
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động');
    }

    let table = tableId
      ? await tx.table.findFirst({ where: { id: tableId, storeId } })
      : await tx.table.findFirst({
          where: { storeId, code: tableCode?.toUpperCase() },
        });
    if (!table) throw new BadRequestException('Bàn không tồn tại, vui lòng quét lại mã QR');
    // Khach co token phien: neu ban quet la ban da roi phien (nhan vien doi ban) thi dat vao ban hien tai cua phien
    if (input.sessionToken && !input.actor) {
      await this.redirectByToken(tx, storeId, input.sessionToken, table.id);
    }
    if (table.status === TableStatus.LOCKED) {
      throw new ConflictException(`Bàn ${table.code} đang tạm khóa, vui lòng gọi nhân viên`);
    }
    const resolvedTableId = table.id;
    // Khoa ban: don dong thoi cung ban phai vao CUNG 1 phien (khong mo 2 phien), va chay tuan tu voi thanh toan/huy
    await lockTables(tx, [resolvedTableId]);
    // Doc lai trang thai ban SAU khi khoa (thanh toan dong thoi co the vua doi sang NEED_CLEAN)
    const lockedTable = await tx.table.findUniqueOrThrow({
      where: { id: resolvedTableId },
      select: { status: true, code: true },
    });
    if (lockedTable.status === TableStatus.LOCKED) {
      throw new ConflictException(`Bàn ${lockedTable.code} đang tạm khóa, vui lòng gọi nhân viên`);
    }

    // ---- Kiem tra + tinh tien mon (chi mon thuoc dung quan) ----
    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: Array.from(new Set(items.map((i) => i.menuItemId))) }, storeId },
      include: { options: true, category: { select: { active: true } } },
    });
    const menuById = new Map(menuItems.map((m) => [m.id, m]));

    // Tinh tien o MOT cho (order-pricing.ts): phu thu option nhan voi so luong
    const priced = priceItems(menuById as Map<string, PricingMenuItem>, items);
    // Moi mon lech 1ms de thu tu them vao don on dinh (createMany long nhau cung created_at mac dinh = trung nhau)
    const itemsBaseMs = Date.now();
    const itemPayloads: Prisma.OrderItemCreateWithoutOrderInput[] = priced.lines.map((l, idx) => ({
      menuItem: { connect: { id: l.menuItem.id } },
      nameSnapshot: l.menuItem.name,
      priceSnapshot: l.menuItem.price,
      quantity: l.quantity,
      totalAmount: l.lineTotal,
      note: l.note,
      createdAt: new Date(itemsBaseMs + idx),
      options: { create: l.options },
    }));

    // ---- VAT + lam tron theo cau hinh quan ----
    const settings = (store.settings ?? {}) as Record<string, unknown>;
    const subtotal = priced.subtotal;
    const { vatAmount, totalAmount } = calcTotals(subtotal, 0, settings);

    // ---- Luu thong tin khach (tuynh, chi khi khach dong y) ----
    let customerId: string | null = null;
    if (customer?.phone) {
      const phone = customer.phone.trim();
      const existing = await tx.customer.findUnique({
        where: { storeId_phone: { storeId, phone } },
      });
      if (existing) {
        customerId = existing.id;
        await tx.customer.update({
          where: { id: existing.id },
          data: {
            name: customer.name ?? existing.name,
            marketingConsent:
              customer.marketingConsent ?? existing.marketingConsent,
            transactionalConsent:
              customer.transactionalConsent ?? existing.transactionalConsent,
            consentDate: new Date(),
            lastVisitAt: new Date(),
          },
        });
      } else {
        const created = await tx.customer.create({
          data: {
            storeId,
            phone,
            name: customer.name,
            marketingConsent: customer.marketingConsent ?? false,
            transactionalConsent: customer.transactionalConsent ?? false,
            consentDate: new Date(),
            lastVisitAt: new Date(),
          },
        });
        customerId = created.id;
      }
    }

    // ---- So don: bo dem nguyen tu theo quan (1001, 1002, ...). Cap nhat tang tren hang
    // quan khoa hang den het transaction nen cac don dong thoi duoc cap so tuan tu, khong trung.
    // Dat sat luc tao don de giu khoa ngan nhat co the. ----
    const seq = await tx.store.update({
      where: { id: storeId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    const orderNumber = String(seq.orderSeq);

    // ---- Phien ban: ban dang co phien mo thi day la dot goi them, chua thi mo phien moi ----
    const session = await getOrOpenSession(tx, {
      storeId,
      tableId: resolvedTableId,
      via: source === OrderSource.QR ? 'QR' : 'POS',
      userId: input.actor?.id,
    });
    const bill = await tx.bill.findUnique({ where: { sessionId: session.id } });

    const created = await tx.order.create({
      data: {
        storeId,
        tableId: resolvedTableId,
        sessionId: session.id,
        billId: bill && BILL_OPEN.includes(bill.status) ? bill.id : null,
        voucherCode: input.voucherCode ? normalizeVoucherInput(input.voucherCode) : null,
        orderNumber,
        status: OrderStatus.PENDING,
        subtotal,
        vatAmount,
        totalAmount,
        customerNote,
        source,
        customerId,
        clientRequestId,
        items: { create: itemPayloads },
      },
      include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } }, table: true },
    });

    // ---- Ban sang OCCUPIED ----
    if (lockedTable.status === TableStatus.AVAILABLE || lockedTable.status === TableStatus.NEED_CLEAN) {
      await tx.table.update({
        where: { id: resolvedTableId },
        data: { status: TableStatus.OCCUPIED },
      });
    }

    // ---- Hoa don da lap: tong tang theo dot goi them ----
    if (bill && BILL_OPEN.includes(bill.status)) await recalcBill(tx, bill.id);

    return created;
  }

  // ================= TRA CUU =================

  async list(
    user: JwtUser,
    storeId: string,
    q: {
      status?: string;
      tableId?: string;
      from?: string;
      to?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    assertStoreAccess(user, storeId);
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 20, 100);
    const where: Prisma.OrderWhereInput = { storeId };
    if (q.status) where.status = q.status as OrderStatus;
    if (q.tableId) where.tableId = q.tableId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    if (q.search) where.orderNumber = { contains: q.search };

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { options: true }, orderBy: { createdAt: 'asc' } },
          table: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      data: orders.map((o) => ({
        ...serializeOrder(o),
        table: { code: o.table.code, name: o.table.name },
      })),
    };
  }

  async getOne(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id, storeId },
      include: {
        items: { include: { options: true }, orderBy: { createdAt: 'asc' } },
        table: { select: { code: true, name: true, area: { select: { name: true } } } },
        payments: { orderBy: { paidAt: 'desc' } },
        bill: {
          select: {
            id: true,
            billNo: true,
            status: true,
            totalAmount: true,
            paidAmount: true,
            payments: { orderBy: { paidAt: 'desc' } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    // Don thuoc hoa don ban: cac lan thanh toan nam o bill (Order.payments rong voi don moi)
    const payments = [...order.payments, ...(order.bill?.payments ?? [])];
    return {
      ...serializeOrder(order),
      table: {
        code: order.table.code,
        name: order.table.name,
        area: order.table.area.name,
      },
      bill: order.bill
        ? {
            id: order.bill.id,
            billNo: order.bill.billNo,
            status: order.bill.status,
            totalAmount: money(order.bill.totalAmount),
            paidAmount: money(order.bill.paidAmount),
          }
        : null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        receiptNo: p.receiptNo,
        payerLabel: p.payerLabel,
      })),
    };
  }

  /** Khach (public, khong can token) theo doi don cua minh */
  async getPublicOne(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        // id (uuid v7, tang theo thoi gian) lam khoa phu de don cu co created_at trung nhau van ra on dinh
        items: { include: { options: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        table: { select: { code: true, name: true } },
        store: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    // Doi ban trong 6 gio gan day, THEO DUNG BAN CUA DON NAY (don o ban khac cua phien gop thi null)
    const movedFrom = order.sessionId
      ? await movedFromForTable(this.prisma, order.sessionId, order.tableId)
      : null;
    return {
      orderNumber: order.orderNumber,
      storeName: order.store.name,
      table: { code: order.table.code, name: order.table.name },
      tableMovedFrom: movedFrom,
      status: order.status,
      totalAmount: money(order.totalAmount),
      createdAt: order.createdAt,
      customerNote: order.customerNote,
      items: order.items.map((it) => ({
        name: it.nameSnapshot,
        quantity: it.quantity,
        totalAmount: money(it.totalAmount),
        note: it.note,
        status: it.status,
        // Tuy chon da chon (nhom + gia tri) de khach doi chieu
        options: it.options.map((o) => ({ group: o.optionGroup, value: o.optionValue })),
      })),
    };
  }

  /** Cac don dang mo cua 1 ban (POS - BRD FR-POS-02) */
  async openOrdersForTable(user: JwtUser, storeId: string, tableId: string) {
    assertStoreAccess(user, storeId);
    const orders = await this.prisma.order.findMany({
      where: {
        storeId,
        tableId,
        status: {
          notIn: [
            OrderStatus.COMPLETED,
            OrderStatus.CANCELLED,
            OrderStatus.REFUNDED,
            OrderStatus.PARTIAL_REFUND,
          ],
        },
      },
      include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return orders.map(serializeOrder);
  }

  // ================= TRANG THAI DON =================

  async setOrderStatus(
    user: JwtUser,
    storeId: string,
    id: string,
    dto: SetOrderStatusDto,
  ) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id, storeId },
      include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');

    const fromIdx = ORDER_FLOW.indexOf(order.status);
    const toIdx = ORDER_FLOW.indexOf(dto.status);
    if (fromIdx < 0) {
      throw new ConflictException(`Đơn đang ở trạng thái ${order.status}, không thể đổi trạng thái`);
    }
    if (toIdx <= fromIdx || toIdx >= ORDER_FLOW.length - 1) {
      throw new BadRequestException(
        `Khong the chuyen tu ${order.status} sang ${dto.status}`,
      );
    }

    const itemStatus = ORDER_TO_ITEM[order.status] ?? undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (itemStatus) {
        await tx.orderItem.updateMany({
          where: { orderId: id, status: { not: OrderItemStatus.CANCELLED } },
          data: { status: itemStatus },
        });
      }
      return tx.order.update({
        where: { id },
        data: { status: dto.status },
        include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } }, table: { select: { code: true } } },
      });
    });

    await this.audit.log({
      action: 'order_status',
      entityType: 'Order',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { status: order.status },
      afterData: { status: dto.status },
    });
    this.pushOrderEvent('order.status', updated, storeId);
    return serializeOrder(updated);
  }

  // ================= KDS (BRD 9.7) =================

  /** Nhap don: PENDING -> ACCEPTED (toan bo mon) */
  async acceptOrder(user: JwtUser, storeId: string, orderId: string) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: { table: { select: { code: true, name: true } } },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(`Đơn đang ở trạng thái ${order.status}, không cần xử lý nữa`);
    }
    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.ACCEPTED } }),
      this.prisma.orderItem.updateMany({
        where: { orderId, status: OrderItemStatus.PENDING },
        data: { status: OrderItemStatus.ACCEPTED },
      }),
    ]);
    await this.audit.log({
      action: 'order_accept',
      entityType: 'Order',
      entityId: orderId,
      storeId,
      userId: user.id,
    });
    this.pushOrderEvent('order.status', { ...order, status: OrderStatus.ACCEPTED }, storeId);
    return { ok: true, status: 'ACCEPTED' };
  }

  /** Moi mon cua don sang READY */
  async readyOrder(user: JwtUser, storeId: string, orderId: string) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        items: { include: { options: true }, orderBy: { createdAt: 'asc' } },
        table: { select: { code: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    if (!READYABLE.includes(order.status)) {
      throw new ConflictException(`Đơn đang ở trạng thái ${order.status}, không thể đổi trạng thái`);
    }
    await this.prisma.$transaction([
      this.prisma.orderItem.updateMany({
        where: {
          orderId,
          status: { notIn: [OrderItemStatus.READY, OrderItemStatus.SERVED, OrderItemStatus.CANCELLED] },
        },
        data: { status: OrderItemStatus.READY },
      }),
      this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.READY } }),
    ]);
    await this.audit.log({
      action: 'order_ready',
      entityType: 'Order',
      entityId: orderId,
      storeId,
      userId: user.id,
    });
    this.pushOrderEvent('order.status', { ...order, status: OrderStatus.READY }, storeId);
    return { ok: true, status: 'READY' };
  }

  /** Don moi cho KDS: PENDING / ACCEPTED / PREPARING / READY */
  async kitchenOrders(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const orders = await this.prisma.order.findMany({
      where: {
        storeId,
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.ACCEPTED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
          ],
        },
      },
      include: {
        items: {
          include: { options: true, menuItem: { select: { prepTimeMinutes: true } } },
          orderBy: { createdAt: 'asc' },
        },
        table: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    return orders.map((o) => {
      const waitedSec = Math.floor((now - o.createdAt.getTime()) / 1000);
      const maxPrep = Math.max(
        0,
        ...o.items.map((it) => it.menuItem.prepTimeMinutes ?? 0),
      );
      return {
        ...serializeOrder(o),
        table: { code: o.table.code, name: o.table.name },
        waitedSeconds: waitedSec,
        // Can bao mon cho lau (BRD FR-KDS-06): qua 150% thoi gian che bien du ke
        isLate: maxPrep > 0 ? waitedSec > maxPrep * 60 * 1.5 : waitedSec > 30 * 60,
      };
    });
  }

  /** Doi trang thai 1 mon (BRD 9.6 FR-ORD-06) */
  async setItemStatus(
    user: JwtUser,
    storeId: string,
    orderId: string,
    itemId: string,
    dto: SetItemStatusDto,
  ) {
    assertStoreAccess(user, storeId);
    // Mon phai thuoc dung don trong URL va dung quan
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId, order: { storeId } },
    });
    if (!item) throw new NotFoundException('Món trong đơn không tồn tại');

    const fromIdx = ITEM_FLOW.indexOf(item.status);
    const toIdx = ITEM_FLOW.indexOf(dto.status);
    if (fromIdx < 0 || toIdx <= fromIdx) {
      throw new BadRequestException(
        `Mon ${item.status} khong the chuyen sang ${dto.status}`,
      );
    }

    const { order, orderChanged } = await this.prisma.$transaction(async (tx) => {
      // Cap nhat co dieu kien: tranh ghi de khi 2 nguoi bam dong thoi / mon vua bi huy
      const res = await tx.orderItem.updateMany({
        where: { id: itemId, status: item.status },
        data: {
          status: dto.status,
          // Ghi nhan ai bam "Da mang ra ban" de thuong theo so luong phuc vu + goi y nguoi duoc danh gia
          ...(dto.status === OrderItemStatus.SERVED ? { servedByUserId: user.id } : {}),
        },
      });
      if (res.count === 0) {
        throw new ConflictException('Món vừa được cập nhật bởi người khác, vui lòng tải lại');
      }
      // Dong bo trang thai don theo tien do bep (PREPARING / READY)
      const before = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
      const after = await this.syncOrderStatusFromItems(tx, orderId);
      const full = await tx.order.findUnique({
        where: { id: orderId },
        include: { table: { select: { code: true, name: true } } },
      });
      return { order: full, orderChanged: before?.status !== after };
    });

    await this.audit.log({
      action: 'item_status',
      entityType: 'OrderItem',
      entityId: itemId,
      storeId,
      userId: user.id,
      beforeData: { status: item.status },
      afterData: { status: dto.status },
    });
    // Luon phat realtime de POS/KDS khac cap nhat ngay (khong cho poll 15s)
    if (order) this.pushOrderEvent('order.status', order, storeId);
    return { ok: true, status: dto.status, orderStatus: order?.status, orderChanged };
  }

  // ================= HUY (BRD 8.7) =================

  async cancelOrder(user: JwtUser, storeId: string, id: string, dto: CancelOrderDto) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id, storeId },
      include: { items: { include: { options: true } }, table: true },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    if (CLOSED_ORDER.includes(order.status)) {
      throw new ConflictException(`Đơn ${order.status} không thể hủy`);
    }

    const activeItems = order.items.filter(
      (it) => it.status !== OrderItemStatus.CANCELLED,
    );
    if (activeItems.some((it) => it.status !== OrderItemStatus.PENDING && it.status !== OrderItemStatus.ACCEPTED)) {
      throw new ConflictException(
        'Đơn đã bắt đầu chế biến, chỉ được hủy riêng món hoặc nhờ quản lý đổi món',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockTable(tx, order.tableId);
      // Cap nhat co dieu kien: don vua duoc thanh toan/huy boi nguoi khac thi tu choi
      const res = await tx.order.updateMany({
        where: { id, storeId, status: { notIn: CLOSED_ORDER } },
        data: { status: OrderStatus.CANCELLED },
      });
      if (res.count === 0) throw new ConflictException('Đơn vừa thay đổi trạng thái, vui lòng tải lại');
      await tx.orderItem.updateMany({
        where: { orderId: id, status: { not: OrderItemStatus.CANCELLED } },
        data: { status: OrderItemStatus.CANCELLED },
      });
      // Don thuoc phien: cap nhat hoa don / dong phien neu het don mo; don cu khong phien: theo ban
      if (order.sessionId) {
        await afterOrderCancelTx(tx, storeId, order.sessionId, user.id);
      } else {
        await this.releaseTableIfIdle(tx, storeId, order.tableId, TableStatus.AVAILABLE);
      }
    });

    await this.print.enqueueCancel(
      storeId,
      id,
      activeItems.map((it) => it.id),
      dto.reason,
      user.name,
    );
    await this.audit.log({
      action: 'cancel_order',
      entityType: 'Order',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { status: order.status },
      afterData: { status: 'CANCELLED', reason: dto.reason },
    });
    this.pushOrderEvent('order.status', { ...order, status: OrderStatus.CANCELLED }, storeId);
    return { ok: true };
  }

  async cancelItem(
    user: JwtUser,
    storeId: string,
    orderId: string,
    itemId: string,
    dto: CancelOrderDto,
  ) {
    assertStoreAccess(user, storeId);
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, order: { storeId, id: orderId } },
      include: { order: { select: { status: true, tableId: true, sessionId: true } } },
    });
    if (!item) throw new NotFoundException('Món trong đơn không tồn tại');
    if (CLOSED_ORDER.includes(item.order.status)) {
      throw new ConflictException(`Đơn ${item.order.status} không thể hủy món`);
    }
    if (item.status === OrderItemStatus.CANCELLED) {
      throw new ConflictException('Món này đã được hủy trước đó');
    }
    if (
      item.status !== OrderItemStatus.PENDING &&
      item.status !== OrderItemStatus.ACCEPTED
    ) {
      // Quy tac cu: mon dang che bien khong huy duoc o day (can quan ly duyet)
      throw new ConflictException(
        'Món đã bắt đầu chế biến, không thể hủy (cần quản lý duyệt)',
      );
    }

    const { orderAfter, tableCode } = await this.prisma.$transaction(async (tx) => {
      await this.lockTable(tx, item.order.tableId);
      // Chi huy khi don con mo va mon con PENDING/ACCEPTED (chong dua voi thanh toan/bep)
      const cur = await tx.order.findFirst({
        where: { id: orderId, storeId, status: { notIn: CLOSED_ORDER } },
        select: { id: true },
      });
      if (!cur) throw new ConflictException('Đơn vừa được thanh toán hoặc hủy, không thể hủy món');
      const res = await tx.orderItem.updateMany({
        where: {
          id: itemId,
          status: { in: [OrderItemStatus.PENDING, OrderItemStatus.ACCEPTED] },
        },
        data: { status: OrderItemStatus.CANCELLED },
      });
      if (res.count === 0) {
        throw new ConflictException('Món vừa được cập nhật bởi người khác, vui lòng tải lại');
      }

      // Tinh lai tam tinh + VAT + tong theo quy tac chung
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const active = items.filter((it) => it.status !== OrderItemStatus.CANCELLED);
      const subtotal = round2(active.reduce((s, it) => s + money(it.totalAmount), 0));
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { settings: true } });
      const settings = (store?.settings ?? {}) as Record<string, unknown>;
      const { vatAmount, totalAmount } = calcTotals(subtotal, 0, settings);
      await tx.order.update({
        where: { id: orderId },
        data: { subtotal, vatAmount, totalAmount },
      });

      if (active.length === 0) {
        // Huy het mon -> huy toan don, tra ban neu het don mo
        await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
        if (!item.order.sessionId) {
          await this.releaseTableIfIdle(tx, storeId, item.order.tableId, TableStatus.AVAILABLE);
        }
      } else {
        // Mon con lai co the da xong het -> don len READY
        await this.syncOrderStatusFromItems(tx, orderId);
      }
      // Don thuoc phien: tinh lai hoa don (tong giam), het don mo thi dong phien + tra ban
      if (item.order.sessionId) {
        await afterOrderCancelTx(tx, storeId, item.order.sessionId, user.id);
      }

      const orderAfter = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { table: { select: { code: true, name: true } } },
      });
      return { orderAfter, tableCode: orderAfter.table.code };
    });

    void tableCode;
    await this.print.enqueueCancel(storeId, orderId, [itemId], dto.reason, user.name);

    await this.audit.log({
      action: 'cancel_item',
      entityType: 'OrderItem',
      entityId: itemId,
      storeId,
      userId: user.id,
      beforeData: { status: item.status, name: item.nameSnapshot },
      afterData: { status: 'CANCELLED', reason: dto.reason },
    });
    // Phat realtime nhu cac thao tac khac de KDS/POS cap nhat ngay
    this.pushOrderEvent('order.status', orderAfter, storeId);
    return { ok: true };
  }

  // ================= THANH TOAN (BRD 8.4, 9.8) =================

  async payOrder(
    user: JwtUser,
    storeId: string,
    orderId: string,
    dto: PayOrderDto,
  ) {
    assertStoreAccess(user, storeId);
    // Don thuoc phien ban: di qua co che hoa don (1 don mo -> thanh toan du bill; nhieu don -> 409).
    // Chi don cu khong co phien moi chay duong thanh toan theo don duoi day.
    const head = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: { sessionId: true },
    });
    if (head?.sessionId) {
      return this.bills.payLegacyOrder(user, storeId, orderId, head.sessionId, dto);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, storeId },
        include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } } },
      });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
      if (!PAYABLE.includes(order.status)) {
        throw new ConflictException(`Đơn ${order.status} không thể thanh toán`);
      }

      const activeItems = order.items.filter(
        (it) => it.status !== OrderItemStatus.CANCELLED,
      );
      if (activeItems.length === 0) {
        throw new BadRequestException('Đơn không còn món nào để thanh toán');
      }

      const store = await tx.store.findUnique({ where: { id: storeId } });
      const settings = (store?.settings ?? {}) as Record<string, unknown>;

      const subtotal = round2(
        activeItems.reduce((s, it) => s + money(it.totalAmount), 0),
      );
      const discount = dto.discountAmount ?? 0;
      if (discount > subtotal) {
        throw new BadRequestException(
          `Giảm giá (${fmtVnd(discount)}) không được vượt quá tạm tính (${fmtVnd(subtotal)})`,
        );
      }
      // VAT tinh lai tren (tam tinh - giam gia)
      const { vatAmount, totalAmount: total } = calcTotals(subtotal, discount, settings);
      if (total < 0) throw new BadRequestException('Tổng tiền không được âm');
      if (dto.method === 'CASH' && dto.cashReceived !== undefined && dto.cashReceived < total) {
        throw new BadRequestException(
          `Tiền khách đưa (${fmtVnd(dto.cashReceived)}) chưa đủ tổng cần thu (${fmtVnd(total)})`,
        );
      }

      const now = new Date();
      const receiptNo = `INV-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${order.orderNumber}`;

      await this.lockTable(tx, order.tableId);
      // Chong thanh toan dong thoi: chi 1 yeu cau chuyen duoc don sang COMPLETED
      const claimed = await tx.order.updateMany({
        where: { id: orderId, storeId, status: { in: PAYABLE } },
        data: {
          subtotal,
          discountAmount: discount,
          vatAmount,
          totalAmount: total,
          status: OrderStatus.COMPLETED,
          paidAt: now,
          completedAt: now,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Đơn đã được thanh toán hoặc không còn thanh toán được');
      }

      const payment = await tx.payment.create({
        data: {
          storeId,
          orderId,
          amount: total,
          method: dto.method,
          status: 'COMPLETED',
          paidAt: now,
          cashierId: user.id,
          receiptNo,
        },
      });

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { options: true }, orderBy: { createdAt: 'asc' } }, table: true },
      });

      // Ban -> NEED_CLEAN chi khi het don mo; con don khac thi giu OCCUPIED
      const tableStatus = await this.releaseTableIfIdle(
        tx,
        storeId,
        updatedOrder.tableId,
        TableStatus.NEED_CLEAN,
      );

      // Cap nhat thong ke khach
      if (updatedOrder.customerId) {
        await tx.customer.update({
          where: { id: updatedOrder.customerId },
          data: {
            totalSpent: { increment: total },
            lastVisitAt: now,
          },
        });
      }

      return { payment, order: updatedOrder, discount, tableStatus };
    });

    if ((await this.print.printingSettings(storeId)).autoPrintBill) {
      await this.print.enqueueOrderBill(storeId, orderId, { paymentId: result.payment.id });
    }

    await this.audit.log({
      action: 'payment',
      entityType: 'Payment',
      entityId: result.payment.id,
      storeId,
      userId: user.id,
      afterData: {
        orderId,
        orderNumber: result.order.orderNumber,
        method: dto.method,
        discount: result.discount,
        total: money(result.order.totalAmount),
      },
    });
    this.pushOrderEvent('order.status', result.order, storeId);

    return {
      payment: {
        id: result.payment.id,
        amount: money(result.payment.amount),
        method: result.payment.method,
        status: result.payment.status,
        paidAt: result.payment.paidAt,
        receiptNo: result.payment.receiptNo,
      },
      order: serializeOrder(result.order),
      table: {
        id: result.order.table.id,
        code: result.order.table.code,
        // NEED_CLEAN khi het don mo, OCCUPIED neu ban con don khac
        status: result.tableStatus,
      },
      change:
        dto.method === 'CASH' && dto.cashReceived !== undefined
          ? Math.max(0, dto.cashReceived - money(result.order.totalAmount))
          : null,
    };
  }

  // ================= HOAN TIEN (BRD 8.7) =================

  async refundOrder(
    user: JwtUser,
    storeId: string,
    orderId: string,
    dto: RefundOrderDto,
  ) {
    assertStoreAccess(user, storeId);
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, storeId },
        include: { table: { select: { id: true, code: true, status: true } } },
      });
      if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
      if (order.status !== OrderStatus.COMPLETED) {
        throw new ConflictException(`Chỉ đơn COMPLETED mới được hoàn tiền (hiện tại: ${order.status})`);
      }
      // Don thuoc hoa don ban: tien nam o Payment cua bill -> hoan theo hoa don (POST pos/bills/:id/refund)
      if (order.billId) {
        throw new ConflictException(
          'Đơn thuộc hóa đơn bàn, vui lòng hoàn tiền theo hóa đơn (pos/bills/:billId/refund)',
        );
      }
      await this.lockTable(tx, order.table.id);
      // Chong hoan tien 2 lan dong thoi
      const claimed = await tx.order.updateMany({
        where: { id: orderId, storeId, status: OrderStatus.COMPLETED },
        data: { status: OrderStatus.REFUNDED },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Đơn đã được hoàn tiền hoặc vừa đổi trạng thái');
      }
      const amount = money(order.totalAmount);
      // Hoan dung phuong thuc goc cua lan thu (don cu thuong chi 1 lan thu); khong xac dinh duoc thi tien mat
      const original = await tx.payment.findFirst({
        where: { orderId, status: 'COMPLETED' },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      });
      const refundPayment = await tx.payment.create({
        data: {
          storeId,
          orderId,
          amount,
          method: original?.method ?? 'CASH',
          status: 'REFUNDED',
          paidAt: new Date(),
          cashierId: user.id,
          receiptNo: `RF-${Date.now().toString(36).toUpperCase()}`,
          refundOfPaymentId: original?.id ?? null,
        },
      });
      // Tru tong chi tieu cua khach (da cong luc thanh toan)
      if (order.customerId && amount > 0) {
        const c = await tx.customer.findUnique({
          where: { id: order.customerId },
          select: { totalSpent: true },
        });
        if (c) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: { totalSpent: Math.max(0, round2(money(c.totalSpent) - amount)) },
          });
        }
      }
      // Ban chi ve can don khi khong con don mo nao khac
      await this.releaseTableIfIdle(tx, storeId, order.table.id, TableStatus.NEED_CLEAN);
      return { order, refundPayment, amount };
    });

    await this.audit.log({
      action: 'refund',
      entityType: 'Order',
      entityId: orderId,
      storeId,
      userId: user.id,
      beforeData: { status: 'COMPLETED' },
      afterData: {
        status: 'REFUNDED',
        reason: dto.reason,
        note: dto.note,
        amount: result.amount,
      },
    });
    this.pushOrderEvent('order.status', { ...result.order, status: OrderStatus.REFUNDED }, storeId);
    return {
      ok: true,
      refundAmount: result.amount,
      refundReceipt: result.refundPayment.receiptNo,
    };
  }

  // ================= IN LAI (BRD FR-PRN-04) =================

  /**
   * In lai: kitchen/bar = phieu bep/bar cua don; bill = bill cua hoa don ban (hoac bill don cu).
   * Moi lan in lai la mot job moi co nhan IN LAI, ghi audit.
   */
  async reprint(
    user: JwtUser,
    storeId: string,
    orderId: string,
    kind: 'bill' | 'kitchen' | 'bar',
    reason?: string,
  ) {
    assertStoreAccess(user, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: { id: true, billId: true, sessionId: true },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    const count =
      (await this.prisma.printJob.count({ where: { storeId, orderId, jobType: 'REPRINT' } })) + 1;

    let result: { queued: boolean; reason?: string };
    if (kind === 'bill') {
      const billId = order.billId
        ? order.billId
        : order.sessionId
          ? (await this.prisma.bill.findUnique({ where: { sessionId: order.sessionId }, select: { id: true } }))?.id
          : undefined;
      result = billId
        ? await this.print.enqueueBill(storeId, billId, { reprintCount: count, cashier: user.name })
        : await this.print.enqueueOrderBill(storeId, orderId, { reprintCount: count });
    } else {
      await this.print.enqueueKitchen(storeId, orderId, {
        reprintCount: count,
        only: kind === 'bar' ? 'BAR' : 'KITCHEN',
      });
      result = { queued: true };
    }
    await this.audit.log({
      action: 'reprint',
      entityType: 'Order',
      entityId: orderId,
      storeId,
      userId: user.id,
      afterData: { kind, reason: reason ?? null, count },
    });
    const job = await this.prisma.printJob.findFirst({
      where: { storeId, orderId, jobType: 'REPRINT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, failedReason: true },
    });
    return {
      jobId: job?.id ?? null,
      status: job?.status ?? (result.queued ? 'PENDING' : 'FAILED'),
      failedReason: job?.failedReason ?? result.reason ?? null,
    };
  }
}

/** Order status -> item status ung khi chuyen don len */
const ORDER_TO_ITEM: Partial<Record<OrderStatus, OrderItemStatus>> = {
  [OrderStatus.ACCEPTED]: OrderItemStatus.ACCEPTED,
  [OrderStatus.PREPARING]: OrderItemStatus.PREPARING,
  [OrderStatus.READY]: OrderItemStatus.READY,
};
