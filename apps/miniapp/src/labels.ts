// Nhac tran trang thai don cho banh khach (BRD 7.1 buoc 11, man hinh 14.1-5)

export const ORDER_STATUS: Record<string, { label: string; step: number }> = {
  PENDING: { label: 'Quán đã nhận đơn, đang xử lý', step: 1 },
  ACCEPTED: { label: 'Đầu bếp đang chuẩn bị', step: 2 },
  PREPARING: { label: 'Đang chế biến', step: 3 },
  READY: { label: 'Món đã sẵn sàng — mời chờ nhân viên mang ra', step: 4 },
  COMPLETED: { label: 'Đơn đã thanh toán. Cảm ơn quý khách!', step: 5 },
  CANCELLED: { label: 'Đơn đã bị hủy. Vui lòng liên hệ nhân viên.', step: 0 },
  REFUNDED: { label: 'Đơn đã hoàn tiền.', step: 0 },
  PARTIAL_REFUND: { label: 'Đơn đã hoàn tiền một phần.', step: 0 },
};

export const ITEM_STATUS: Record<string, string> = {
  PENDING: 'Chờ',
  ACCEPTED: 'Đã nhận',
  PREPARING: 'Đang chế biến',
  READY: 'Sẵn sàng',
  SERVED: 'Đã phục vụ',
  CANCELLED: 'Đã huỷ',
};

/** Tag nhanh de khach chon khi danh gia (module staff_rating) — doi theo so sao */
export const REVIEW_TAGS_POSITIVE = ['Thân thiện', 'Phục vụ nhanh', 'Hỗ trợ nhiệt tình', 'Tư vấn rõ ràng'];

/** Nhan duoi hang sao (1-5) tren trang danh gia */
export const STAR_LABELS: Record<number, string> = {
  1: 'Rất không hài lòng',
  2: 'Chưa hài lòng',
  3: 'Bình thường',
  4: 'Hài lòng',
  5: 'Rất hài lòng',
};
export const REVIEW_TAGS_NEGATIVE = ['Phục vụ chậm', 'Thái độ chưa tốt', 'Món chưa ngon', 'Thiếu món', 'Quá ồn'];

/** Mau pill cho trang thai mon (Dang theo doi don) */
export const ITEM_STATUS_CLS: Record<string, string> = {
  PENDING: 'grey',
  ACCEPTED: 'amber',
  PREPARING: 'amber',
  READY: 'green',
  SERVED: 'green',
  CANCELLED: 'red',
};
