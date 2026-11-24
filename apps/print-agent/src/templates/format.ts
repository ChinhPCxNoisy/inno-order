// Ham dinh dang dung chung cho mau phieu

export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** 1250000 -> "1.250.000" (tu viet de khong phu thuoc du lieu locale cua may quay) */
export function formatVnd(n: number): string {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? `-${s}` : s;
}

function parts(iso: string | undefined, tz: string): Record<string, string> | null {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "19:42" */
export function formatTime(iso: string | undefined, tz = DEFAULT_TZ): string {
  const p = parts(iso, tz);
  return p ? `${p.hour}:${p.minute}` : '--:--';
}

/** "12/11/2026 19:42" */
export function formatDateTime(iso: string | undefined, tz = DEFAULT_TZ): string {
  const p = parts(iso, tz);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '--/--/---- --:--';
}

/** Tuy chon mon -> "Cay: Vua" hoac chuoi giu nguyen */
export function optionText(o: { group?: string; value: string } | string): string {
  if (typeof o === 'string') return o;
  return o.group ? `${o.group}: ${o.value}` : o.value;
}
