import { Bitmap } from './bitmap.js';
import {
  Align,
  CMD_INIT,
  cmdAlign,
  cmdBold,
  cmdCodePage,
  cmdCut,
  cmdDrawer,
  cmdFeed,
  cmdQr,
  cmdSize,
  LF,
  QrLevel,
} from './commands.js';
import { GlyphRasterizer, rasterizerFor } from './glyphs.js';
import type { PrinterProfile } from './profile.js';
import { encodeCp1258, removeDiacritics } from './vietnamese.js';

export interface LineStyle {
  align: Align;
  bold: boolean;
  w: number;
  h: number;
}

/**
 * Bo dung chuoi byte ESC/POS (thuan, khong phu thuoc phan cung).
 * - encoding ascii/cp1258: gui chu native (ESC t chon bang ma voi cp1258).
 * - encoding raster: moi dong chu duoc ve thanh anh va gui bang GS v 0.
 * Cac lenh khong phai chu (QR, cat, ket) luon la lenh native.
 */
export class EscPosBuilder {
  private readonly parts: Buffer[] = [];
  private pending: Bitmap[] = [];
  private cur: LineStyle = { align: 'left', bold: false, w: 1, h: 1 };
  private readonly raster: GlyphRasterizer | null;

  constructor(
    readonly profile: PrinterProfile,
    raster?: GlyphRasterizer,
  ) {
    this.raster = profile.encoding === 'raster' ? (raster ?? rasterizerFor(profile.fontRegular, profile.fontBold)) : null;
  }

  /** ESC @ roi (neu cp1258) chon bang ma */
  init(): this {
    this.parts.push(CMD_INIT);
    this.cur = { align: 'left', bold: false, w: 1, h: 1 };
    if (this.profile.encoding === 'cp1258') this.parts.push(cmdCodePage(this.profile.codePage));
    return this;
  }

  /** In mot dong chu (da xuong dong dung do rong) kem kieu */
  line(text: string, style: Partial<LineStyle> = {}): this {
    const st: LineStyle = { ...{ align: 'left', bold: false, w: 1, h: 1 }, ...style };
    if (this.raster) {
      this.pending.push(this.raster.line(text, st, this.profile.dots, st.align));
      return this;
    }
    if (st.align !== this.cur.align) this.parts.push(cmdAlign(st.align));
    if (st.bold !== this.cur.bold) this.parts.push(cmdBold(st.bold));
    if (st.w !== this.cur.w || st.h !== this.cur.h) this.parts.push(cmdSize(st.w, st.h));
    this.cur = st;
    const bytes = this.profile.encoding === 'cp1258' ? encodeCp1258(text) : Buffer.from(removeDiacritics(text), 'latin1');
    this.parts.push(bytes, Buffer.from([LF]));
    return this;
  }

  /** Day giay n dong (chu o che do raster duoc dua ra truoc) */
  feed(n: number): this {
    this.flushRaster();
    if (n > 0) this.parts.push(cmdFeed(n));
    return this;
  }

  qr(data: string, size = 6, ec: QrLevel = 'M', align: Align = 'center'): this {
    this.flushRaster();
    this.parts.push(cmdAlign(align), cmdQr(Buffer.from(data, 'utf8'), size, ec), Buffer.from([LF]), cmdAlign('left'));
    this.cur = { ...this.cur, align: 'left' };
    return this;
  }

  /** Cat giay; voi cutMode khong co *_feed thi day them feedBeforeCut dong de giay toi dao cat */
  cut(): this {
    this.flushRaster();
    const mode = this.profile.cutMode;
    if (mode === 'none') return this;
    if (mode === 'partial' || mode === 'full') this.parts.push(cmdFeed(this.profile.feedBeforeCut));
    this.parts.push(cmdCut(mode));
    return this;
  }

  /** Xung mo ket tien */
  drawer(): this {
    this.flushRaster();
    this.parts.push(cmdDrawer(this.profile.drawerPin));
    return this;
  }

  /** Gui anh raster 1 bit co san */
  image(bm: Bitmap): this {
    this.flushRaster();
    this.parts.push(...bm.toRasterCommands());
    return this;
  }

  raw(b: Buffer): this {
    this.flushRaster();
    this.parts.push(b);
    return this;
  }

  private flushRaster(): void {
    if (!this.pending.length) return;
    const page = Bitmap.stack(this.pending, this.profile.dots);
    this.pending = [];
    this.parts.push(...page.toRasterCommands());
  }

  build(): Buffer {
    this.flushRaster();
    return Buffer.concat(this.parts);
  }
}
