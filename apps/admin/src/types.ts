export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt?: string;
}

export interface MeData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  storeId: string | null;
  createdAt: string;
  store: { id: string; name: string; slug: string; logoUrl: string | null; status: string; settings?: StoreSettings } | null;
}

/** Cau hinh branding + mini app trong stores.settings (jsonb) */
export interface StoreSettings {
  bannerUrl?: string;
  themeColor?: string;
  welcomeText?: string;
  paymentNote?: string;
  showVoucherTab?: boolean;
  showZaloLogin?: boolean;
  /** Cai dat POS / in phieu (stores.settings.pos / printing) */
  payment?: { qrIntentTtlMinutes?: number; customerCanPayQr?: boolean; autoAcceptPartial?: boolean };
  pos?: { allowWaiterMoveTable?: boolean; discountLimits?: { cashierMaxPercent: number | null; cashierMaxAmount: number | null }; warnUnservedOnPay?: boolean };
  printing?: { mode?: 'AGENT' | 'KDS_ONLY'; autoPrintBill?: boolean; footerText?: string };
  [key: string]: unknown;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  settings: StoreSettings | null;
  enabledModules: string[];
  createdAt: string;
  tables: number;
  users: number;
  orders: number;
}

export interface MenuItemOption {
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
  active: boolean;
  prepTimeMinutes: number | null;
  sortOrder: number;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
  options: MenuItemOption[];
  /** Khu in rieng cua mon: null = theo danh muc */
  printStation?: TicketStation | null;
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  station?: TicketStation;
  items: MenuItem[];
}

export interface TableInfo {
  id: string;
  code: string;
  name: string | null;
  seats: number | null;
  status: string;
  qrCode: string | null;
  notes: string | null;
  updatedAt: string;
  openOrders: number;
  openAmount: number;
  /** Phien ban dang mo + hoa don (GET pos/tables) */
  sessionId?: string | null;
  billId?: string | null;
  billStatus?: string | null;
  billTotal?: number | null;
  billRemaining?: number | null;
}

export interface TableArea {
  id: string;
  name: string;
  sortOrder: number;
  tables: TableInfo[];
}

export interface TablesData {
  store: { id: string; name: string; slug: string; logoUrl: string | null } | null;
  areas: TableArea[];
}

