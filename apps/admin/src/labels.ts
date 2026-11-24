export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ xử lý', cls: 'amber' },
  ACCEPTED: { label: 'Đã nhận', cls: 'blue' },
  PREPARING: { label: 'Đang chế biến', cls: 'blue' },
  READY: { label: 'Sẵn sàng', cls: 'green' },
  COMPLETED: { label: 'Đã thanh toán', cls: 'grey' },
  CANCELLED: { label: 'Đã huỷ', cls: 'red' },
  REFUNDED: { label: 'Đã hoàn tiền', cls: 'red' },
  PARTIAL_REFUND: { label: 'Hoàn một phần', cls: 'amber' },
};

export const ITEM_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ nhận', cls: 'amber' },
  ACCEPTED: { label: 'Đã nhận', cls: 'blue' },
  PREPARING: { label: 'Đang làm', cls: 'blue' },
  READY: { label: 'Chờ mang ra', cls: 'green' },
  SERVED: { label: 'Đã phục vụ', cls: 'grey' },
  CANCELLED: { label: 'Đã huỷ', cls: 'red' },
};

export const TABLE_STATUS: Record<string, { label: string; cls: string }> = {
  AVAILABLE: { label: 'Trống', cls: 'green' },
  OCCUPIED: { label: 'Đang dùng', cls: 'amber' },
  NEED_CLEAN: { label: 'Cần dọn', cls: 'grey' },
  CLEANED: { label: 'Đã dọn', cls: 'blue' },
  RESERVED: { label: 'Đặt trước', cls: 'grey' },
  LOCKED: { label: 'Tạm khóa', cls: 'grey' },
};

export const TABLE_STATUS_CHANGEABLE = ['AVAILABLE', 'OCCUPIED', 'NEED_CLEAN', 'LOCKED'];

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Quản trị nền tảng',
  OWNER: 'Chủ quán',
  MANAGER: 'Quản lý',
  CASHIER: 'Thu ngân',
  WAITER: 'Phục vụ',
  KITCHEN: 'Bếp / Bar',
};

export const PAY_METHOD: Record<string, string> = {
  CASH: 'Tiền mặt',
  TRANSFER: 'Chuyển khoản',
  QR_BANK: 'QR banking',
  CARD: 'Thẻ',
  WALLET: 'Ví điện tử',
};

export const ORDER_SOURCE: Record<string, string> = {
  QR: 'QR khách',
  POS: 'POS',
  ADMIN: 'Admin',
};

export const PRINTER_STATION: Record<string, string> = {
  KITCHEN: 'Bếp',
  BAR: 'Quầy bar',
  CASHIER: 'Thu ngân',
};

export const PRINTER_CONNECTION: Record<string, string> = {
  USB: 'USB',
  LAN: 'LAN',
  WIFI: 'WiFi',
  BLUETOOTH: 'Bluetooth',
};

export const PAPER_SIZE: Record<string, string> = {
  P58: '58mm',
  P80: '80mm',
};

export const MODULE_DEFS: { key: string; label: string; description: string }[] = [
  {
    key: 'staff_rating',
    label: 'Đánh giá nhân viên',
    description: 'Khách đánh giá nhân viên phục vụ ngay sau khi thanh toán xong (gói trả thêm phí).',
  },
];

export const REFUND_REASONS: { value: string; label: string }[] = [
  { value: 'WRONG_ITEM', label: 'Sai món' },
  { value: 'CUSTOMER_REFUSED', label: 'Khách từ chối' },
  { value: 'OPERATIONAL_ERROR', label: 'Lỗi vận hành' },
  { value: 'OTHER', label: 'Khác' },
];

/** Khu in cua danh muc / mon (TicketStation) */
export const TICKET_STATION: Record<string, string> = {
  KITCHEN: 'Bếp',
  BAR: 'Bar',
  NONE: 'Không in',
};

export const PRINTER_ENCODING: Record<string, { label: string; hint: string }> = {
  RASTER: { label: 'Ảnh raster (khuyến nghị)', hint: 'Chữ có dấu đúng trên mọi máy hỗ trợ in ảnh' },
  CP1258: { label: 'Bảng mã Windows-1258', hint: 'In nhanh, cần máy có bảng mã tiếng Việt (nhập số bảng mã)' },
  ASCII: { label: 'Không dấu', hint: 'Dự phòng cuối cùng' },
};

export const PRINTER_STATUS: Record<string, { label: string; cls: string }> = {
  ONLINE: { label: 'Trực tuyến', cls: 'green' },
  OFFLINE: { label: 'Ngoại tuyến', cls: 'grey' },
  ERROR: { label: 'Lỗi', cls: 'red' },
};

