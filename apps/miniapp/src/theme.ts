// Ap mau chu dao cua quan (stores.settings.themeColor) vao bien CSS cua thiet ke v2.
// Giu hue tu themeColor, cham do no an toan, san sang cho moi mau quan chon.
//   --red       : nut chinh, gia, nut them mon
//   --red-dark  : trang thai hover/nhan cua nut chinh
//   --pink      : nen nhat cua chip, ghi chu, trang thai nhan manh

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(clamp(l, 3, 97))}%)`;
}

let appliedColor: string | null = null;

/** Go tri themeColor cua quan; null/hoac mau khong hop le giu mau mac dinh */
export function applyTheme(themeColor: string | null | undefined): void {
  const color = typeof themeColor === 'string' ? themeColor.trim() : null;
  if (color === appliedColor) return;
  appliedColor = color;
  const c = color ? hexToHsl(color) : null;
  if (!c) return;
  const [h, s] = c;
  const sat = clamp(s, 45, 90);
  const root = document.documentElement;
  root.style.setProperty('--red', hsl(h, sat, 44));
  root.style.setProperty('--red-dark', hsl(h, sat, 36));
  root.style.setProperty('--pink', hsl(h, sat, 96));
}
