import type { CutMode } from './commands.js';

export type Encoding = 'raster' | 'cp1258' | 'ascii';

/** Cau hinh in cua mot may in (khong gom dia chi mang) */
export interface PrinterProfile {
  /** So cot ky tu o chu thuong (58mm = 32, 80mm = 48) */
  cols: number;
  /** Do rong anh raster tinh bang diem (58mm = 384, 80mm = 576), chia het cho 8 */
  dots: number;
  encoding: Encoding;
  /** So bang ma cho ESC t khi encoding = cp1258 (tuy model, xem README) */
  codePage: number;
  cutMode: CutMode;
  /** So dong day them truoc khi cat (bo qua voi cutMode *_feed) */
  feedBeforeCut: number;
  /** Chan xung ket tien: 0 hoac 1 */
  drawerPin: 0 | 1;
  /** Phong cho che do raster (mac dinh phong di kem goi) */
  fontRegular?: string;
  fontBold?: string;
}

export const PAPER_58 = { cols: 32, dots: 384 } as const;
export const PAPER_80 = { cols: 48, dots: 576 } as const;

/** Tao profile tu kho giay va ghi de rieng */
export function makeProfile(width: 58 | 80, overrides: Partial<PrinterProfile> = {}): PrinterProfile {
  const paper = width === 58 ? PAPER_58 : PAPER_80;
  return {
    ...paper,
    encoding: 'raster',
    codePage: 52,
    cutMode: 'partial',
    feedBeforeCut: 4,
    drawerPin: 0,
    ...overrides,
  };
}
