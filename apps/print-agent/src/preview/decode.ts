import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bitmap } from '../escpos/bitmap.js';
import { decodeCp1258 } from '../escpos/vietnamese.js';

// Giai ma chuoi byte ESC/POS thanh van ban + anh de nguoi kiem tra xem phieu trong ra sao.
// Chi hieu cac lenh agent nay phat ra (va mot so lenh thong dung); lenh la duoc bo qua.

export type Item =
  | { type: 'text'; text: string; align: 'left' | 'center' | 'right'; bold: boolean; w: number; h: number }
  | { type: 'image'; bitmap: Bitmap }
  | { type: 'qr'; data: string }
  | { type: 'feed'; n: number }
  | { type: 'cut'; mode: string }
  | { type: 'drawer'; pin: number }
  | { type: 'init' };

export interface DecodeOptions {
  /** auto: cp1258 neu thay ESC t, nguoc lai ASCII/latin1 */
  encoding?: 'auto' | 'cp1258' | 'ascii';
}

export function decodeEscPos(buf: Buffer, opts: DecodeOptions = {}): Item[] {
  const items: Item[] = [];
  let align: 'left' | 'center' | 'right' = 'left';
  let bold = false;
  let w = 1;
  let h = 1;
  let cp = false;
  let line: number[] = [];
  const enc = () => (opts.encoding === 'cp1258' || (opts.encoding !== 'ascii' && cp) ? 'cp1258' : 'ascii');
  const flushLine = () => {
    const b = Buffer.from(line);
    line = [];
    const text = enc() === 'cp1258' ? decodeCp1258(b) : b.toString('latin1');
    items.push({ type: 'text', text, align, bold, w, h });
  };
  let i = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (c === 0x0a) {
      flushLine();
      i++;
    } else if (c === 0x0d) i++;
    else if (c === 0x1b) {
      const n = buf[i + 1];
      if (n === 0x40) {
        items.push({ type: 'init' });
        align = 'left';
        bold = false;
        w = h = 1;
        i += 2;
      } else if (n === 0x61) {
        align = (['left', 'center', 'right'] as const)[buf[i + 2] & 3] ?? 'left';
        i += 3;
      } else if (n === 0x45) {
        bold = !!(buf[i + 2] & 1);
        i += 3;
      } else if (n === 0x74) {
        cp = true;
        i += 3;
      } else if (n === 0x64) {
        if (line.length) flushLine();
        items.push({ type: 'feed', n: buf[i + 2] });
        i += 3;
      } else if (n === 0x70) {
        items.push({ type: 'drawer', pin: buf[i + 2] });
        i += 5;
      } else i += 3; // cac lenh ESC x n khac (1 tham so)
    } else if (c === 0x1d) {
      const n = buf[i + 1];
      if (n === 0x21) {
        w = ((buf[i + 2] >> 4) & 7) + 1;
        h = (buf[i + 2] & 7) + 1;
        i += 3;
      } else if (n === 0x56) {
        const m = buf[i + 2];
        const long = m === 65 || m === 66;
        items.push({ type: 'cut', mode: `GS V ${m}${long ? ' ' + buf[i + 3] : ''}` });
        i += long ? 4 : 3;
      } else if (n === 0x76 && buf[i + 2] === 0x30) {
        const wb = buf[i + 4] | (buf[i + 5] << 8);
        const rows = buf[i + 6] | (buf[i + 7] << 8);
        const data = buf.subarray(i + 8, i + 8 + wb * rows);
        const bm = Bitmap.fromPacked(wb * 8, rows, Buffer.from(data));
        const last = items[items.length - 1];
        if (last && last.type === 'image' && last.bitmap.width === bm.width) {
          items[items.length - 1] = { type: 'image', bitmap: Bitmap.stack([last.bitmap, bm], bm.width) }; // cac dai lien nhau thanh mot anh
        } else items.push({ type: 'image', bitmap: bm });
        i += 8 + wb * rows;
      } else if (n === 0x28 && buf[i + 2] === 0x6b) {
        const len = buf[i + 3] | (buf[i + 4] << 8);
        const cn = buf[i + 5];
        const fn = buf[i + 6];
        if (cn === 0x31 && fn === 0x50) items.push({ type: 'qr', data: buf.subarray(i + 8, i + 5 + len).toString('utf8') });
        i += 5 + len;
      } else i += 3;
    } else if (c === 0x10) i += 3;
    else {
      line.push(c);
      i++;
    }
  }
  if (line.length) flushLine();
  return items;
}

