// API client cho luong khach goi mon (public, khong can token)
// Chung backend voi Admin — chi dung nhom /api/v1/public/*

import type {
  ConfirmTableResponse,
  CreateOrderPayload,
  OfferCheckResult,
  QuoteResult,
  PublicBill,
  PublicMenu,
  PublicOffer,
  PublicOfferDetail,
  PublicOrder,
  PublicOrderTracking,
  PublicQr,
  PublicQrStatus,
  ReviewStatus,
  StoreBrand,
} from './types';

// Chi dong khi front deploy tren domain khac API (va API mo CORS cho domain do)
const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export interface QuoteItem {
  menuItemId: string;
  quantity: number;
  note?: string;
  options?: { groupName: string; optionName: string }[];
}

export type CallReason = 'CALL_STAFF' | 'WATER' | 'TOOLS' | 'BILL';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Ma loi nghiep vu cua API (vd SESSION_MOVED) va du lieu kem theo */
    public code?: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng.');
  }

  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    let code: string | undefined;
    let data: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
      if (typeof body.code === 'string') code = body.code;
      data = body;
    } catch {
      // body khong phai JSON
    }
    // 429: so giay cho lay tu header Retry-After (hoac retryAfter trong body)
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After')) || Number(data?.retryAfter) || 0;
      if (ra > 0) data = { ...(data ?? {}), retryAfter: ra };
    }
    throw new ApiError(res.status, message, code, data);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const publicApi = {
  confirmTable(storeSlug: string, tableCode: string) {
    return request<ConfirmTableResponse>(
      `/public/stores/${encodeURIComponent(storeSlug)}/tables/${encodeURIComponent(tableCode)}`,
    );
  },

  getMenu(storeSlug: string) {
    return request<PublicMenu>(`/public/stores/${encodeURIComponent(storeSlug)}/menu`);
  },

  createOrder(storeSlug: string, payload: CreateOrderPayload) {
    return request<PublicOrder>(`/public/stores/${encodeURIComponent(storeSlug)}/orders`, {
      method: 'POST',
      body: payload,
    });
  },

  trackOrder(orderId: string) {
    return request<PublicOrderTracking>(`/public/orders/${encodeURIComponent(orderId)}`);
  },

  /** Hoa don ban theo token phien (chi doc). 404 khi token sai hoac phien da ket thuc */
  getSession(token: string) {
    return request<PublicBill>(`/public/sessions/${encodeURIComponent(token)}`);
  },

  /** Hoa don ban theo id don cua khach (don cu chua luu token van xem duoc) */
  getOrderBill(orderId: string) {
    return request<PublicBill>(`/public/orders/${encodeURIComponent(orderId)}/bill`);
  },

  listOffers(storeSlug: string) {
    return request<PublicOffer[]>(`/public/stores/${encodeURIComponent(storeSlug)}/offers`);
  },

  getOffer(storeSlug: string, id: string) {
    return request<PublicOfferDetail>(
      `/public/stores/${encodeURIComponent(storeSlug)}/offers/${encodeURIComponent(id)}`,
    );
  },

  /** Kiem tra ma + giam du kien (khong tru luot, khong tru gio) */
  checkOffer(storeSlug: string, code: string, subtotal: number, items?: QuoteItem[]) {
    return request<OfferCheckResult>(`/public/stores/${encodeURIComponent(storeSlug)}/offers/check`, {
      method: 'POST',
      body: items ? { code, items } : { code, subtotal },
    });
  },

  /** Bao gia do server tinh (tam tinh, giam du kien, VAT, tong). Gioi han 60 lan/phut: phai debounce */
  quote(storeSlug: string, items: QuoteItem[], code?: string, signal?: AbortSignal) {
    return request<QuoteResult>(`/public/stores/${encodeURIComponent(storeSlug)}/quote`, {
      method: 'POST',
      body: { items, code: code || undefined },
      signal,
    });
  },

  /** Tao (hoac lay lai) ma QR cua hoa don ban; chi khi quan bat khach tu tra QR (403 neu tat) */
  createQr(sessionToken: string) {
    return request<PublicQr>(`/public/sessions/${encodeURIComponent(sessionToken)}/qr`, { method: 'POST', body: {} });
  },

  getQrStatus(intentId: string) {
    return request<PublicQrStatus>(`/public/payment-intents/${encodeURIComponent(intentId)}`);
  },

  getBrand(storeSlug: string) {
    return request<StoreBrand>(`/public/stores/${encodeURIComponent(storeSlug)}/brand`);
  },

  getReviewStatus(orderId: string) {
    return request<ReviewStatus>(`/public/orders/${encodeURIComponent(orderId)}/review`);
  },

  submitReview(
    orderId: string,
    payload: { rating: number; comment?: string; tags?: string[]; zaloUserId?: string },
  ) {
    return request<{ ok: boolean; staffName: string | null; rating: number }>(
      `/public/orders/${encodeURIComponent(orderId)}/review`,
      { method: 'POST', body: payload },
    );
  },

  callStaff(storeSlug: string, tableCode: string, payload: { reason?: CallReason; note?: string } = {}) {
    return request<{ id: string; status: string }>(
      `/public/stores/${encodeURIComponent(storeSlug)}/tables/${encodeURIComponent(tableCode)}/call-staff`,
      { method: 'POST', body: payload },
    );
  },
};

