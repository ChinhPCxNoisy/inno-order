// Dinh nghia tai lieu in (payload cua job) - bam dac ta 02 muc A5.3, them khoi item cho cot mon/SL/thanh tien

import type { Align } from '../escpos/commands.js';
export type { Align };

/** normal = 1x1, tall = cao gap doi, wide = rong gap doi, big = 2x2, huge = 3x3 */
export type TextSize = 'normal' | 'tall' | 'wide' | 'big' | 'huge';

export interface TextBlock {
  t: 'text';
  s: string;
  align?: Align;
  size?: TextSize;
  bold?: boolean;
  /** Thut dong cho cac dong xuong dong (so cot, mac dinh 0) */
  hang?: number;
}
/** Hai cot trai/phai tren mot dong (vi du "Tam tinh ....... 100.000") */
export interface KvBlock {
  t: 'kv';
  l: string;
  r: string;
  size?: TextSize;
  bold?: boolean;
}
/** Dong mon: so luong | ten (tu xuong dong) | thanh tien; sub = cac dong phu thut vao (tuy chon, don gia, ghi chu) */
export interface ItemBlock {
  t: 'item';
  q: string;
  n: string;
  a?: string;
  sub?: string[];
  bold?: boolean;
  size?: 'normal' | 'tall';
}
export interface SepBlock {
  t: 'sep';
  c?: string;
}
export interface QrBlock {
  t: 'qr';
  d: string;
  /** Kich thuoc module 1..16 (mac dinh 6) */
  size?: number;
  ec?: 'L' | 'M' | 'Q' | 'H';
}
export interface FeedBlock {
  t: 'feed';
  n?: number;
}
export interface CutBlock {
  t: 'cut';
}
export interface DrawerBlock {
  t: 'drawer';
}

export type Block = TextBlock | KvBlock | ItemBlock | SepBlock | QrBlock | FeedBlock | CutBlock | DrawerBlock;

export interface PrintDocument {
  v: 1;
  blocks: Block[];
}

/** Du lieu phieu bep/bar (server gui JSON thuan, co dau day du) */
export interface KitchenTicketData {
  /** Nhan khu: "BEP", "BAR"... in tren dau phieu */
  stationLabel?: string;
  storeName?: string;
  tableCode: string;
  areaName?: string;
  orderNumber: number | string;
  /** Dot goi (1 = lan dau, tu 2 tro len la goi them) */
  round?: number;
  /** ISO 8601 */
  createdAt: string;
  /** Mui gio hien thi, mac dinh Asia/Ho_Chi_Minh */
  timeZone?: string;
  source?: 'QR' | 'POS' | string;
  staffName?: string;
  items: Array<{
    name: string;
    quantity: number;
    /** Tuy chon mon, vi du {group:"Cay", value:"Vua"} hoac chuoi san */
    options?: Array<{ group?: string; value: string } | string>;
    note?: string;
  }>;
  orderNote?: string;
  /** Co khi la phieu in lai */
  reprint?: { count: number };
}

/** Du lieu phieu huy mon */
export interface CancelTicketData {
  stationLabel?: string;
  tableCode: string;
  orderNumber: number | string;
  createdAt: string;
  timeZone?: string;
  items: Array<{ name: string; quantity: number; note?: string }>;
  reason?: string;
  staffName?: string;
  reprint?: { count: number };
}

export interface BillItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  options?: Array<{ group?: string; value: string } | string>;
  note?: string;
}

/** Du lieu bill / tam tinh (tien VND la so nguyen) */
export interface BillData {
  /** true = phieu tam tinh (chua thanh toan) */
  preBill?: boolean;
  store: { name: string; address?: string; phone?: string; taxCode?: string };
  billNo?: string;
  tableCode: string;
  /** Cac ban gop vao hoa don (neu co) */
  mergedTables?: string[];
  openedAt?: string;
  closedAt?: string;
  timeZone?: string;
  cashier?: string;
  /** Danh sach don gop; moi don co the hien tieu de khi co tu 2 don tro len */
  orders: Array<{ orderNumber: number | string; round?: number; createdAt?: string; items: BillItem[] }>;
  subtotal: number;
  discounts?: Array<{ label: string; amount: number }>;
  vatPercent?: number;
  vatAmount?: number;
  roundingAmount?: number;
  total: number;
  payments?: Array<{ method: string; amount: number; tendered?: number; change?: number }>;
  footerText?: string;
  /** Noi dung ma QR tra cuu (tuy chon) */
  qr?: string;
  reprint?: { count: number };
}

export interface TestPageData {
  printerName?: string;
  storeName?: string;
  /** ISO 8601 hoac bo trong de dung gio hien tai */
  at?: string;
  timeZone?: string;
  qr?: string;
}

export type JobPayload =
  | { kind: 'document'; document: PrintDocument }
  | { kind: 'kitchen_ticket'; data: KitchenTicketData }
  | { kind: 'cancel_ticket'; data: CancelTicketData }
  | { kind: 'bill'; data: BillData }
  | { kind: 'test'; data?: TestPageData }
  | { kind: 'drawer' }
  /** Byte ESC/POS da dung san tu server (base64); agent gui nguyen, khong sua */
  | { kind: 'raw'; base64: string };
