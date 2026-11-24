/** Prisma Decimal -> number de phan hoi API sap xep */
export function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value) || 0;
}

/**
 * Lam tron theo cau hinh cua quan: nearest_100 | none.
 * Tien Viet khong co phan le: 'none' van lam tron ve dong nguyen (half-up), khong giu xu.
 */
export function roundAmount(amount: number, rounding: string | undefined): number {
  if (rounding === 'nearest_100') return Math.round(amount / 100) * 100;
  return Math.round(amount);
}

/** Lam tron ve dong nguyen (half-up) - dung cho giam theo %, VAT, tong dong mon */
export function roundVnd(n: number): number {
  return Math.round(n);
}

/** Chuan hoa doi so thap phan thanh so ngan (2 chu so) */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
