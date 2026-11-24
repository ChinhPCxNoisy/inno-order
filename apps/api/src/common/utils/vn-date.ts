/**
 * Ngay kinh doanh theo gio Viet Nam (Asia/Ho_Chi_Minh, UTC+7, khong co gio mua he),
 * khong phu thuoc mui gio cua tien trinh Node hay cua DB.
 */
import { BadRequestException } from '@nestjs/common';

export const VN_TZ = 'Asia/Ho_Chi_Minh';
const VN_OFFSET = '+07:00';

/** YYYY-MM-DD cua thoi diem d theo gio VN */
export function vnDateLabel(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Nhan ngay YYYY-MM-DD hop le (khong nhan 2026-13-45 hay 2026-02-30); sai -> 400 */
export function assertDateLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  const ok = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === label;
  if (!ok) throw new BadRequestException('Ngày không hợp lệ, định dạng đúng là YYYY-MM-DD');
  return label;
}

/** Dau ngay (00:00 gio VN) cua nhan YYYY-MM-DD */
export function vnDayStart(label: string): Date {
  return new Date(`${assertDateLabel(label)}T00:00:00.000${VN_OFFSET}`);
}

/** Cuoi ngay (23:59:59.999 gio VN) cua nhan YYYY-MM-DD */
export function vnDayEnd(label: string): Date {
  return new Date(`${assertDateLabel(label)}T23:59:59.999${VN_OFFSET}`);
}

/** Khoang [start, end) cua 1 ngay kinh doanh VN */
export function dayRange(dateStr?: string): { start: Date; end: Date; label: string } {
  const label = dateStr ?? vnDateLabel();
  const start = vnDayStart(label);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, label };
}
