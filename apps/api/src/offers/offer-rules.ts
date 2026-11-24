import { money, round2 } from '../common/utils/money';
import { fmtVnd } from '../common/utils/totals';

export interface OfferLike {
  code: string;
  discountType: 'PERCENT' | 'AMOUNT';
  value: unknown;
  maxDiscount: unknown;
  minSubtotal: unknown;
  startsAt: Date;
  endsAt: Date | null;
  totalLimit: number | null;
  usedCount: number;
  stackable: boolean;
  active: boolean;
  extraTerms: unknown;
}

/** So tien giam: PERCENT = lam tron(tam tinh * % / 100) chan boi maxDiscount; AMOUNT = min(value, tam tinh) */
export function offerDiscountAmount(o: OfferLike, subtotal: number): number {
  const value = money(o.value);
  let amt = o.discountType === 'PERCENT' ? Math.round((subtotal * value) / 100) : value;
  const cap = o.maxDiscount === null || o.maxDiscount === undefined ? null : money(o.maxDiscount);
  if (cap !== null && cap > 0) amt = Math.min(amt, cap);
  return Math.max(0, Math.min(Math.round(amt), Math.round(subtotal)));
}

/** Ly do uu dai khong dung duoc luc nay (null = dung duoc). Khong bao gom dieu kien tam tinh toi thieu. */
export function offerUnavailableReason(o: OfferLike, now = new Date()): string | null {
  if (!o.active) return 'Ưu đãi đang tạm dừng';
  if (o.startsAt.getTime() > now.getTime()) return 'Ưu đãi chưa đến thời gian áp dụng';
  if (o.endsAt && o.endsAt.getTime() < now.getTime()) return 'Ưu đãi đã hết hạn';
  if (o.totalLimit !== null && o.usedCount >= o.totalLimit) return 'Ưu đãi đã hết lượt sử dụng';
  return null;
}

export function offerMinReason(o: OfferLike, subtotal: number): string | null {
  const min = money(o.minSubtotal);
  if (min > 0 && subtotal < min) {
    return `Đơn chưa đạt tối thiểu ${fmtVnd(min)} (hiện ${fmtVnd(subtotal)})`;
  }
  return null;
}

/** Dieu kien ap dung hien cho khach: SINH TU DU LIEU (khong nhap tay), cong them extraTerms */
export function offerConditions(o: OfferLike): string[] {
  const out: string[] = [];
  const min = money(o.minSubtotal);
  const cap = o.maxDiscount === null || o.maxDiscount === undefined ? 0 : money(o.maxDiscount);
  let line = min > 0 ? `Đơn từ ${fmtVnd(min)}` : 'Áp dụng cho mọi đơn';
  if (o.discountType === 'PERCENT' && cap > 0) line += `; giảm tối đa ${fmtVnd(cap)}`;
  out.push(line + '.');
  if (o.endsAt) {
    out.push(`Áp dụng đến ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(o.endsAt)}.`);
  }
  if (!o.stackable) out.push('Không áp dụng đồng thời với ưu đãi khác.');
  if (o.totalLimit !== null) out.push('Số lượng có hạn.');
  out.push('Nhờ nhân viên kiểm tra trước khi thanh toán.');
  if (Array.isArray(o.extraTerms)) {
    for (const t of o.extraTerms) if (typeof t === 'string' && t.trim()) out.push(t.trim());
  }
  return out;
}

/** Tom tat 1 dong cho the danh sach: "Giảm 10% cho đơn từ 300.000đ." */
export function offerSummary(o: OfferLike): string {
  const value = money(o.value);
  const min = money(o.minSubtotal);
  const head = o.discountType === 'PERCENT' ? `Giảm ${value}%` : `Giảm ${fmtVnd(value)}`;
  return min > 0 ? `${head} cho đơn từ ${fmtVnd(min)}.` : `${head} cho đơn của bạn.`;
}

/** Chuan hoa ma: in hoa, bo khoang trang */
export function normalizeOfferCode(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}
