import { ApiError, errMsg } from './api';

/** Co dau tieng Viet / ky tu ngoai ASCII: coi nhu thong bao may chu da la tieng Viet */
const isVietnamese = (s: string) => /[^\x00-\x7f]/.test(s);

/** Ma loi (code) kem trong body loi cua API, neu co */
export function errCode(e: unknown): string | undefined {
  if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
    const c = (e.detail as { code?: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

export function errExtra<T = unknown>(e: unknown, key: string): T | undefined {
  if (e instanceof ApiError && e.detail && typeof e.detail === 'object') {
    return (e.detail as Record<string, unknown>)[key] as T | undefined;
  }
  return undefined;
}

/**
 * Thong bao loi tieng Viet ro rang cho thao tac tien/hoa don/ban:
 * 403 khong co tieng Viet -> cau quyen, 409 trung/dong thoi -> huong dan tai lai, 0 -> mat ket noi.
 */
export function billErrMsg(e: unknown): string {
  if (!(e instanceof ApiError)) return errMsg(e);
  const code = errCode(e);
  if (e.status === 0) return 'Không thể kết nối máy chủ. Kiểm tra mạng rồi thử lại (giao dịch chưa được ghi nhận nếu chưa thấy thông báo thành công).';
  if (e.status === 403) {
    return isVietnamese(e.message) ? e.message : 'Bạn không có quyền thực hiện thao tác này.';
  }
  if (e.status === 409) {
    if (code === 'BILL_CLOSED') return 'Hóa đơn đã được thanh toán đủ hoặc đã đóng (có thể thu ngân khác vừa thu). Đã tải lại hóa đơn.';
    if (code === 'BILL_CHANGED') return 'Hóa đơn vừa thay đổi (có món gọi thêm, huỷ món hoặc thu ngân khác vừa thao tác). Đã tải lại, vui lòng kiểm tra rồi thử lại.';
    return isVietnamese(e.message) ? e.message : 'Thao tác bị trùng hoặc đồng thời với người khác, vui lòng tải lại.';
  }
  if (e.status === 401) return e.message;
  return e.message;
}

/** Khoa idempotency: 8-64 ky tu, sinh 1 lan cho moi lan bam */
export function newIdemKey(prefix = 'pay'): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const rnd =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '')
      : Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${prefix}-${rnd}`.slice(0, 60);
}
