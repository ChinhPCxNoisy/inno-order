export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN');
}

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtWaited(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 1440) return `${Math.floor(m / 1440)} ngày ${Math.floor((m % 1440) / 60)} giờ`;
  if (m >= 60) return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
}

/** "12 phút trước", "3 giờ trước", "19 ngày trước" */
export function fmtAgo(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'vừa xong';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

/** Yeu cau goi ban cho qua lau thi coi la cu (phut) */
export const STALE_CALL_MINUTES = 30;

export interface MethodRow {
  method: string;
  gross: number;
  count: number;
  refund: number;
  refundCount: number;
  /** Thuc thu = thu - hoan tien theo dung phuong thuc goc */
  net: number;
}

/** Gop byMethod (thu truoc hoan) va refundByMethod thanh tung dong theo phuong thuc */
export function methodRows(
  by: { method: string; amount: number; count: number }[],
  refunds: { method: string; amount: number; count: number }[] = [],
): MethodRow[] {
  const keys = [...new Set([...by.map((m) => m.method), ...refunds.map((m) => m.method)])];
  return keys.map((method) => {
    const g = by.find((m) => m.method === method);
    const r = refunds.find((m) => m.method === method);
    const gross = g?.amount ?? 0;
    const refund = r?.amount ?? 0;
    return { method, gross, count: g?.count ?? 0, refund, refundCount: r?.count ?? 0, net: gross - refund };
  });
}
