import path from 'node:path';
import { parseArgs } from 'node:util';
import { layoutDocument } from '../document/layout.js';
import { encodeOps } from '../document/render.js';
import { makeProfile } from '../escpos/profile.js';
import type { Encoding } from '../escpos/profile.js';
import { writePreview } from '../preview/decode.js';
import { buildSampleData } from '../samples.js';
import { buildBill, buildCancelTicket, buildKitchenTicket, buildTestPage } from '../templates/index.js';

// Chay: npm run sample -- --kind kitchen|cancel|bill|prebill|test --width 80 --encoding raster --out ./sample-out
const { values } = parseArgs({
  options: {
    kind: { type: 'string', default: 'kitchen' },
    width: { type: 'string', default: '80' },
    encoding: { type: 'string', default: 'raster' },
    out: { type: 'string', default: './sample-out' },
  },
});
const s = buildSampleData();
const docs = {
  kitchen: () => buildKitchenTicket(s.kitchen),
  cancel: () => buildCancelTicket(s.cancel),
  bill: () => buildBill(s.bill),
  prebill: () => buildBill({ ...s.bill, preBill: true, payments: [] }),
  test: () => buildTestPage({ printerName: 'Mau', at: '2026-11-12T12:00:00Z' }),
} as const;
const kind = values.kind as keyof typeof docs;
if (!docs[kind]) {
  console.error(`--kind phai la: ${Object.keys(docs).join(', ')}`);
  process.exit(2);
}
const width = values.width === '58' ? 58 : 80;
const profile = makeProfile(width, { encoding: values.encoding as Encoding });
const bytes = encodeOps(layoutDocument(docs[kind](), profile), profile);
const base = `${kind}-${width}-${values.encoding}`;
const r = writePreview(path.resolve(values.out!), base, bytes, profile.cols);
console.log(r.text);
console.log(`\nDa ghi ${values.out}/${base}.bin, .txt${r.png ? ', .png' : ''} (${bytes.length} byte)`);
