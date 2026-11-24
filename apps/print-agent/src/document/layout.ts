import type { Align, QrLevel } from '../escpos/commands.js';
import type { PrinterProfile } from '../escpos/profile.js';
import type { Block, PrintDocument, TextSize } from './types.js';

// Bo cuc tai lieu thanh cac thao tac in tren luoi ky tu co dinh (cols x dong).
// Tat ca chu deu duoc xuong dong o day (server khong cat dong), de ca 3 che do ma hoa cho cung bo cuc.

export interface LineOp {
  op: 'line';
  text: string;
  align: Align;
  bold: boolean;
  w: number;
  h: number;
}
export type Op =
  | LineOp
  | { op: 'qr'; data: string; size: number; ec: QrLevel }
  | { op: 'feed'; n: number }
  | { op: 'cut' }
  | { op: 'drawer' };

export const SIZE_DIMS: Record<TextSize, [number, number]> = {
  normal: [1, 1],
  tall: [1, 2],
  wide: [2, 1],
  big: [2, 2],
  huge: [3, 3],
};

/** Bo ky tu dieu khien (tranh chen lenh ESC/POS tu noi dung), doi tab thanh dau cach */
export function clean(s: unknown): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
}

export const len = (s: string): number => Array.from(s).length;

/** Xuong dong theo tu, khong cat giua chu; tu dai hon be rong thi cat cung theo ky tu. hang = thut dong cho dong tiep */
export function wrapText(input: string, width: number, hang = 0): string[] {
  const w = Math.max(1, width);
  const h = Math.min(hang, w - 1);
  const out: string[] = [];
  for (const para of clean(input).split('\n')) {
    let first = true;
    let line = '';
    const room = () => (first ? w : w - h);
    const push = (text: string) => {
      out.push((first ? '' : ' '.repeat(h)) + trimEnd(text));
      first = false;
    };
    for (const word of para.split(' ')) {
      if (word === '') continue;
      let rest = word;
      while (len(rest) > room()) {
        // tu qua dai: day dong dang do roi cat cung
        if (line !== '') {
          push(line);
          line = '';
        }
        const chars = Array.from(rest);
        const r = room();
        push(chars.slice(0, r).join(''));
        rest = chars.slice(r).join('');
      }
      const candidate = line === '' ? rest : line + ' ' + rest;
      if (len(candidate) <= room()) line = candidate;
      else {
        push(line);
        line = rest;
      }
    }
    push(line);
  }
  return out;
}

const trimEnd = (s: string) => s.replace(/ +$/, '');

export const padEnd = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - len(s)));
export const padStart = (s: string, n: number) => ' '.repeat(Math.max(0, n - len(s))) + s;

/** Mot dong hai cot: trai (xuong dong neu dai) va phai canh le phai tren dong dau */
export function kvLines(l: string, r: string, width: number): string[] {
  const left = clean(l);
  const right = clean(r);
  const rl = len(right);
  if (rl === 0) return wrapText(left, width);
  if (rl > width - 4) return [...wrapText(left, width), padStart(right, width)];
  const leftLines = wrapText(left, Math.max(1, width - rl - 1));
  const first = leftLines[0] ?? '';
  const out = [padEnd(first, width - rl) + right];
  out.push(...leftLines.slice(1));
  return out;
}

/** Be rong cot thanh tien theo kho giay */
export const amountWidth = (cols: number) => (cols >= 48 ? 12 : 10);

/** Dong mon: SL | ten | thanh tien, ten xuong dong thut vao, sub la cac dong phu */
export function itemLines(q: string, name: string, amount: string | undefined, sub: string[], cols: number): string[] {
  const qs = clean(q);
  const qtyW = Math.max(3, len(qs) + 1);
  const amt = clean(amount ?? '');
  const amtW = amt ? Math.max(amountWidth(cols), len(amt) + 1) : 0;
  const nameW = Math.max(4, cols - qtyW - amtW);
  const nameLines = wrapText(name, nameW);
  const out: string[] = [];
  nameLines.forEach((n, i) => {
    if (i === 0) out.push(padEnd(qs, qtyW) + (amt ? padEnd(n, nameW) + padStart(amt, amtW) : n));
    else out.push(' '.repeat(qtyW) + n);
  });
  for (const s of sub) {
    for (const l of wrapText(s, cols - qtyW)) out.push(' '.repeat(qtyW) + l);
  }
  return out;
}

export function layoutDocument(doc: PrintDocument, profile: PrinterProfile): Op[] {
  const ops: Op[] = [];
  const line = (text: string, align: Align, bold: boolean, w: number, h: number) =>
    ops.push({ op: 'line', text, align, bold, w, h });

  for (const b of doc.blocks) layoutBlock(b, profile, line, ops);
  return ops;
}

function layoutBlock(
  b: Block,
  profile: PrinterProfile,
  line: (text: string, align: Align, bold: boolean, w: number, h: number) => void,
  ops: Op[],
): void {
  const cols = profile.cols;
  switch (b.t) {
    case 'text': {
      const [w, h] = SIZE_DIMS[b.size ?? 'normal'];
      for (const l of wrapText(b.s, Math.floor(cols / w), b.hang ?? 0)) line(l, b.align ?? 'left', !!b.bold, w, h);
      return;
    }
    case 'kv': {
      const [w, h] = SIZE_DIMS[b.size ?? 'normal'];
      for (const l of kvLines(b.l, b.r, Math.floor(cols / w))) line(l, 'left', !!b.bold, w, h);
      return;
    }
    case 'item': {
      const h = b.size === 'tall' ? 2 : 1;
      for (const l of itemLines(b.q, b.n, b.a, b.sub ?? [], cols)) line(l, 'left', !!b.bold, 1, h);
      return;
    }
    case 'sep': {
      const ch = Array.from(clean(b.c ?? '-'))[0] ?? '-';
      line(ch.repeat(cols), 'left', false, 1, 1);
      return;
    }
    case 'qr':
      ops.push({ op: 'qr', data: String(b.d), size: b.size ?? 6, ec: b.ec ?? 'M' });
      return;
    case 'feed':
      ops.push({ op: 'feed', n: Math.min(20, Math.max(0, Math.round(b.n ?? 1))) });
      return;
    case 'cut':
      ops.push({ op: 'cut' });
      return;
    case 'drawer':
      ops.push({ op: 'drawer' });
      return;
  }
}

/** Ban van ban thuan cua cac thao tac (dung cho kiem thu va nhat ky), de doc giong phieu that */
export function opsToText(ops: Op[], cols: number): string {
  const out: string[] = [];
  for (const o of ops) {
    if (o.op === 'line') {
      const avail = Math.floor(cols / o.w);
      const t = o.text;
      const pad = o.align === 'center' ? Math.floor((avail - len(t)) / 2) : o.align === 'right' ? avail - len(t) : 0;
      out.push(' '.repeat(Math.max(0, pad)) + t);
    } else if (o.op === 'qr') out.push(`[QR: ${o.data}]`);
    else if (o.op === 'feed') for (let i = 0; i < o.n; i++) out.push('');
    else if (o.op === 'cut') out.push('---------- CAT GIAY ----------');
    else if (o.op === 'drawer') out.push('[MO KET TIEN]');
  }
  return out.join('\n');
}
