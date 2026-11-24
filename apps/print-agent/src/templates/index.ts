import { DocumentError, validateDocument } from '../document/render.js';
import type { JobPayload, PrintDocument } from '../document/types.js';
import { buildBill } from './bill.js';
import { buildCancelTicket, buildKitchenTicket } from './kitchen.js';
import { buildTestPage } from './test-page.js';

export { buildBill } from './bill.js';
export { buildCancelTicket, buildKitchenTicket } from './kitchen.js';
export { buildTestPage, SAMPLE_VN_LINE } from './test-page.js';
export { formatVnd } from './format.js';

/** Chuan hoa payload cua job thanh tai lieu in; 'raw' va 'drawer' do noi khac xu ly */
export function buildDocument(payload: JobPayload): PrintDocument {
  switch (payload.kind) {
    case 'document':
      return validateDocument(payload.document);
    case 'kitchen_ticket':
      return buildKitchenTicket(payload.data);
    case 'cancel_ticket':
      return buildCancelTicket(payload.data);
    case 'bill':
      return buildBill(payload.data);
    case 'test':
      return buildTestPage(payload.data);
    case 'drawer':
      return { v: 1, blocks: [{ t: 'drawer' }] };
    default:
      throw new DocumentError(`Loai payload khong ho tro: ${(payload as { kind?: string }).kind}`);
  }
}
