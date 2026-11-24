import { readFileSync } from 'node:fs';
import { Bitmap } from './bitmap.js';

// Bo doc TrueType (glyf) + ve net thanh anh don sac. Tu viet de khong phu thuoc sharp/canvas
// (sharp tren Windows chi dung duoc phong cai trong he thong, khong nap duoc phong di kem).

type Pt = { x: number; y: number; on: boolean };
type Poly = Array<[number, number]>;

export class TtfFont {
  readonly unitsPerEm: number;
  private readonly buf: Buffer;
  private readonly tables = new Map<string, { off: number; len: number }>();
  private readonly locaLong: boolean;
  private readonly numGlyphs: number;
  private readonly numHMetrics: number;
  private cmap: (cp: number) => number = () => 0;
  private readonly outlineCache = new Map<number, Poly[]>();

  constructor(buf: Buffer) {
    this.buf = buf;
    const num = buf.readUInt16BE(4);
    for (let i = 0; i < num; i++) {
      const r = 12 + i * 16;
      this.tables.set(buf.toString('latin1', r, r + 4), { off: buf.readUInt32BE(r + 8), len: buf.readUInt32BE(r + 12) });
    }
    const head = this.table('head');
    this.unitsPerEm = buf.readUInt16BE(head + 18);
    this.locaLong = buf.readInt16BE(head + 50) === 1;
    this.numGlyphs = buf.readUInt16BE(this.table('maxp') + 4);
    this.numHMetrics = buf.readUInt16BE(this.table('hhea') + 34);
    this.table('glyf');
    this.table('loca');
    this.initCmap();
  }

  static load(path: string): TtfFont {
    return new TtfFont(readFileSync(path));
  }

  private table(name: string): number {
    const t = this.tables.get(name);
    if (!t) throw new Error(`Phong chu thieu bang ${name} (can TrueType co glyf)`);
    return t.off;
  }

  private initCmap(): void {
    const b = this.buf;
    const base = this.table('cmap');
    const n = b.readUInt16BE(base + 2);
    let best: { off: number; rank: number } | null = null;
    for (let i = 0; i < n; i++) {
      const pid = b.readUInt16BE(base + 4 + i * 8);
      const eid = b.readUInt16BE(base + 6 + i * 8);
      const off = base + b.readUInt32BE(base + 8 + i * 8);
      const fmt = b.readUInt16BE(off);
      let rank = 0;
      if (pid === 3 && eid === 10 && fmt === 12) rank = 3;
      else if (pid === 3 && eid === 1 && fmt === 4) rank = 2;
      else if (pid === 0 && (fmt === 4 || fmt === 12)) rank = 1;
      if (rank && (!best || rank > best.rank)) best = { off, rank };
    }
    if (!best) throw new Error('Phong chu khong co bang cmap Unicode ho tro');
    const off = best.off;
    if (b.readUInt16BE(off) === 12) {
      const groups = b.readUInt32BE(off + 12);
      this.cmap = (cp) => {
        for (let g = 0; g < groups; g++) {
          const o = off + 16 + g * 12;
          const s = b.readUInt32BE(o);
          const e = b.readUInt32BE(o + 4);
          if (cp >= s && cp <= e) return b.readUInt32BE(o + 8) + (cp - s);
        }
        return 0;
      };
    } else {
      const segX2 = b.readUInt16BE(off + 6);
      const endO = off + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      this.cmap = (cp) => {
        if (cp > 0xffff) return 0;
        for (let i = 0; i < segX2; i += 2) {
          if (cp > b.readUInt16BE(endO + i)) continue;
          const start = b.readUInt16BE(startO + i);
          if (cp < start) return 0;
          const delta = b.readInt16BE(deltaO + i);
          const ro = b.readUInt16BE(rangeO + i);
          if (ro === 0) return (cp + delta) & 0xffff;
          const gi = b.readUInt16BE(rangeO + i + ro + (cp - start) * 2);
          return gi === 0 ? 0 : (gi + delta) & 0xffff;
        }
        return 0;
      };
    }
  }

  glyphIndex(cp: number): number {
    return this.cmap(cp);
  }

  advance(glyph: number): number {
    const hmtx = this.table('hmtx');
    const i = Math.min(glyph, this.numHMetrics - 1);
    return this.buf.readUInt16BE(hmtx + i * 4);
  }

  /** Co chu (px) de be rong tien (advance) cua chu 'M' bang dung cellW diem anh */
  fontPxForCell(cellW: number): number {
    const adv = this.advance(this.glyphIndex(0x4d)) / this.unitsPerEm;
    return cellW / adv;
  }

  private glyphRange(g: number): [number, number] {
    const loca = this.table('loca');
    const glyf = this.table('glyf');
    if (g < 0 || g >= this.numGlyphs) return [0, 0];
    const a = this.locaLong ? this.buf.readUInt32BE(loca + g * 4) : this.buf.readUInt16BE(loca + g * 2) * 2;
    const z = this.locaLong ? this.buf.readUInt32BE(loca + g * 4 + 4) : this.buf.readUInt16BE(loca + g * 2 + 2) * 2;
    return [glyf + a, glyf + z];
  }

  /** Cac duong vien (da lam phang) cua glyph, don vi font */
  outline(g: number, depth = 0): Poly[] {
    const cached = this.outlineCache.get(g);
    if (cached) return cached;
    const res = this.buildOutline(g, depth);
    this.outlineCache.set(g, res);
    return res;
  }