export interface TextPreviewOptions {
  cols?: number;
  /** In kem [B 2x2] truoc moi dong de thay kieu chu */
  annotate?: boolean;
}

/** Phieu duoi dang van ban (can le, cat giay, QR duoc the hien bang nhan) */
export function renderPreviewText(items: Item[], opts: TextPreviewOptions = {}): string {
  const cols = opts.cols ?? 48;
  const out: string[] = [];
  for (const it of items) {
    if (it.type === 'text') {
      const avail = Math.floor(cols / it.w);
      const len = Array.from(it.text).length;
      const pad = it.align === 'center' ? Math.floor((avail - len) / 2) : it.align === 'right' ? avail - len : 0;
      const tag = opts.annotate ? `[${it.bold ? 'B' : '-'} ${it.w}x${it.h}] ` : '';
      out.push(tag + ' '.repeat(Math.max(0, pad)) + it.text);
    } else if (it.type === 'image') out.push(`[ẢNH RASTER ${it.bitmap.width}x${it.bitmap.height} điểm - xem tệp PNG]`);
    else if (it.type === 'qr') out.push(`[QR: ${it.data}]`);
    else if (it.type === 'feed') for (let k = 0; k < it.n; k++) out.push('');
    else if (it.type === 'cut') out.push(`---------- CẮT GIẤY (${it.mode}) ----------`);
    else if (it.type === 'drawer') out.push(`[MỞ KÉT TIỀN, chân ${it.pin}]`);
  }
  return out.join('\n');
}

/** Ghep cac anh raster (kem khung cho QR, vach cho cat giay) thanh mot anh de xem */
export function renderPreviewImage(items: Item[]): Bitmap | null {
  const parts: Bitmap[] = [];
  const W = Math.max(384, ...items.map((i) => (i.type === 'image' ? i.bitmap.width : 0)));
  for (const it of items) {
    if (it.type === 'image') parts.push(it.bitmap);
    else if (it.type === 'qr') parts.push(qrPlaceholder(W));
    else if (it.type === 'cut') parts.push(cutLine(W));
  }
  if (!items.some((i) => i.type === 'image' || i.type === 'qr')) return null;
  const width = Math.max(...parts.map((p) => p.width));
  return Bitmap.stack(parts, width);
}

function qrPlaceholder(W: number): Bitmap {
  const s = 120;
  const bm = new Bitmap(W, s + 8);
  const x0 = Math.floor((W - s) / 2);
  for (let k = 0; k < s; k++) {
    for (const [x, y] of [[k, 0], [k, s - 1], [0, k], [s - 1, k], [k, k], [k, s - 1 - k]]) bm.data[(y + 4) * W + x0 + x] = 1;
  }
  return bm;
}

function cutLine(W: number): Bitmap {
  const bm = new Bitmap(W, 10);
  for (let x = 0; x < W; x += 8) for (let k = 0; k < 4; k++) bm.data[5 * W + x + k] = 1;
  return bm;
}

/** Ghi base.bin, base.txt va (neu co raster/QR) base.png vao thu muc dir */
export function writePreview(dir: string, base: string, bytes: Buffer, cols: number): { text: string; png: boolean } {
  mkdirSync(dir, { recursive: true });
  const items = decodeEscPos(bytes);
  const text = renderPreviewText(items, { cols });
  writeFileSync(path.join(dir, `${base}.bin`), bytes);
  writeFileSync(path.join(dir, `${base}.txt`), text + '\n', 'utf8');
  const img = renderPreviewImage(items);
  if (img) writeFileSync(path.join(dir, `${base}.png`), img.toPng());
  return { text, png: !!img };
}
