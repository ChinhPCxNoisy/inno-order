// Ma uu dai khach khai bao o gio (theo quan): chi la khai bao, nhan vien ap khi thanh toan

const key = (slug: string) => `innoorder_voucher_${slug}`;

export function getDeclaredVoucher(slug: string | undefined): string {
  if (!slug) return '';
  try {
    return localStorage.getItem(key(slug)) ?? '';
  } catch {
    return '';
  }
}

export function setDeclaredVoucher(slug: string, code: string) {
  try {
    if (code) localStorage.setItem(key(slug), code);
    else localStorage.removeItem(key(slug));
  } catch {
    // localStorage khong dung duoc: ma chi giu trong man hinh gio
  }
}

/** Chuan hoa giong server: in hoa, bo ky tu la, toi da 40 */
export function normVoucher(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}
