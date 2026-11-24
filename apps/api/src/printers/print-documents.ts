import { money, round2 } from '../common/utils/money';

/**
 * Dung payload JSON cho Print Agent (kieu chuan: apps/print-agent/src/document/types.ts).
 * Server chi gui JSON thuan co dau day du; agent tu cat dong/chon raster/CP1258/ASCII theo may in.
 */

export type Station = 'KITCHEN' | 'BAR';
export const STATION_LABEL: Record<Station, string> = { KITCHEN: 'Bếp', BAR: 'Bar' };

export const METHOD_LABEL_VI: Record<string, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
  QR_BANK: 'Quét mã QR',
  CARD: 'Thẻ',
  WALLET: 'Ví điện tử',
};

/** Ma ly do huy/hoan (REFUND_REASONS) -> nhan tieng Viet tren phieu; ly do tu do giu nguyen */
export const CANCEL_REASON_LABEL: Record<string, string> = {
  WRONG_ITEM: 'Sai món',
  CUSTOMER_REFUSED: 'Khách từ chối',
  OPERATIONAL_ERROR: 'Lỗi vận hành',
  OTHER: 'Khác',
};

interface ItemLike {
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  priceSnapshot: unknown;
  totalAmount: unknown;
  options: { optionGroup: string; optionValue: string }[];
}

const opts = (it: ItemLike) => it.options.map((o) => ({ group: o.optionGroup, value: o.optionValue }));

export function kitchenTicketPayload(a: {
  station: Station;
  storeName: string;
  tableCode: string;
  areaName?: string;
  orderNumber: string;
  round: number;
  createdAt: Date;
  source: string | null;
  staffName?: string;
  items: ItemLike[];
  orderNote?: string | null;
  reprintCount?: number;
}) {
  return {
    kind: 'kitchen_ticket' as const,
    data: {
      stationLabel: STATION_LABEL[a.station],
      storeName: a.storeName,
      tableCode: a.tableCode,
      ...(a.areaName ? { areaName: a.areaName } : {}),
      orderNumber: a.orderNumber,
      round: a.round,
      createdAt: a.createdAt.toISOString(),
      ...(a.source ? { source: a.source } : {}),
      ...(a.staffName ? { staffName: a.staffName } : {}),
      items: a.items.map((it) => ({
        name: it.nameSnapshot,
        quantity: it.quantity,
        options: opts(it),
        ...(it.note ? { note: it.note } : {}),
      })),
      ...(a.orderNote ? { orderNote: a.orderNote } : {}),
      ...(a.reprintCount ? { reprint: { count: a.reprintCount } } : {}),
    },
  };
}

export function cancelTicketPayload(a: {
  station: Station;
  tableCode: string;
  orderNumber: string;
  items: ItemLike[];
  reason?: string;
  staffName?: string;
  reprintCount?: number;
}) {
  return {
    kind: 'cancel_ticket' as const,
    data: {
      stationLabel: STATION_LABEL[a.station],
      tableCode: a.tableCode,
      orderNumber: a.orderNumber,
      createdAt: new Date().toISOString(),
      items: a.items.map((it) => ({
        name: it.nameSnapshot,
        quantity: it.quantity,
        ...(it.note ? { note: it.note } : {}),
      })),
      ...(a.reason ? { reason: CANCEL_REASON_LABEL[a.reason] ?? a.reason } : {}),
      ...(a.staffName ? { staffName: a.staffName } : {}),
      ...(a.reprintCount ? { reprint: { count: a.reprintCount } } : {}),
    },
  };
}

export interface BillOrderInput {
  orderNumber: string;
  round: number;
  createdAt: Date;
  items: ItemLike[];
}

