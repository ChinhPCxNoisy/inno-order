export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "25/10/2026 · 16:05" */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${date} · ${fmtTime(iso)}`;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Tach ten (quan/mon) thanh 1-2 dong nhu mau ("Lẩu Nướng / Phố Cổ"): tu 3 tu tro len ngat
 * sau tu thu hai (3 tu) hoac o giua (4 tu tro len); 1-2 tu giu nguyen mot dong.
 */
export function titleLines(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return [words.join(' ')];
  const cut = words.length === 3 ? 2 : Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

/** Doan gioi thieu: moi cau mot dong nhu mau (giu nguyen xuong dong co san trong du lieu) */
export function sentenceLines(text: string): string[] {
  return text
    .replace(/([.!?…])\s+(?=\S)/g, '$1\n')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Tach tam tinh va thue cua don: tong don (da gom VAT neu quan bat) tru tong cac mon dang con.
 * Chi tach khi chenh lech duong; khong thi thue = 0 (don khong VAT).
 */
export function orderBreakdown(order: {
  totalAmount: number;
  items: { totalAmount: number; status: string }[];
}): { subtotal: number; tax: number } {
  const subtotal = order.items.filter((it) => it.status !== 'CANCELLED').reduce((s, it) => s + it.totalAmount, 0);
  const tax = Math.round(order.totalAmount - subtotal);
  return tax > 0 ? { subtotal, tax } : { subtotal: order.totalAmount, tax: 0 };
}