// Thong bao nghiep vu cua server co the khong dau (ban cu) -> doi sang cau tieng Viet de hieu
const KNOWN_MESSAGES: [RegExp, string][] = [
  [/tam khoa/i, 'Bàn đang tạm khóa. Vui lòng nhờ nhân viên hỗ trợ.'],
  [/ban khong ton tai/i, 'Không tìm thấy bàn này. Vui lòng quét lại mã QR trên bàn.'],
  [/mon khong ton tai|ngung ban/i, 'Có món trong giỏ vừa ngừng bán. Vui lòng kiểm tra lại giỏ món.'],
  [/tam ngung/i, 'Quán đang tạm dừng nhận đơn. Vui lòng liên hệ nhân viên.'],
  [
    /phien (khong ton tai|da ket thuc)|khong thuoc hoa don ban/i,
    'Hóa đơn của bàn không còn xem được (đã kết thúc hoặc không tìm thấy). Nếu cần, vui lòng nhờ nhân viên hỗ trợ.',
  ],
];

/** Bo dau de so khop thong bao server (co dau hoac khong dau) voi bang tren */
const stripVi = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

// Ky tu tieng Viet co dau: neu server tra ve cau co dau thi coi la thong bao danh cho khach
const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function statusMessage(status: number): string {
  if (status === 0) return 'Mất kết nối mạng. Vui lòng kiểm tra mạng rồi thử lại.';
  if (status === 429) return 'Bạn thao tác hơi nhanh. Vui lòng chờ vài giây rồi thử lại.';
  if (status === 404) return 'Không tìm thấy thông tin yêu cầu. Vui lòng quét lại mã QR trên bàn.';
  if (status === 408 || status === 504) return 'Kết nối chậm. Vui lòng thử lại sau ít giây.';
  if (status === 409) return 'Yêu cầu bị trùng hoặc đã thay đổi. Vui lòng kiểm tra lại rồi thử lại.';
  if (status >= 500) return 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.';
  if (status >= 400) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại giỏ món và thử lại.';
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

/** Thong bao than thien cho khach: khong lo thong bao ky thuat/khong dau cua server */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const n = Math.ceil(Number(e.data?.retryAfter) || 0);
      if (n > 0) return `Bạn thao tác quá nhanh, thử lại sau ${n} giây.`;
    }
    const plainMsg = stripVi(e.message);
    const known = KNOWN_MESSAGES.find(([re]) => re.test(plainMsg));
    if (known) return known[1];
    // 429/5xx luon dung cau chuan; 4xx khac giu nguyen cau tieng Viet co dau cua server (loi nghiep vu)
    if (e.status !== 429 && e.status < 500 && e.status !== 0 && VI_DIACRITICS.test(e.message)) return e.message;
    return statusMessage(e.status);
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}