/** Bill gop theo ban / tam tinh (preBill) / bill don le (don cu khong phien) */
export function billPayload(a: {
  preBill: boolean;
  store: { name: string; address?: string | null; phone?: string | null };
  billNo?: string;
  tableCode: string;
  mergedTables?: string[];
  openedAt?: Date;
  closedAt?: Date | null;
  cashier?: string;
  orders: BillOrderInput[];
  subtotal: number;
  discounts: { label: string; amount: number }[];
  vatPercent?: number;
  vatAmount: number;
  total: number;
  payments: { method: string; amount: number; tendered?: number | null }[];
  footerText?: string;
  reprintCount?: number;
}) {
  const discountSum = round2(a.discounts.reduce((s, d) => s + d.amount, 0));
  const roundingAmount = round2(a.total - round2(a.subtotal - discountSum + a.vatAmount));
  return {
    kind: 'bill' as const,
    data: {
      ...(a.preBill ? { preBill: true } : {}),
      store: {
        name: a.store.name,
        ...(a.store.address ? { address: a.store.address } : {}),
        ...(a.store.phone ? { phone: a.store.phone } : {}),
      },
      ...(a.billNo ? { billNo: a.billNo } : {}),
      tableCode: a.tableCode,
      ...(a.mergedTables && a.mergedTables.length > 1 ? { mergedTables: a.mergedTables } : {}),
      ...(a.openedAt ? { openedAt: a.openedAt.toISOString() } : {}),
      ...(a.closedAt ? { closedAt: a.closedAt.toISOString() } : {}),
      ...(a.cashier ? { cashier: a.cashier } : {}),
      orders: a.orders.map((o) => ({
        orderNumber: o.orderNumber,
        round: o.round,
        createdAt: o.createdAt.toISOString(),
        items: o.items.map((it) => ({
          name: it.nameSnapshot,
          quantity: it.quantity,
          // Don gia da gom phu thu option (total / so luong) de "2 x 65.000 = 130.000" khop nhau
          unitPrice: it.quantity > 0 ? Math.round(money(it.totalAmount) / it.quantity) : money(it.priceSnapshot),
          total: money(it.totalAmount),
          options: opts(it),
          ...(it.note ? { note: it.note } : {}),
        })),
      })),
      subtotal: a.subtotal,
      ...(a.discounts.length ? { discounts: a.discounts } : {}),
      ...(a.vatAmount > 0 && a.vatPercent !== undefined ? { vatPercent: a.vatPercent } : {}),
      ...(a.vatAmount > 0 ? { vatAmount: a.vatAmount } : {}),
      ...(roundingAmount !== 0 ? { roundingAmount } : {}),
      total: a.total,
      ...(a.payments.length
        ? {
            payments: a.payments.map((p) => ({
              method: METHOD_LABEL_VI[p.method] ?? p.method,
              amount: p.amount,
              ...(p.tendered != null && p.tendered > p.amount
                ? { tendered: p.tendered, change: round2(p.tendered - p.amount) }
                : {}),
            })),
          }
        : {}),
      ...(a.footerText ? { footerText: a.footerText } : {}),
      ...(a.reprintCount ? { reprint: { count: a.reprintCount } } : {}),
    },
  };
}

/** Phieu doi ban cho cac khu con mon chua ra (dung khoi `document` cua agent) */
export function tableMoveDocument(a: {
  stationLabel: string;
  from: string;
  to: string;
  orders: { orderNumber: string; items: { name: string; quantity: number }[] }[];
  at: Date;
}) {
  const blocks: unknown[] = [
    { t: 'text', s: `ĐỔI BÀN ${a.from} → ${a.to}`, align: 'center', size: 'big', bold: true },
    { t: 'kv', l: a.stationLabel, r: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(a.at) },
    { t: 'sep', c: '-' },
  ];
  for (const o of a.orders) {
    blocks.push({ t: 'text', s: `Đơn #${o.orderNumber}`, bold: true });
    for (const it of o.items) blocks.push({ t: 'item', q: `${it.quantity}x`, n: it.name, bold: true });
  }
  blocks.push({ t: 'sep', c: '-' }, { t: 'text', s: `Mang món tới bàn ${a.to}`, align: 'center' }, { t: 'feed', n: 2 }, { t: 'cut' });
  return { kind: 'document' as const, document: { v: 1 as const, blocks } };
}
