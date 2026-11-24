// Kieu du lieu phan ung cua API public (apps/api/src/public + services)

export interface PublicStore {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
}

/** Branding + cau hinh mini app cua quan (tu stores.settings, BRD FR-STORE-08) */
export interface StoreBrand {
  name: string;
  slug: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  themeColor: string | null;
  welcomeText: string | null;
  paymentNote: string | null;
  showVoucherTab: boolean;
  showZaloLogin: boolean;
}

export interface TableInfo {
  code: string;
  name: string;
  areaName: string;
  status: string;
  locked: boolean;
}

export interface ConfirmTableResponse {
  store: StoreBrand;
  table: TableInfo;
}

export interface MenuOption {
  id: string;
  groupName: string;
  optionName: string;
  extraPrice: number;
  isRequired: boolean;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  prepTimeMinutes: number | null;
  tags: unknown;
  options: MenuOption[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItem[];
}

export interface PublicMenu {
  store: StoreBrand;
  categories: MenuCategory[];
}

export interface CreateOrderItemPayload {
  menuItemId: string;
  quantity: number;
  note?: string;
  options?: { groupName: string; optionName: string }[];
}

export interface CustomerCapture {
  phone?: string;
  name?: string;
  marketingConsent?: boolean;
  transactionalConsent?: boolean;
}

/** Bao gia do server tinh: POST /public/stores/:slug/quote (cung cong thuc voi don/bill that) */
export interface QuoteResult {
  subtotal: number;
  discountAmount: number;
  vatEnabled: boolean;
  vatPercent: number;
  vatAmount: number;
  totalAmount: number;
  lines: { menuItemId: string; quantity: number; lineTotal: number }[];
  offer?: { valid: boolean; message: string; code?: string; headline?: string; discountAmount?: number };
}

export interface CreateOrderPayload {
  tableId?: string;
  tableCode?: string;
  items: CreateOrderItemPayload[];
  customerNote?: string;
  customer?: CustomerCapture;
  /** Khoa chong gui trung (toi da 64 ky tu): gui lai cung gia tri thi server tra ve don da tao */
  clientRequestId?: string;
  /** Token phien ban (luu tren thiet bi sau lan gui dau): gui them thi don vao dung phien/ban du ban da doi */
  sessionToken?: string;
  /** Ma uu dai khach khai bao (chi luu vao don, KHONG giam gia gio; nhan vien ap khi thanh toan) */
  voucherCode?: string;
}

export interface OrderItemPublic {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  totalAmount: number;
  note: string | null;
  status: string;
  createdAt: string;
  options: { optionGroup: string; optionValue: string; extraPrice: number }[];
}

export interface PublicOrder {
  id: string;
  storeId: string;
  tableId: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  customerNote: string | null;
  source: string;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  items: OrderItemPublic[];
  /** Token phien ban (chi tra khi phien dang mo; bi mat, chi giu tren thiet bi) */
  sessionToken?: string;
  /** Ma ban HIEN TAI cua don (co the khac ban khach da quet neu quan da doi ban) */
  tableCode?: string;
}

export interface ReviewStatus {
  enabled: boolean;
  reviewed?: boolean;
  eligible?: boolean;
  staffName?: string | null;
  rating?: number;
  comment?: string | null;
  tags?: string[];
}

export interface PublicOrderTracking {
  orderNumber: string;
  storeName: string;
  table: { code: string; name: string };
  /** Quan vua doi ban trong 6 gio gan day (ban cu + thoi diem); API cu co the chua tra */
  tableMovedFrom?: { code: string; at: string } | null;
  status: string;
  totalAmount: number;
  createdAt: string;
  /** Ghi chu don cua khach (API cu co the chua tra) */
  customerNote?: string | null;
  items: {
    name: string;
    quantity: number;
    totalAmount: number;
    note: string | null;
    status: string;
    /** Lua chon da chon cua mon (API cu co the chua tra) */
    options?: { group: string; value: string }[];
  }[];
}

/** Hoa don ban (chi doc) cho khach: GET /public/sessions/:token va GET /public/orders/:id/bill */
export interface PublicBillItem {
  name: string;
  quantity: number;
  totalAmount: number;
  status: string;
  options: { group: string; value: string }[];
}

export interface PublicBillOrder {
  id: string;
  orderNumber: string;
  /** Dot goi (1, 2, ...) */
  round: number;
  status: string;
  createdAt: string;
  items: PublicBillItem[];
}

export interface PublicBillDiscount {
  type: 'VOUCHER' | 'MANUAL';
  label: string;
  code: string | null;
  title: string | null;
  amount: number;
}

export interface PublicBillSummary {
  /** null khi ban chua tao hoa don (chi co tam tinh) */
  billStatus: string | null;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  remaining: number;
}

export interface PublicBill {
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  storeName: string;
  table: { code: string; name: string; areaName: string };
  tables: { code: string; name: string }[];
  movedFrom?: { code: string; at: string } | null;
  /** Quan bat "khach tu tra QR" va co tai khoan nhan tien dang hoat dong (API cu khong tra: coi nhu tat) */
  customerCanPayQr?: boolean;
  /** Dong giam gia cho khach: loai + ma uu dai + so tien (khong co ly do noi bo) */
  discounts?: PublicBillDiscount[];
  summary: PublicBillSummary;
  orders: PublicBillOrder[];
}

/** Uu dai cong khai: GET /public/stores/:slug/offers (chi uu dai listed, dang hieu luc, con luot) */
export interface PublicOffer {
  id: string;
  code: string;
  tagline: string | null;
  headline: string;
  subtitle: string | null;
  /** "Giam 10% cho don tu 300.000d." do server sinh */
  summary: string;
  discountType: 'PERCENT' | 'AMOUNT';
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  endsAt: string | null;
  limited: boolean;
}

/** GET /public/stores/:slug/offers/:id (uu dai het han/het luot van tra de hien mo) */
export interface PublicOfferDetail extends PublicOffer {
  description: string | null;
  state: 'AVAILABLE' | 'PAUSED' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED';
  /** Dieu kien ap dung do server sinh (ke ca extraTerms) */
  conditions: string[];
  /** Cau luu y dung thuc te: chi ap dung khi quan xac nhan */
  note: string;
}

export type OfferCheckResult =
  | { valid: true; code: string; headline: string; discountAmount: number; message: string }
  | { valid: false; message: string };

/** QR thanh toan cua khach: POST/GET /public/sessions/:token/qr */
export interface PublicQr {
  intentId: string;
  code: string;
  status: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  expiresAt: string;
  /** Chuoi VietQR: mini app ve anh QR tu chuoi nay */
  qrPayload: string;
  bank: { bankName: string; accountNumber: string; accountName: string };
  createdAt: string;
}

/** GET /public/payment-intents/:id (poll 2 giay) */
export interface PublicQrStatus {
  status: 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'EXPIRED' | 'CANCELLED' | 'SUPERSEDED';
  amount: number;
  paidAmount: number;
  remaining: number;
  expiresAt: string;
  paidAt: string | null;
}
