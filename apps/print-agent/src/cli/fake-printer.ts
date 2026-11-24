import path from 'node:path';
import { parseArgs } from 'node:util';
import { decodeEscPos, renderPreviewText, writePreview } from '../preview/decode.js';
import { FakePrinter } from '../mock/fake-printer.js';

// Chay: npm run fake-printer -- --port 19100 --out ./fake-printer-out --cols 48
const { values } = parseArgs({
  options: { port: { type: 'string', default: '19100' }, out: { type: 'string', default: './fake-printer-out' }, cols: { type: 'string', default: '48' } },
});
const out = path.resolve(values.out!);
const cols = Number(values.cols);
const printer = new FakePrinter({ port: Number(values.port), outDir: out });
const port = await printer.start();
console.log(`May in gia lap dang nghe 127.0.0.1:${port}; tep ghi vao ${out}`);
let seen = 0;
setInterval(() => {
  while (seen < printer.received.length) {
    const r = printer.received[seen++];
    console.log(`\n===== PHIẾU #${seen} (${r.bytes.length} byte) =====`);
    console.log(renderPreviewText(decodeEscPos(r.bytes), { cols }));
    writePreview(out, `receipt-${seen}`, r.bytes, cols);
  }
}, 300);
process.on('SIGINT', () => void printer.stop().then(() => process.exit(0)));
