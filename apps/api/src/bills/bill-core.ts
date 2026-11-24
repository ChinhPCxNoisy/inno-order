import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  Bill,
  BillStatus,
  OrderItemStatus,
  OrderStatus,
  Prisma,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import { money, round2 } from '../common/utils/money';
import { OPEN_ORDER, PAYABLE } from '../common/utils/order-status';
import { allocateLargestRemainder, calcTotals, fmtVnd } from '../common/utils/totals';
import { vnDateLabel } from '../common/utils/vn-date';
import { offerDiscountAmount, offerMinReason } from '../offers/offer-rules';

/**
 * Loi nghiep vu phien ban + hoa don ban, chay trong 1 transaction co san (Tx).
 * Dung chung cho OrdersService (tao/huy don) va BillsService (API hoa don) de khong phu thuoc vong tron.
 *
 * Thu tu khoa DONG BO de tranh deadlock: ban (theo id tang dan) -> hang quan (bo dem so) -> hoa don.
 */
export type Tx = Prisma.TransactionClient;

export const BILL_OPEN: BillStatus[] = [BillStatus.OPEN, BillStatus.PARTIALLY_PAID];
/** Mon chua ra toi ban (bep chua lam xong) */
export const UNSERVED_ITEM: OrderItemStatus[] = [
  OrderItemStatus.PENDING,
  OrderItemStatus.ACCEPTED,
  OrderItemStatus.PREPARING,
];

export const newPublicToken = () => randomBytes(16).toString('hex');

/** Khoa dong ban theo thu tu id tang dan */
export async function lockTables(tx: Tx, tableIds: string[]): Promise<void> {
  for (const id of Array.from(new Set(tableIds)).sort()) {
    await tx.$queryRaw`SELECT id FROM tables WHERE id = ${id}::uuid FOR UPDATE`;
  }
}