  private buildOutline(g: number, depth: number): Poly[] {
    const b = this.buf;
    const [start, end] = this.glyphRange(g);
    if (end <= start || depth > 4) return [];
    const nContours = b.readInt16BE(start);
    let p = start + 10;
    if (nContours >= 0) {
      const endPts: number[] = [];
      for (let i = 0; i < nContours; i++, p += 2) endPts.push(b.readUInt16BE(p));
      const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
      p += 2 + b.readUInt16BE(p); // bo qua lenh hinting
      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = b[p++];
        flags.push(f);
        if (f & 8) {
          let r = b[p++];
          while (r-- > 0) flags.push(f);
        }
      }
      const xs: number[] = [];
      const ys: number[] = [];
      let v = 0;
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 2) v += f & 16 ? b[p++] : -b[p++];
        else if (!(f & 16)) {
          v += b.readInt16BE(p);
          p += 2;
        }
        xs.push(v);
      }
      v = 0;
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 4) v += f & 32 ? b[p++] : -b[p++];
        else if (!(f & 32)) {
          v += b.readInt16BE(p);
          p += 2;
        }
        ys.push(v);
      }
      const polys: Poly[] = [];
      let s = 0;
      for (const e of endPts) {
        const pts: Pt[] = [];
        for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        polys.push(flatten(pts));
        s = e + 1;
      }
      return polys;
    }
    // glyph ghep (vi du chu + dau thanh)
    const polys: Poly[] = [];
    let more = true;
    while (more) {
      const flag = b.readUInt16BE(p);
      const gi = b.readUInt16BE(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flag & 1) {
        dx = b.readInt16BE(p);
        dy = b.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = b.readInt8(p);
        dy = b.readInt8(p + 1);
        p += 2;
      }
      if (!(flag & 2)) {
        dx = 0; // khop theo diem (hiem), bo qua
        dy = 0;
      }
      let a = 1;
      let bb = 0;
      let c = 0;
      let d = 1;
      const f2 = (o: number) => b.readInt16BE(o) / 16384;
      if (flag & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flag & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flag & 0x80) {
        a = f2(p);
        bb = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      for (const poly of this.outline(gi, depth + 1)) {
        polys.push(poly.map(([x, y]) => [a * x + c * y + dx, bb * x + d * y + dy] as [number, number]));
      }
      more = !!(flag & 0x20);
    }
    return polys;
  }

  /**
   * Ve glyph vao anh cellW x cellH. Truc x/y co he so rieng (sx, sy: diem anh tren 1 don vi font)
   * de ho tro chu gian ngang/doc ma van nhin ro net. Dat goc (baseline) tai (originX, baselineY).
   */
  render(cp: number, cellW: number, cellH: number, sx: number, sy: number, baselineY: number, threshold: number): Bitmap {
    const bm = new Bitmap(cellW, cellH);
    let gi = this.glyphIndex(cp);
    if (gi === 0 && cp !== 0x3f) gi = this.glyphIndex(0x3f); // ky tu la -> dau hoi
    const polys = this.outline(gi);
    if (!polys.length) return bm;
    // doi sang toa do anh
    const edges: Array<[number, number, number, number]> = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        edges.push([x0 * sx, baselineY - y0 * sy, x1 * sx, baselineY - y1 * sy]);
      }
    }
    const SUB = 4;
    const cov = new Float32Array(cellW * cellH);
    for (let row = 0; row < cellH; row++) {
      for (let k = 0; k < SUB; k++) {
        const yc = row + (k + 0.5) / SUB;
        const xsx: Array<[number, number]> = [];
        for (const [x0, y0, x1, y1] of edges) {
          if (y0 === y1) continue;
          const up = y0 < y1;
          const ya = up ? y0 : y1;
          const yb = up ? y1 : y0;
          if (yc < ya || yc >= yb) continue;
          xsx.push([x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0), up ? 1 : -1]);
        }
        if (!xsx.length) continue;
        xsx.sort((a, b2) => a[0] - b2[0]);
        let wind = 0;
        for (let i = 0; i < xsx.length - 1; i++) {
          wind += xsx[i][1];
          if (wind === 0) continue;
          const xa = Math.max(0, xsx[i][0]);
          const xb = Math.min(cellW, xsx[i + 1][0]);
          if (xb <= xa) continue;
          for (let px = Math.floor(xa); px < Math.ceil(xb) && px < cellW; px++) {
            cov[row * cellW + px] += (Math.min(xb, px + 1) - Math.max(xa, px)) / SUB;
          }
        }
      }
    }
    for (let i = 0; i < cov.length; i++) bm.data[i] = cov[i] > threshold ? 1 : 0;
    return bm;
  }
}

/** Duong cong TrueType (diem on/off) -> da giac, 6 doan cho moi cung bac hai */
function flatten(pts: Pt[]): Poly {
  if (!pts.length) return [];
  // them diem on o giua hai diem off lien tiep
  const full: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    full.push(a);
    if (!a.on && !b.on) full.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  }
  let startIdx = full.findIndex((p) => p.on);
  if (startIdx < 0) return [];
  const ordered = [...full.slice(startIdx), ...full.slice(0, startIdx)];
  const poly: Poly = [[ordered[0].x, ordered[0].y]];
  let i = 1;
  let prev = ordered[0];
  while (i <= ordered.length) {
    const cur = ordered[i % ordered.length];
    if (cur.on) {
      poly.push([cur.x, cur.y]);
      prev = cur;
      i++;
    } else {
      const next = ordered[(i + 1) % ordered.length];
      const STEPS = 6;
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const mt = 1 - t;
        poly.push([mt * mt * prev.x + 2 * mt * t * cur.x + t * t * next.x, mt * mt * prev.y + 2 * mt * t * cur.y + t * t * next.y]);
      }
      prev = next;
      i += 2;
    }
  }
  return poly;
}
