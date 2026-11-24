import { deflateSync } from 'node:zlib';
import { cmdRaster } from './commands.js';

/** Anh don sac, 1 byte/diem: 1 = den, 0 = trang */
export class Bitmap {
  readonly data: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(width * height);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x];
  }

  /** Dan anh src len vi tri (x, y), diem den de len diem trang (OR) */
  blit(src: Bitmap, x: number, y: number): void {
    for (let sy = 0; sy < src.height; sy++) {
      const dy = y + sy;
      if (dy < 0 || dy >= this.height) continue;
      for (let sx = 0; sx < src.width; sx++) {
        const dx = x + sx;
        if (dx < 0 || dx >= this.width) continue;
        if (src.data[sy * src.width + sx]) this.data[dy * this.width + dx] = 1;
      }
    }
  }

  /** Noi cac anh theo chieu doc vao mot anh co do rong cho truoc */
  static stack(parts: Bitmap[], width: number): Bitmap {
    const height = parts.reduce((s, p) => s + p.height, 0);
    const out = new Bitmap(width, height);
    let y = 0;
    for (const p of parts) {
      out.blit(p, 0, y);
      y += p.height;
    }
    return out;
  }

  /** Dong goi 8 diem/byte (MSB truoc) cho cac dong [from, to) */
  pack(from = 0, to = this.height): Buffer {
    const wb = Math.ceil(this.width / 8);
    const out = Buffer.alloc(wb * (to - from));
    for (let y = from; y < to; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[y * this.width + x]) out[(y - from) * wb + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  }

  /** Doi sang cac lenh GS v 0, chia dai de may in re khong tran bo dem */
  toRasterCommands(bandRows = 128): Buffer[] {
    const wb = Math.ceil(this.width / 8);
    const cmds: Buffer[] = [];
    for (let y = 0; y < this.height; y += bandRows) {
      const to = Math.min(this.height, y + bandRows);
      cmds.push(cmdRaster(wb, to - y, this.pack(y, to)));
    }
    return cmds;
  }

  /** Tao anh tu du lieu da dong goi (nguoc voi pack) */
  static fromPacked(width: number, height: number, packed: Buffer): Bitmap {
    const bm = new Bitmap(width, height);
    const wb = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (packed[y * wb + (x >> 3)] & (0x80 >> (x & 7))) bm.data[y * width + x] = 1;
      }
    }
    return bm;
  }

  /** PNG xam 1 bit (den = diem in) de nguoi kiem tra xem truoc */
  toPng(scale = 1): Buffer {
    const w = this.width * scale;
    const h = this.height * scale;
    const wb = Math.ceil(w / 8);
    const raw = Buffer.alloc((wb + 1) * h);
    for (let y = 0; y < h; y++) {
      const row = y * (wb + 1);
      for (let x = 0; x < w; x++) {
        const black = this.data[Math.floor(y / scale) * this.width + Math.floor(x / scale)];
        if (!black) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7); // PNG: 1 = trang
      }
    }
    return encodePng(w, h, 1, 0, raw);
  }
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Bo ma hoa PNG toi thieu (khong phu thuoc thu vien ngoai) */
export function encodePng(width: number, height: number, bitDepth: number, colorType: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