export interface OrderItem {
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

export interface Order {
  id: string;
  storeId: string;
  tableId: string | null;
  orderNumber: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  customerNote: string | null;
  source: string;
  customerId: string | null;
  sessionId?: string | null;
  billId?: string | null;
  bill?: { id: string; billNo: string; status: string; totalAmount: number; paidAmount: number } | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  items: OrderItem[];
  table?: { code: string; name: string | null; area?: { name: string } };
  payments?: {
    id: string;
    amount: number;
    method: string;
    status: string;
    paidAt: string | null;
    receiptNo: string | null;
    payerLabel?: string | null;
  }[];
  waitedSeconds?: number;
  isLate?: boolean;
}

export interface OrderListResult {
  total: number;
  page: number;
  pageSize: number;
  data: Order[];
}

export interface DailyReport {
  date: string;
  revenue: number;
  grossRevenue: number;
  refundAmount: number;
  byMethod: { method: string; amount: number; count: number }[];
  /** Hoan tien theo dung phuong thuc goc (byMethod la tong thu truoc hoan) */
  refundByMethod?: { method: string; amount: number; count: number }[];
  orders: { created: number; completed: number; cancelled: number; refunded: number };
  topItems: { menuItemId: string; name: string; quantity: number; revenue: number }[];
  tableStatus: Record<string, number>;
}

export interface ItemReport {
  menuItemId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface PaymentReport {
  from: string;
  to: string;
  total: number;
  byMethod: Record<string, number>;
  byDay: { date: string; total: number; byMethod: Record<string, number> }[];
}

export interface StaffReportRow {
  userId: string;
  name: string;
  servedItems: number;
  servedTables: number;
  reviewCount: number;
  avgRating: number | null;
}

export interface StaffReport {
  from: string;
  to: string;
  staff: StaffReportRow[];
}

export interface Review {
  id: string;
  orderNumber: string;
  staffName: string | null;
  rating: number;
  comment: string | null;
  tags: string[];
  createdAt: string;
  zaloVerified: boolean;
  suspicious: boolean;
}

export interface TableCallRequest {
  id: string;
  tableCode: string;
  tableName: string | null;
  createdAt: string;
  reason?: string | null;
  note?: string | null;
}

export type TicketStation = 'KITCHEN' | 'BAR' | 'NONE';

export interface Printer {
  id: string;
  name: string;
  station: string;
  connection: string;
  host: string | null;
  port: number | null;
  deviceName: string | null;
  paperSize: string;
  charsPerLine: number;
  cutAtEnd: boolean;
  status: string;
  statusDetail?: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  agentId?: string | null;
  enabled?: boolean;
  priority?: number;
  encoding?: string;
  codePage?: number | null;
  openDrawer?: boolean;
  _count?: { jobs: number };
}

export interface PrintJob {
  id: string;
  jobType: string;
  status: string;
  content?: string | null;
  attemptCount: number;
  maxAttempts?: number;
  createdAt: string;
  sentAt: string | null;
  printedAt: string | null;
  failedReason: string | null;
  lastError?: string | null;
  errorCode?: string | null;
  nextAttemptAt?: string | null;
  acknowledgedAt?: string | null;
  copies?: number;
  billId?: string | null;
  printer: { id: string; name: string; station?: string } | null;
  order: { id: string; orderNumber: string } | null;
}

export interface PrintAgent {
  id: string;
  name: string;
  version: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  online: boolean;
  printers: { id: string; name: string }[];
}

/** Noi dung agent.config.json do may chu dien san (khoa/dang tuy phien ban agent) */
export type AgentConfig = Record<string, unknown>;

export interface PrintHealth {
  mode: 'AGENT' | 'KDS_ONLY';
  agents: { id: string; name: string; online: boolean; lastSeenAt: string | null; version: string | null }[];
  printers: {
    id: string;
    name: string;
    station: string;
    status: string;
    detail: string | null;
    enabled: boolean;
    agentId: string | null;
    agentOnline: boolean;
  }[];
  pendingJobs: number;
  failedJobs: number;
}

// ================= Hoa don ban / phien ban =================

export interface BillDiscount {
  id: string;
  kind: string;
  type: 'AMOUNT' | 'PERCENT';
  percent: number | null;
  amount: number;
  reason: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  offerId?: string | null;
}

export interface BillPayment {
  id: string;
  amount: number;
  method: string;
  status: string;
  paidAt: string | null;
  receiptNo: string | null;
  payerLabel: string | null;
  cashReceived: number | null;
  allocation: {
    mode: 'EVEN' | 'ITEMS';
    parts?: number;
    index?: number;
    lines?: { orderItemId: string; quantity: number }[];
  } | null;
  refundOfPaymentId: string | null;
  confirmedBy?: string | null;
  intentId?: string | null;
  refundStatus?: string | null;
}

export interface Bill {
  id: string;
  billNo: string;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'REFUNDED';
  version: number;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  discounts: BillDiscount[];
  payments: BillPayment[];
}

export interface SessionOrder {
  id: string;
  orderNumber: string;
  round: number;
  status: string;
  source: string;
  tableId: string;
  tableCode: string;
  createdAt: string;
  paidAt: string | null;
  customerNote: string | null;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  items: OrderItem[];
}

export interface SessionView {
  session: {
    id: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    openedVia: string;
    primaryTableId: string;
    guestCount: number | null;
  } | null;
  tables: { id: string; code: string; name: string | null; status: string; role: string; active: boolean }[];
  orders: SessionOrder[];
  bill: Bill | null;
  preview: { subtotal: number; discountAmount: number; vatAmount: number; totalAmount: number };
  unservedItems: number;
  requestedVoucherCodes?: string[];
}

// ================= VietQR / giao dich ngan hang / uu dai =================

export interface PaymentAccount {
  id: string;
  label: string;
  bankBin: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  provider: 'MANUAL' | 'MOCK';
  supportsWebhook: boolean;
  hasSecret: boolean;
  isActive: boolean;
  isDefault: boolean;
  verifiedAt: string | null;
  lastWebhookAt: string | null;
  createdAt: string;
}

export interface PaymentSettings {
  customerCanPayQr: boolean;
  qrIntentTtlMinutes: number;
  autoAcceptPartial: boolean;
  hasActiveAccount: boolean;
}

export interface OfferReport {
  from: string;
  to: string;
  totalConsumed: number;
  totalDiscount: number;
  byOffer: {
    offerId: string;
    code: string;
    headline: string;
    active: boolean;
    totalLimit: number | null;
    usedCount: number;
    consumedCount: number;
    totalDiscount: number;
    reservedCount: number;
    releasedCount: number;
  }[];
}

export interface QrIntent {
  intentId: string;
  code: string;
  status: 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'EXPIRED' | 'CANCELLED' | 'SUPERSEDED';
  amount: number;
  paidAmount: number;
  remaining: number;
  expiresAt: string;
  qrPayload: string;
  bank: { bankName: string; accountNumber: string; accountName: string };
  autoConfirm: boolean;
  createdAt: string;
  billId: string;
}

export interface BankTxn {
  id: string;
  accountId: string;
  providerTxnId: string;
  direction: string;
  amount: number;
  content: string | null;
  status: string;
  counterpartyName?: string | null;
  counterpartyAccountMasked?: string | null;
  transferredAt: string | null;
  receivedAt: string;
  intentId: string | null;
  billId: string | null;
  appliedAmount: number | null;
  excessAmount: number | null;
  resolutionNote: string | null;
}

export interface BankTxnList {
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
  data: BankTxn[];
}

export interface Reconciliation {
  date: string;
  bankInTotal: number;
  bankInCount: number;
  matchedAppliedTotal: number;
  pendingTotal: number;
  ignoredTotal: number;
  refundedTotal: number;
  qrPaymentTotal: number;
  qrAutoConfirmTotal: number;
  qrManualConfirmTotal: number;
  qrRefundTotal: number;
  unresolvedCount: number;
  unresolved: BankTxn[];
  mismatches: { type: string; txnId?: string; paymentId?: string; expected?: number; actual?: number }[];
  balanced: boolean;
}

export interface PendingRefund {
  paymentId: string;
  billId: string | null;
  amount: number;
  method: string;
  refundOfPaymentId: string | null;
  note: string | null;
  createdAt: string | null;
}

export interface Offer {
  id: string;
  code: string;
  tagline: string | null;
  headline: string;
  subtitle: string | null;
  description: string | null;
  discountType: 'PERCENT' | 'AMOUNT';
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  startsAt: string | null;
  endsAt: string | null;
  totalLimit: number | null;
  usedCount: number;
  stackable: boolean;
  listed: boolean;
  active: boolean;
  cashierCanApply: boolean;
  extraTerms: string[];
  state: 'AVAILABLE' | 'PAUSED' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED';
  conditions: string[];
}

export interface OfferRedemptions {
  offer: Offer;
  stats: { usedCount: number; reserved: number; consumed: number; released: number; totalDiscountConsumed: number; totalDiscountReserved: number };
  redemptions: {
    id: string;
    status: string;
    amount: number;
    billId: string;
    billNo: string | null;
    billStatus: string | null;
    overrideReason: string | null;
    createdAt: string;
    consumedAt: string | null;
    releasedAt: string | null;
  }[];
}
