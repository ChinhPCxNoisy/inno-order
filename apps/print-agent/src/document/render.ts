import { EscPosBuilder } from '../escpos/builder.js';
import type { GlyphRasterizer } from '../escpos/glyphs.js';
import type { PrinterProfile } from '../escpos/profile.js';
import { layoutDocument, Op } from './layout.js';
import type { Block, PrintDocument } from './types.js';

/** Loi do payload sai (khong the thu lai) */
export class DocumentError extends Error {
  readonly code = 'INVALID_PAYLOAD';
}

const BLOCK_TYPES = new Set(['text', 'kv', 'item', 'sep', 'qr', 'feed', 'cut', 'drawer']);
const MAX_BLOCKS = 2000;
const MAX_TEXT = 4000;

/** Kiem tra tai lieu JSON nhan tu server (khong tin du lieu ngoai) */
export function validateDocument(input: unknown): PrintDocument {
  const doc = input as { v?: unknown; blocks?: unknown };
  if (!doc || typeof doc !== 'object' || doc.v !== 1 || !Array.isArray(doc.blocks)) {
    throw new DocumentError('Tai lieu in khong hop le (can {v:1, blocks:[...]})');
  }
  if (doc.blocks.length > MAX_BLOCKS) throw new DocumentError('Tai lieu in qua dai');
  for (const b of doc.blocks as Block[]) {
    if (!b || typeof b !== 'object' || !BLOCK_TYPES.has((b as { t: string }).t)) {
      throw new DocumentError(`Khoi in khong hop le: ${JSON.stringify(b)?.slice(0, 80)}`);
    }
    for (const v of Object.values(b)) {
      if (typeof v === 'string' && v.length > MAX_TEXT) throw new DocumentError('Chuoi trong khoi in qua dai');
    }
    if (b.t === 'qr' && (typeof b.d !== 'string' || b.d.length === 0 || b.d.length > 1000)) {
      throw new DocumentError('Noi dung ma QR khong hop le (1-1000 ky tu)');
    }
  }
  return doc as PrintDocument;
}

/** Chuyen cac thao tac da bo cuc thanh byte ESC/POS */
export function encodeOps(ops: Op[], profile: PrinterProfile, raster?: GlyphRasterizer): Buffer {
  const b = new EscPosBuilder(profile, raster).init();
  for (const o of ops) {
    switch (o.op) {
      case 'line':
        b.line(o.text, { align: o.align, bold: o.bold, w: o.w, h: o.h });
        break;
      case 'qr':
        b.qr(o.data, o.size, o.ec);
        break;
      case 'feed':
        b.feed(o.n);
        break;
      case 'cut':
        b.cut();
        break;
      case 'drawer':
        b.drawer();
        break;
    }
  }
  return b.build();
}

/** Tai lieu -> byte ESC/POS cho mot may in */
export function renderDocument(doc: PrintDocument, profile: PrinterProfile, raster?: GlyphRasterizer): Buffer {
  return encodeOps(layoutDocument(validateDocument(doc), profile), profile, raster);
}
