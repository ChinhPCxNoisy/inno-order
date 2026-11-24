import type { PrinterConfig } from './agent/config.js';
import { profileOf } from './agent/config.js';
import { layoutDocument, opsToText } from './document/layout.js';
import { DocumentError, encodeOps } from './document/render.js';
import type { JobPayload, PrintDocument } from './document/types.js';
import { EscPosBuilder } from './escpos/builder.js';
import { buildDocument } from './templates/index.js';
import { PrintError } from './transport/transport.js';

const MAX_RAW_BYTES = 4 * 1024 * 1024;

export interface RenderOptions {
  copies?: number;
  /** Yeu cau mo ket (chi co hieu luc neu may in khai bao co ket) */
  openDrawer?: boolean;
}

export interface RenderedJob {
  bytes: Buffer;
  /** Ban van ban de ghi nhat ky / xem truoc (rong voi payload raw) */
  text: string;
}

/** Payload cua job -> byte ESC/POS cho mot may in cu the. Loi dung phieu la loi khong the thu lai. */
export function renderJob(payload: JobPayload, printer: PrinterConfig, opts: RenderOptions = {}): RenderedJob {
  const profile = profileOf(printer);
  const copies = Math.min(5, Math.max(1, Math.round(opts.copies ?? 1)));
  try {
    if (payload.kind === 'raw') {
      if (typeof payload.base64 !== 'string' || payload.base64.length > MAX_RAW_BYTES * 1.4) {
        throw new DocumentError('Payload raw quá lớn hoặc sai định dạng');
      }
      const bytes = Buffer.from(payload.base64, 'base64');
      if (bytes.length === 0 || bytes.length > MAX_RAW_BYTES) throw new DocumentError('Payload raw rỗng hoặc quá lớn');
      return { bytes: Buffer.concat(Array.from({ length: copies }, () => bytes)), text: '' };
    }
    let doc: PrintDocument = buildDocument(payload);
    // may in co ket + job yeu cau mo ket: them xung ket vao cuoi
    if (opts.openDrawer && printer.drawer && payload.kind !== 'drawer') {
      doc = { v: 1, blocks: [...doc.blocks, { t: 'drawer' }] };
    }
    if (payload.kind === 'drawer') {
      // lenh mo ket khong can chu: gui thang, khong lap theo copies
      const b = new EscPosBuilder({ ...profile, encoding: 'ascii' }).init().drawer();
      return { bytes: b.build(), text: '[MO KET TIEN]' };
    }
    const ops = layoutDocument(doc, profile);
    const one = encodeOps(ops, profile);
    return { bytes: Buffer.concat(Array.from({ length: copies }, () => one)), text: opsToText(ops, profile.cols) };
  } catch (e) {
    if (e instanceof PrintError) throw e;
    if (e instanceof DocumentError) throw new PrintError('INVALID_PAYLOAD', e.message, false);
    throw new PrintError('RENDER_FAILED', `Không dựng được phiếu: ${(e as Error).message}`, false);
  }
}
