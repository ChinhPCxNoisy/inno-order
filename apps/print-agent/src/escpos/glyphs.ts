import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Bitmap } from './bitmap.js';
import { TtfFont } from './ttf.js';

/** O ky tu chuan: 12 x 28 diem (chu 12 x 24 + khoang cach dong), tuong duong Font A cua may in 203dpi */
export const CELL_W = 12;
export const CELL_H = 28;
const BASELINE = 22;

export const DEFAULT_FONT_REGULAR = fileURLToPath(new URL('../../fonts/JetBrainsMono-Regular.ttf', import.meta.url));
export const DEFAULT_FONT_BOLD = fileURLToPath(new URL('../../fonts/JetBrainsMono-Bold.ttf', import.meta.url));

export interface GlyphStyle {
  bold: boolean;
  w: number; // he so rong 1..4
  h: number; // he so cao 1..4
}

/**
 * Bo ve chu raster: moi ky tu la mot o luoi co dinh (12*w x 28*h), nen bo cuc cot giong het
 * che do chu native. Ket qua cache theo (ky tu, dam, w, h).
 */
export class GlyphRasterizer {
  private readonly cache = new Map<string, Bitmap>();

  constructor(
    private readonly regular: TtfFont,
    private readonly bold: TtfFont,
    private readonly threshold = 0.42,
  ) {}

  static fromFiles(regularPath = DEFAULT_FONT_REGULAR, boldPath = DEFAULT_FONT_BOLD): GlyphRasterizer {
    if (!existsSync(regularPath)) throw new Error(`Khong tim thay phong chu: ${regularPath}`);
    const regular = TtfFont.load(regularPath);
    const bold = existsSync(boldPath) ? TtfFont.load(boldPath) : regular;
    return new GlyphRasterizer(regular, bold);
  }

  glyph(ch: string, style: GlyphStyle): Bitmap {
    const key = `${ch}|${style.bold ? 1 : 0}|${style.w}|${style.h}`;
    let bm = this.cache.get(key);
    if (!bm) {
      const font = style.bold ? this.bold : this.regular;
      const px = font.fontPxForCell(CELL_W) / font.unitsPerEm; // diem anh tren 1 don vi font
      bm = font.render(ch.codePointAt(0)!, CELL_W * style.w, CELL_H * style.h, px * style.w, px * style.h, BASELINE * style.h, this.threshold);
      this.cache.set(key, bm);
    }
    return bm;
  }

  /** Ve mot dong chu vao anh rong `dots`, can le theo align */
  line(text: string, style: GlyphStyle, dots: number, align: 'left' | 'center' | 'right'): Bitmap {
    const chars = Array.from(text);
    const cw = CELL_W * style.w;
    const bm = new Bitmap(dots, CELL_H * style.h);
    const textW = chars.length * cw;
    const x0 = align === 'left' ? 0 : align === 'center' ? Math.max(0, Math.floor((dots - textW) / 2)) : Math.max(0, dots - textW);
    chars.forEach((ch, i) => {
      if (ch !== ' ') bm.blit(this.glyph(ch, style), x0 + i * cw, 0);
    });
    return bm;
  }
}

let defaultRasterizer: GlyphRasterizer | null = null;

/** Bo ve dung chung (nap phong mot lan) */
export function getDefaultRasterizer(): GlyphRasterizer {
  if (!defaultRasterizer) defaultRasterizer = GlyphRasterizer.fromFiles();
  return defaultRasterizer;
}

export function rasterizerFor(regularPath?: string, boldPath?: string): GlyphRasterizer {
  if (!regularPath) return getDefaultRasterizer();
  return GlyphRasterizer.fromFiles(regularPath, boldPath ?? regularPath);
}
