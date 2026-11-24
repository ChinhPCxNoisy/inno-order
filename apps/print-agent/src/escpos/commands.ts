// Hang so lenh ESC/POS (chuan Epson, dung duoc cho hau het may in nhiet 58/80mm)
export const ESC = 0x1b;
export const GS = 0x1d;
export const DLE = 0x10;
export const LF = 0x0a;

/** ESC @ - khoi tao may in, xoa che do chu */
export const CMD_INIT = Buffer.from([ESC, 0x40]);
/** DLE EOT n - truy van trang thai thoi gian thuc (n=2 offline, n=4 giay) */
export const CMD_STATUS_OFFLINE = Buffer.from([DLE, 0x04, 0x02]);
export const CMD_STATUS_PAPER = Buffer.from([DLE, 0x04, 0x04]);

export type Align = 'left' | 'center' | 'right';
export type CutMode = 'partial' | 'full' | 'partial_feed' | 'full_feed' | 'none';
export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** ESC a n - can le */
export function cmdAlign(a: Align): Buffer {
  return Buffer.from([ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2]);
}

/** ESC E n - in dam */
export function cmdBold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

/** GS ! n - kich thuoc chu, w/h tu 1 den 4 (nhan doi, nhan ba...) */
export function cmdSize(w: number, h: number): Buffer {
  const cw = Math.min(4, Math.max(1, w)) - 1;
  const ch = Math.min(4, Math.max(1, h)) - 1;
  return Buffer.from([GS, 0x21, (cw << 4) | ch]);
}

/** ESC t n - chon bang ma ky tu (so hieu bang ma tuy model may in) */
export function cmdCodePage(n: number): Buffer {
  return Buffer.from([ESC, 0x74, n & 0xff]);
}

/** ESC d n - day giay n dong */
export function cmdFeed(n: number): Buffer {
  return Buffer.from([ESC, 0x64, Math.min(255, Math.max(0, n))]);
}

/** ESC p pin t1 t2 - xung mo ket tien (pin 0 = chan 2, pin 1 = chan 5) */
export function cmdDrawer(pin: 0 | 1 = 0): Buffer {
  return Buffer.from([ESC, 0x70, pin, 0x19, 0xfa]);
}

/**
 * Lenh cat giay. 'partial'/'full' dung GS V 1/0 (ham A, may nao cung hieu);
 * '*_feed' dung GS V 66/65 n (ham B, tu day giay toi dao cat) - mot so may re khong hieu.
 */
export function cmdCut(mode: CutMode): Buffer {
  switch (mode) {
    case 'partial':
      return Buffer.from([GS, 0x56, 0x01]);
    case 'full':
      return Buffer.from([GS, 0x56, 0x00]);
    case 'partial_feed':
      return Buffer.from([GS, 0x56, 66, 0x00]);
    case 'full_feed':
      return Buffer.from([GS, 0x56, 65, 0x00]);
    default:
      return Buffer.alloc(0);
  }
}

/** Cac lenh ma QR native (GS ( k), model 2 */
export function cmdQr(data: Buffer, size: number, level: QrLevel): Buffer {
  const ec = { L: 48, M: 49, Q: 50, H: 51 }[level];
  const sz = Math.min(16, Math.max(1, Math.round(size)));
  const len = data.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // model 2
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, sz]), // kich thuoc module
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec]), // muc sua loi
    Buffer.from([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30]),
    data,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // in
  ]);
}

/** GS v 0 m xL xH yL yH d... - in anh raster 1 bit (1 = diem den); width phai chia het cho 8 */
export function cmdRaster(widthBytes: number, rows: number, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]),
    data,
  ]);
}