export const PRINTER_DETAIL: Record<string, string> = {
  PAPER_OUT: 'Hết giấy',
  COVER_OPEN: 'Nắp máy đang mở',
  UNREACHABLE: 'Agent không kết nối được máy in',
  ERROR: 'Máy in báo lỗi',
};

export const JOB_TYPE: Record<string, string> = {
  BILL: 'Bill thanh toán',
  PRE_BILL: 'Tạm tính',
  KITCHEN_TICKET: 'Phiếu bếp / bar',
  REPRINT: 'In lại',
  CANCEL: 'Phiếu huỷ món',
  TABLE_MOVE: 'Phiếu đổi bàn',
  DRAWER: 'Mở két',
  TEST: 'In thử',
};

export const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ in', cls: 'amber' },
  SENT: { label: 'Đang gửi', cls: 'blue' },
  PRINTED: { label: 'Đã gửi tới máy in', cls: 'green' },
  FAILED: { label: 'Lỗi', cls: 'red' },
  CANCELLED: { label: 'Đã huỷ', cls: 'grey' },
};

export const BILL_STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Chưa thanh toán', cls: 'amber' },
  PARTIALLY_PAID: { label: 'Đã thu một phần', cls: 'blue' },
  PAID: { label: 'Đã thanh toán', cls: 'green' },
  VOID: { label: 'Đã huỷ', cls: 'grey' },
  REFUNDED: { label: 'Đã hoàn tiền', cls: 'red' },
};

export const QR_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ khách chuyển', cls: 'amber' },
  PAID: { label: 'Đã thanh toán', cls: 'green' },
  PARTIALLY_PAID: { label: 'Mới nhận một phần', cls: 'blue' },
  EXPIRED: { label: 'Hết hạn', cls: 'grey' },
  CANCELLED: { label: 'Đã huỷ', cls: 'grey' },
  SUPERSEDED: { label: 'Hóa đơn đã đổi, cần tạo lại mã', cls: 'red' },
};

export const BANK_TXN_STATUS: Record<string, { label: string; cls: string; hint: string }> = {
  RECEIVED: { label: 'Mới nhận', cls: 'blue', hint: '' },
  MATCHED: { label: 'Đã khớp', cls: 'green', hint: 'Đã tự ghi nhận vào hóa đơn' },
  PARTIAL: { label: 'Thiếu tiền', cls: 'amber', hint: 'Khách chuyển thiếu so với mã QR' },
  OVERPAID: { label: 'Thừa tiền', cls: 'amber', hint: 'Khách chuyển dư, cần hoàn phần dư' },
  UNMATCHED: { label: 'Không khớp', cls: 'red', hint: 'Không tìm thấy mã đối soát trong nội dung' },
  DUPLICATE_PAYMENT: { label: 'Trùng thanh toán', cls: 'red', hint: 'Hóa đơn đã trả đủ bằng cách khác' },
  LATE_CLOSED: { label: 'Hóa đơn đã đóng', cls: 'red', hint: 'Hóa đơn đã huỷ hoặc hoàn tiền' },
  NEEDS_REVIEW: { label: 'Cần kiểm tra', cls: 'red', hint: 'Nhiều mã, sai tài khoản hoặc thiếu có điều kiện' },
  REFUND_PENDING: { label: 'Chờ chuyển trả', cls: 'amber', hint: 'Cần chuyển trả khách thủ công' },
  REFUNDED: { label: 'Đã chuyển trả', cls: 'grey', hint: '' },
  IGNORED: { label: 'Đã bỏ qua', cls: 'grey', hint: '' },
};

export const OFFER_STATE: Record<string, { label: string; cls: string }> = {
  AVAILABLE: { label: 'Đang áp dụng', cls: 'green' },
  PAUSED: { label: 'Tạm dừng', cls: 'grey' },
  NOT_STARTED: { label: 'Chưa bắt đầu', cls: 'blue' },
  EXPIRED: { label: 'Hết hạn', cls: 'grey' },
  EXHAUSTED: { label: 'Hết lượt', cls: 'amber' },
};

export const CONFIRMED_BY: Record<string, string> = { BANK_FEED: 'Tự động (tiền về)', CASHIER: 'Thu ngân xác nhận' };

/** Man hinh chinh sau khi dang nhap theo vai tro */
export const ROLE_HOME: Record<string, string> = {
  SUPER_ADMIN: '/stores',
  OWNER: '/',
  MANAGER: '/',
  CASHIER: '/pos',
  WAITER: '/service',
  KITCHEN: '/kitchen',
};
export const roleHome = (role?: string | null) => (role && ROLE_HOME[role]) || '/';
