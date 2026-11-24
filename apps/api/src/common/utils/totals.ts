import { money, roundAmount, roundVnd } from './money';

export const fmtVnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/**
 * Tien 1 dong mon = (don gia + tong phu thu cac option da chon) x so luong.
 * DUY NHAT noi tinh tien dong mon (tao don, bao gia cho khach); cac noi khac chi doc lai OrderItem.totalAmount.
 */
export function calcLineTotal(unitPrice: unknown, extraPrices: unknown[], quantity: number): number {
  const unit = money(unitPrice) + extraPrices.reduce<number>((s, e) => s + money(e), 0);
  return roundVnd(unit * quantity);
}

/**
 * Quy tac tien cua du an: VAT tinh tren (tam tinh - giam gia), roi lam tron theo cau hinh quan.
 * Dung chung cho tao don, huy mon, thanh toan don va hoa don ban.
 */
export function calcTotals(subtotal: number, discount: number, settings: Record<string, unknown>) {
  const rounding = typeof settings.rounding === 'string' ? settings.rounding : undefined;
  const vatEnabled = settings.vatEnabled === true;
  const vatRate = typeof settings.vatRate === 'number' ? settings.vatRate : 10;
  const base = roundVnd(subtotal - discount);
  const vatAmount = vatEnabled ? roundVnd((base * vatRate) / 100) : 0;
  return { vatAmount, totalAmount: roundAmount(base + vatAmount, rounding) };
}

/**
 * Chia `total` theo ti le `weights` bang phuong phap phan du lon nhat: tong cac phan DUNG BANG total.
 * Don vi chia la 1 dong (neu total co le xu thi chia theo xu). Dung BigInt de khong tran so.
 */
export function allocateLargestRemainder(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalCents = Math.round(total * 100);
  const unit = totalCents % 100 === 0 ? 100 : 1;
  const totalUnits = BigInt(totalCents / unit);
  let w = weights.map((x) => BigInt(Math.max(0, Math.round(x * 100))));
  let wsum = w.reduce((a, b) => a + b, 0n);
  if (wsum === 0n) {
    w = weights.map(() => 1n);
    wsum = BigInt(n);
  }
  const base = w.map((x) => (totalUnits * x) / wsum);
  const rem = w.map((x) => (totalUnits * x) % wsum);
  let left = totalUnits - base.reduce((a, b) => a + b, 0n);
  const order = rem
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.slice();
  for (let k = 0; left > 0n && k < order.length; k++, left--) out[order[k].i] += 1n;
  return out.map((u) => Number(u * BigInt(unit)) / 100);
}
