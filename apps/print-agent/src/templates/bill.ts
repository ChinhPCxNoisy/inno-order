import type { BillData, Block, PrintDocument } from '../document/types.js';
import { DEFAULT_TZ, formatDateTime, formatTime, formatVnd, optionText } from './format.js';

/** Bill gop ban / phieu tam tinh. Tong tien do server tinh; agent chi trinh bay */
export function buildBill(d: BillData): PrintDocument {
  const tz = d.timeZone ?? DEFAULT_TZ;
  const blocks: Block[] = [];
  if (d.reprint) {
    blocks.push({ t: 'text', s: `*** IN LẠI (lần ${d.reprint.count}) ***`, align: 'center', bold: true }, { t: 'sep', c: '-' });
  }
  blocks.push({ t: 'text', s: d.store.name, align: 'center', size: 'tall', bold: true });
  if (d.store.address) blocks.push({ t: 'text', s: d.store.address, align: 'center' });
  if (d.store.phone) blocks.push({ t: 'text', s: `ĐT: ${d.store.phone}`, align: 'center' });
  if (d.store.taxCode) blocks.push({ t: 'text', s: `MST: ${d.store.taxCode}`, align: 'center' });
  blocks.push(
    { t: 'sep', c: '=' },
    { t: 'text', s: d.preBill ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN', align: 'center', size: 'tall', bold: true },
  );
  if (d.billNo) blocks.push({ t: 'text', s: `Số: ${d.billNo}`, align: 'center' });
  const tables = [d.tableCode, ...(d.mergedTables ?? [])].join(' + ');
  blocks.push({ t: 'kv', l: 'Bàn', r: tables, bold: true });
  if (d.openedAt) blocks.push({ t: 'kv', l: 'Giờ vào', r: formatDateTime(d.openedAt, tz) });
  if (d.closedAt || !d.preBill) blocks.push({ t: 'kv', l: 'Giờ ra', r: formatDateTime(d.closedAt, tz) });
  if (d.cashier) blocks.push({ t: 'kv', l: 'Thu ngân', r: d.cashier });
  blocks.push({ t: 'sep', c: '-' }, { t: 'item', q: 'SL', n: 'Tên món', a: 'T.tiền', bold: true }, { t: 'sep', c: '-' });

  const multi = d.orders.length > 1;
  for (const o of d.orders) {
    if (multi) {
      const label = `Đơn #${o.orderNumber}${o.round && o.round > 1 ? ` (đợt ${o.round})` : ''}`;
      blocks.push({ t: 'kv', l: label, r: o.createdAt ? formatTime(o.createdAt, tz) : '' });
    }
    for (const it of o.items) {
      const sub: string[] = [];
      if (it.quantity > 1) sub.push(`${it.quantity} x ${formatVnd(it.unitPrice)}`);
      for (const op of it.options ?? []) sub.push(optionText(op));
      if (it.note) sub.push(`[${it.note}]`);
      blocks.push({ t: 'item', q: String(it.quantity), n: it.name, a: formatVnd(it.total), sub });
    }
  }

  blocks.push({ t: 'sep', c: '-' }, { t: 'kv', l: 'Tạm tính', r: formatVnd(d.subtotal) });
  for (const disc of d.discounts ?? []) {
    if (disc.amount) blocks.push({ t: 'kv', l: disc.label, r: `-${formatVnd(Math.abs(disc.amount))}` });
  }
  if (d.vatAmount) {
    blocks.push({ t: 'kv', l: d.vatPercent ? `VAT (${d.vatPercent}%)` : 'VAT', r: formatVnd(d.vatAmount) });
  }
  if (d.roundingAmount) blocks.push({ t: 'kv', l: 'Làm tròn', r: formatVnd(d.roundingAmount) });
  blocks.push({ t: 'sep', c: '=' }, { t: 'kv', l: 'TỔNG CỘNG', r: `${formatVnd(d.total)}đ`, size: 'tall', bold: true });

  if (!d.preBill && d.payments?.length) {
    blocks.push({ t: 'sep', c: '-' });
    for (const p of d.payments) {
      blocks.push({ t: 'kv', l: p.method, r: `${formatVnd(p.amount)}đ` });
      if (p.tendered != null && p.tendered > p.amount) {
        blocks.push({ t: 'kv', l: '  Khách đưa', r: formatVnd(p.tendered) });
        blocks.push({ t: 'kv', l: '  Tiền thối', r: formatVnd(p.change ?? p.tendered - p.amount) });
      }
    }
  }
  blocks.push({ t: 'sep', c: '-' });
  if (d.preBill) blocks.push({ t: 'text', s: '(Phiếu tạm tính - chưa phải hóa đơn thanh toán)', align: 'center' });
  blocks.push({ t: 'text', s: d.footerText ?? 'Cảm ơn quý khách, hẹn gặp lại!', align: 'center', bold: true });
  if (d.qr) blocks.push({ t: 'feed', n: 1 }, { t: 'qr', d: d.qr, size: 5 });
  blocks.push({ t: 'feed', n: 1 }, { t: 'cut' });
  return { v: 1, blocks };
}
