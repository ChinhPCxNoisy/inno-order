// Ma hoa tieng Viet cho may in nhiet: bo dau (ASCII) va Windows-1258 (CP1258)

const PUNCT_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '·': '-',
  '•': '*',
  '×': 'x',
  '→': '->',
  '₫': 'd',
  ' ': ' ',
};

/** Bo dau tieng Viet dung cach (ca d/D co gach), ky tu la con lai thanh '?' */
export function removeDiacritics(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (ch === 'đ') out += 'd';
    else if (ch === 'Đ') out += 'D';
    else if (PUNCT_MAP[ch] !== undefined) out += PUNCT_MAP[ch];
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const b of base) {
        const c = b.codePointAt(0)!;
        out += (c >= 0x20 && c < 0x7f) || c === 0x0a ? b : '?';
      }
    }
  }
  return out;
}

let cp1258Table: Map<string, number> | null = null;

/** Bang ky tu -> byte cua Windows-1258, dung bo giai ma co san cua Node de khoi go tay */
function getCp1258Table(): Map<string, number> {
  if (cp1258Table) return cp1258Table;
  const dec = new TextDecoder('windows-1258');
  const t = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(Uint8Array.of(b));
    if (ch && ch !== '�' && !t.has(ch)) t.set(ch, b);
  }
  cp1258Table = t;
  return t;
}

/**
 * Ma hoa sang Windows-1258. Chu co dau chong (a mu + sac...) khong co trong bang ma nen duoc
 * tach thanh chu goc + dau thanh roi (U+0300, 0301, 0303, 0309, 0323). May in phai ho tro viec
 * in dau roi; neu khong se thay dau chen sai cho (xem README).
 */
export function encodeCp1258(s: string): Buffer {
  const table = getCp1258Table();
  const out: number[] = [];
  const push = (ch: string): boolean => {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      return true;
    }
    const b = table.get(ch);
    if (b === undefined) return false;
    out.push(b);
    return true;
  };
  for (const ch of s.normalize('NFC')) {
    if (push(ch)) continue;
    const mapped = PUNCT_MAP[ch];
    if (mapped !== undefined) {
      for (const m of mapped) push(m);
      continue;
    }
    const [base, ...marks] = Array.from(ch.normalize('NFD'));
    let cur = base;
    const rest: string[] = [];
    for (const m of marks) {
      const composed = (cur + m).normalize('NFC');
      if (Array.from(composed).length === 1 && (composed.codePointAt(0)! < 0x80 || table.has(composed))) cur = composed;
      else rest.push(m);
    }
    const okBase = cur.codePointAt(0)! < 0x80 || table.has(cur);
    if (okBase && rest.every((m) => table.has(m))) {
      push(cur);
      for (const m of rest) push(m);
    } else {
      for (const c of removeDiacritics(ch)) push(c);
    }
  }
  return Buffer.from(out);
}

/** Giai ma Windows-1258 va ghep dau roi ve dang NFC (dung cho cong cu xem truoc/kiem thu) */
export function decodeCp1258(b: Buffer): string {
  return new TextDecoder('windows-1258').decode(b).normalize('NFC');
}
