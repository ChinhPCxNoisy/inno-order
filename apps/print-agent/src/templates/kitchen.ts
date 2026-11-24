import type { Block, CancelTicketData, KitchenTicketData, PrintDocument } from '../document/types.js';
import { DEFAULT_TZ, formatTime, optionText } from './format.js';

function reprintBanner(count: number): Block[] {
  return [
    { t: 'text', s: `*** IN LẠI (lần ${count}) ***`, align: 'center', bold: true },
    { t: 'sep', c: '-' },
  ];
}

/** Phieu bep/bar: ban lon, don + dot goi, mon va so luong to, tuy chon/ghi chu noi bat, khong in gia */
export function buildKitchenTicket(d: KitchenTicketData): PrintDocument {
  const tz = d.timeZone ?? DEFAULT_TZ;
  const blocks: Block[] = [];
  if (d.reprint) blocks.push(...reprintBanner(d.reprint.count));
  if (d.stationLabel) blocks.push({ t: 'text', s: d.stationLabel.toUpperCase(), align: 'center', bold: true });
  blocks.push({ t: 'text', s: `BÀN ${d.tableCode}`, align: 'center', size: 'big', bold: true });
  if (d.areaName) blocks.push({ t: 'text', s: d.areaName, align: 'center' });
  blocks.push({ t: 'kv', l: `Đơn #${d.orderNumber}`, r: formatTime(d.createdAt, tz), bold: true });
  if (d.round && d.round > 1) {
    blocks.push({ t: 'text', s: `*** ĐỢT ${d.round} - GỌI THÊM ***`, align: 'center', size: 'tall', bold: true });
  }
  const who = [d.source ? `Nguồn: ${d.source === 'QR' ? 'QR khách' : d.source}` : '', d.staffName ? `NV: ${d.staffName}` : '']
    .filter(Boolean)
    .join(' | ');
  if (who) blocks.push({ t: 'text', s: who });
  blocks.push({ t: 'sep', c: '=' });

  for (const it of d.items) {
    blocks.push({ t: 'text', s: `${it.quantity} x ${it.name}`, size: 'tall', bold: true, hang: 4 });
    for (const o of it.options ?? []) blocks.push({ t: 'text', s: `+ ${optionText(o)}`, bold: true, hang: 2 });
    if (it.note) blocks.push({ t: 'text', s: `>> ${it.note}`, bold: true, size: 'tall', hang: 3 });
  }
  if (d.orderNote) {
    blocks.push({ t: 'sep', c: '-' }, { t: 'text', s: `GHI CHÚ: ${d.orderNote}`, bold: true, size: 'tall' });
  }
  blocks.push({ t: 'sep', c: '=' }, { t: 'feed', n: 1 }, { t: 'cut' });
  return { v: 1, blocks };
}

/** Phieu huy mon: chu HUY MON to, mon bi huy, ly do, nguoi huy */
export function buildCancelTicket(d: CancelTicketData): PrintDocument {
  const tz = d.timeZone ?? DEFAULT_TZ;
  const blocks: Block[] = [];
  if (d.reprint) blocks.push(...reprintBanner(d.reprint.count));
  if (d.stationLabel) blocks.push({ t: 'text', s: d.stationLabel.toUpperCase(), align: 'center', bold: true });
  blocks.push(
    { t: 'text', s: 'HỦY MÓN', align: 'center', size: 'big', bold: true },
    { t: 'text', s: `BÀN ${d.tableCode}`, align: 'center', size: 'tall', bold: true },
    { t: 'kv', l: `Đơn #${d.orderNumber}`, r: formatTime(d.createdAt, tz), bold: true },
    { t: 'sep', c: '=' },
  );
  for (const it of d.items) {
    blocks.push({ t: 'text', s: `- ${it.quantity} x ${it.name}`, size: 'tall', bold: true, hang: 6 });
    if (it.note) blocks.push({ t: 'text', s: `  ${it.note}`, hang: 2 });
  }
  blocks.push({ t: 'sep', c: '-' });
  if (d.reason) blocks.push({ t: 'text', s: `Lý do: ${d.reason}`, bold: true, hang: 2 });
  if (d.staffName) blocks.push({ t: 'text', s: `Người hủy: ${d.staffName}` });
  blocks.push(
    { t: 'text', s: 'KHÔNG LÀM MÓN NÀY NỮA', align: 'center', bold: true },
    { t: 'sep', c: '=' },
    { t: 'feed', n: 1 },
    { t: 'cut' },
  );
  return { v: 1, blocks };
}