export async function lockBillRow(tx: Tx, billId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM bills WHERE id = ${billId}::uuid FOR UPDATE`;
}

/** Cac ban vat ly dang thuoc phien (luon co it nhat ban chinh) */
export async function sessionTableIds(tx: Tx, sessionId: string): Promise<string[]> {
  const rows = await tx.tableSessionTable.findMany({
    where: { sessionId, leftAt: null },
    select: { tableId: true },
  });
  if (rows.length > 0) return rows.map((r) => r.tableId);
  const s = await tx.tableSession.findUnique({
    where: { id: sessionId },
    select: { primaryTableId: true },
  });
  return s ? [s.primaryTableId] : [];
}

/**
 * "Da doi tu ban nao" CHO MOT BAN cu the: lan doi gan nhat (trong withinMs) ma ban DICH chinh la tableId.
 * Dua vao viec doi ban ghi leftAt (ban cu) va joinedAt (ban moi) cung 1 thoi diem. Tra null neu don o ban chua tung duoc chuyen toi.
 */
export async function movedFromForTable(
  db: Tx,
  sessionId: string,
  tableId: string,
  withinMs = 6 * 3600_000,
): Promise<{ code: string; at: Date } | null> {
  const rows = await db.tableSessionTable.findMany({
    where: { sessionId, role: 'MOVED_FROM', leftAt: { gt: new Date(Date.now() - withinMs) } },
    orderBy: { leftAt: 'desc' },
    select: { leftAt: true, table: { select: { code: true } } },
  });
  for (const r of rows) {
    if (!r.leftAt) continue;
    const to = await db.tableSessionTable.findFirst({ where: { sessionId, tableId, joinedAt: r.leftAt }, select: { id: true } });
    if (to) return { code: r.table.code, at: r.leftAt };
  }
  return null;
}

/** Phien OPEN dang giu ban nay (neu co) */
export async function findOpenSessionForTable(tx: Tx, storeId: string, tableId: string) {
  return tx.tableSession.findFirst({
    where: {
      storeId,
      status: TableSessionStatus.OPEN,
      tables: { some: { tableId, leftAt: null } },
    },
  });
}

/** Phien dang mo cua ban, chua co thi mo phien moi. Goi SAU khi da khoa dong ban. */
export async function getOrOpenSession(
  tx: Tx,
  args: { storeId: string; tableId: string; via: 'QR' | 'POS'; userId?: string | null },
) {
  const existing = await findOpenSessionForTable(tx, args.storeId, args.tableId);
  if (existing) return existing;
  return tx.tableSession.create({
    data: {
      storeId: args.storeId,
      primaryTableId: args.tableId,
      status: TableSessionStatus.OPEN,
      publicToken: newPublicToken(),
      openedVia: args.via,
      openedByUserId: args.userId ?? null,
      tables: { create: { tableId: args.tableId, role: 'PRIMARY' } },
    },
  });
}

/**
 * Tinh lai tong hoa don tu cac don dang mo cua phien + giam gia (giam % tinh lai theo tam tinh moi,
 * tong giam khong vuot tam tinh). Tang `version` khi tong doi. Bill da PAID/VOID/REFUNDED khong doi.
 */
export async function recalcBill(tx: Tx, billId: string): Promise<Bill> {
  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: billId },
    include: { discounts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!BILL_OPEN.includes(bill.status)) return bill;

  const orders = await tx.order.findMany({
    where: { sessionId: bill.sessionId, status: { in: OPEN_ORDER } },
    select: { subtotal: true },
  });
  const subtotal = round2(orders.reduce((s, o) => s + money(o.subtotal), 0));

  let cap = subtotal;
  let discountTotal = 0;
  const offerIds = bill.discounts.filter((d) => d.offerId).map((d) => d.offerId as string);
  const offers = offerIds.length ? await tx.offer.findMany({ where: { id: { in: offerIds } } }) : [];
  const offerById = new Map(offers.map((o) => [o.id, o]));
  for (const d of bill.discounts) {
    let raw: number;
    if (d.offerId) {
      // Giam gia tu uu dai: tinh lai theo quy tac uu dai; het du dieu kien toi thieu (tam tinh tut) thi go khoan giam
      const offer = offerById.get(d.offerId);
      const red = await tx.offerRedemption.findFirst({
        where: { billId, offerId: d.offerId, status: 'RESERVED' },
      });
      const overridden = !!red?.overrideReason;
      if (!offer || (!overridden && offerMinReason(offer, subtotal))) {
        await releaseRedemptions(tx, billId, { onlyOfferId: d.offerId });
        await tx.billDiscount.delete({ where: { id: d.id } });
        continue;
      }
      raw = offerDiscountAmount(offer, subtotal);
    } else {
      raw = d.percent !== null ? Math.round((subtotal * money(d.percent)) / 100) : money(d.amount);
    }
    const amt = Math.max(0, Math.min(raw, cap));
    cap = round2(cap - amt);
    discountTotal = round2(discountTotal + amt);
    if (amt !== money(d.amount)) {
      await tx.billDiscount.update({ where: { id: d.id }, data: { amount: amt } });
      if (d.offerId) {
        await tx.offerRedemption.updateMany({
          where: { billId, offerId: d.offerId, status: 'RESERVED' },
          data: { amount: amt },
        });
      }
    }
  }

  const store = await tx.store.findUnique({ where: { id: bill.storeId }, select: { settings: true } });
  const settings = (store?.settings ?? {}) as Record<string, unknown>;
  const { vatAmount, totalAmount } = calcTotals(subtotal, discountTotal, settings);

  const changed =
    money(bill.subtotal) !== subtotal ||
    money(bill.discountAmount) !== discountTotal ||
    money(bill.vatAmount) !== vatAmount ||
    money(bill.totalAmount) !== totalAmount;
  if (!changed) return bill;
  // Tong doi: ma QR da tao truoc do (chua tra) khong con dung so tien, danh dau SUPERSEDED
  await tx.paymentIntent.updateMany({
    where: { billId, status: 'PENDING' },
    data: { status: 'SUPERSEDED' },
  });
  return tx.bill.update({
    where: { id: billId },
    data: {
      subtotal,
      discountAmount: discountTotal,
      vatAmount,
      totalAmount,
      version: { increment: 1 },
    },
  });
}

/**
 * Tra luot uu dai cua hoa don (RESERVED, hoac ca CONSUMED khi hoan tien) va giam usedCount cua uu dai.
 * onlyOfferId: chi tra luot cua uu dai nay.
 */
export async function releaseRedemptions(
  tx: Tx,
  billId: string,
  opts: { onlyOfferId?: string; includeConsumed?: boolean } = {},
): Promise<number> {
  const statuses = opts.includeConsumed ? ['RESERVED', 'CONSUMED'] : ['RESERVED'];
  const rows = await tx.offerRedemption.findMany({
    where: {
      billId,
      status: { in: statuses as ('RESERVED' | 'CONSUMED')[] },
      ...(opts.onlyOfferId ? { offerId: opts.onlyOfferId } : {}),
    },
  });
  for (const r of rows) {
    const u = await tx.offerRedemption.updateMany({
      where: { id: r.id, status: { in: statuses as ('RESERVED' | 'CONSUMED')[] } },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    if (u.count === 1) {
      await tx.offer.updateMany({ where: { id: r.offerId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
    }
  }
  return rows.length;
}

/** Tao hoa don cho phien neu chua co (so hoa don cap nguyen tu theo quan), roi tinh tong. */
export async function ensureBillTx(tx: Tx, storeId: string, sessionId: string): Promise<Bill> {
  const existing = await tx.bill.findUnique({ where: { sessionId } });
  if (existing) return recalcBill(tx, existing.id);

  const seq = await tx.store.update({
    where: { id: storeId },
    data: { billSeq: { increment: 1 } },
    select: { billSeq: true },
  });
  const billNo = `INV-${vnDateLabel().replace(/-/g, '')}-${String(seq.billSeq).padStart(4, '0')}`;
  const created = await tx.bill.create({ data: { storeId, sessionId, billNo } });
  await tx.order.updateMany({ where: { sessionId, storeId }, data: { billId: created.id } });
  return recalcBill(tx, created.id);
}

/**
 * Sau khi cac ban cua phien het don mo: dua ban ve trang thai ranh. Ban khac van con don mo
 * hoac con phien OPEN giu ban thi giu nguyen. Tra ve trang thai ban sau cung.
 */
export async function releaseTablesTx(
  tx: Tx,
  storeId: string,
  tableIds: string[],
  idleStatus: TableStatus,
): Promise<{ id: string; code: string; status: TableStatus }[]> {
  const out: { id: string; code: string; status: TableStatus }[] = [];
  for (const id of Array.from(new Set(tableIds)).sort()) {
    const t = await tx.table.findUnique({ where: { id }, select: { id: true, code: true, status: true } });
    if (!t) continue;
    let status = t.status;
    if (t.status === TableStatus.OCCUPIED) {
      const openOrders = await tx.order.count({
        where: { storeId, tableId: id, status: { in: OPEN_ORDER } },
      });
      const openSeat = await tx.tableSessionTable.count({
        where: { tableId: id, leftAt: null, session: { status: TableSessionStatus.OPEN } },
      });
      if (openOrders === 0 && openSeat === 0) {
        await tx.table.update({ where: { id }, data: { status: idleStatus } });
        status = idleStatus;
      }
    }
    out.push({ id: t.id, code: t.code, status });
  }
  return out;
}

async function closeSession(
  tx: Tx,
  sessionId: string,
  status: 'CLOSED' | 'CANCELLED',
  now: Date,
): Promise<void> {
  await tx.tableSession.update({
    where: { id: sessionId },
    data: { status, closedAt: now },
  });
  await tx.tableSessionTable.updateMany({
    where: { sessionId, leftAt: null },
    data: { leftAt: now },
  });
}

/**
 * Hoa don da thu du: bill PAID, phan bo giam gia/VAT/tong xuong tung don (phan du lon nhat theo tam tinh don,
 * tong cac don = tong bill), don COMPLETED, phien CLOSED, ban NEED_CLEAN, cong totalSpent cua khach.
 * Phai goi khi da khoa ban + hoa don.
 */
export async function settleBillTx(
  tx: Tx,
  billId: string,
  actorId: string | null,
  now: Date,
) {
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
  const orders = await tx.order.findMany({
    where: { sessionId: bill.sessionId, status: { in: PAYABLE } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const weights = orders.map((o) => money(o.subtotal));
  const disc = allocateLargestRemainder(money(bill.discountAmount), weights);
  const vat = allocateLargestRemainder(money(bill.vatAmount), weights);
  const total = allocateLargestRemainder(money(bill.totalAmount), weights);

  for (let i = 0; i < orders.length; i++) {
    const claimed = await tx.order.updateMany({
      where: { id: orders[i].id, status: { in: PAYABLE } },
      data: {
        discountAmount: disc[i],
        vatAmount: vat[i],
        totalAmount: total[i],
        status: OrderStatus.COMPLETED,
        paidAt: now,
        completedAt: now,
        billId: bill.id,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Có đơn vừa đổi trạng thái, vui lòng tải lại hóa đơn');
    }
    if (orders[i].customerId && total[i] > 0) {
      await tx.customer.update({
        where: { id: orders[i].customerId! },
        data: { totalSpent: { increment: total[i] }, lastVisitAt: now },
      });
    }
  }

  const tableIds = await sessionTableIds(tx, bill.sessionId);
  await tx.bill.update({
    where: { id: bill.id },
    data: { status: BillStatus.PAID, paidAt: now, closedByUserId: actorId },
  });
  // Luot uu dai thanh "da dung" khi hoa don dong
  await tx.offerRedemption.updateMany({
    where: { billId: bill.id, status: 'RESERVED' },
    data: { status: 'CONSUMED', consumedAt: now },
  });
  // Ma QR con cho: het y nghia
  await tx.paymentIntent.updateMany({
    where: { billId: bill.id, status: { in: ['PENDING'] } },
    data: { status: 'CANCELLED' },
  });
  await closeSession(tx, bill.sessionId, 'CLOSED', now);
  const tables = await releaseTablesTx(tx, bill.storeId, tableIds, TableStatus.NEED_CLEAN);
  return { orderIds: orders.map((o) => o.id), tables };
}

/**
 * Sau khi huy don/huy mon cua don thuoc phien (goi trong cung transaction, da khoa ban):
 * het don mo -> phien CANCELLED + bill VOID + tra ban; con don -> tinh lai bill
 * (khong cho tong thap hon so da thu; neu da thu du thi dong bill).
 */
export async function afterOrderCancelTx(
  tx: Tx,
  storeId: string,
  sessionId: string,
  actorId: string | null,
): Promise<void> {
  const session = await tx.tableSession.findUnique({
    where: { id: sessionId },
    include: { bill: true },
  });
  if (!session || session.status !== TableSessionStatus.OPEN) return;
  const now = new Date();
  const open = await tx.order.count({ where: { sessionId, status: { in: OPEN_ORDER } } });

  if (open === 0) {
    if (session.bill) {
      if (money(session.bill.paidAmount) > 0) {
        throw new ConflictException(
          'Hóa đơn đã thu một phần, không thể hủy hết món. Vui lòng nhờ quản lý hoàn tiền',
        );
      }
      await tx.bill.update({ where: { id: session.bill.id }, data: { status: BillStatus.VOID } });
      await releaseRedemptions(tx, session.bill.id);
      await tx.paymentIntent.updateMany({ where: { billId: session.bill.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    }
    const tableIds = await sessionTableIds(tx, sessionId);
    await closeSession(tx, sessionId, 'CANCELLED', now);
    await releaseTablesTx(tx, storeId, tableIds, TableStatus.AVAILABLE);
    return;
  }

  if (session.bill && BILL_OPEN.includes(session.bill.status)) {
    await lockBillRow(tx, session.bill.id);
    const b = await recalcBill(tx, session.bill.id);
    const paid = money(b.paidAmount);
    const total = money(b.totalAmount);
    if (paid > total) {
      throw new ConflictException(
        `Hóa đơn đã thu ${fmtVnd(paid)}, hủy món làm tổng còn ${fmtVnd(total)}. Vui lòng nhờ quản lý hoàn tiền`,
      );
    }
    if (paid > 0 && paid >= total) {
      await settleBillTx(tx, b.id, actorId, now);
    }
  }
}
