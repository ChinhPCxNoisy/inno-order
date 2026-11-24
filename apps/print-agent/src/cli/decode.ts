import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { decodeEscPos, renderPreviewText, writePreview } from '../preview/decode.js';

// Chay: npm run decode -- tep.bin [--cols 48] [--out thu-muc] [--annotate]
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { cols: { type: 'string', default: '48' }, out: { type: 'string' }, annotate: { type: 'boolean' }, encoding: { type: 'string', default: 'auto' } },
});
const file = positionals[0];
if (!file) {
  console.error('Cach dung: decode <tep.bin> [--cols 48] [--out thu-muc] [--annotate] [--encoding auto|cp1258|ascii]');
  process.exit(2);
}
const bytes = readFileSync(file);
const cols = Number(values.cols);
const items = decodeEscPos(bytes, { encoding: values.encoding as 'auto' });
console.log(renderPreviewText(items, { cols, annotate: values.annotate }));
if (values.out) {
  const base = path.basename(file, path.extname(file));
  const r = writePreview(path.resolve(values.out), base, bytes, cols);
  console.log(`\nDa ghi ${values.out}/${base}.txt${r.png ? ' va .png' : ''}`);
}
