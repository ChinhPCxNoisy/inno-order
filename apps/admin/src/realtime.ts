import { useEffect, useRef } from 'react';
import { api, getToken } from './api';

/** Su kien don push tu API (xem apps/api/src/realtime) */
export interface OrderEvent {
  type:
    | 'order.created'
    | 'order.status'
    | 'table.call'
    | 'table.call_resolved'
    | 'table.moved'
    | 'print.failed'
    | 'print.recovered'
    | 'print.agent_offline'
    | 'print.printer_error'
    | 'payment.confirmed'
    | 'payment.partial'
    | 'payment.needs_review'
    | 'payment.expired'
    | 'ping';
  storeId: string;
  orderId: string;
  orderNumber: string;
  tableCode: string;
  tableName: string | null;
  status: string;
  totalAmount: number;
  source: string | null;
  createdAt: string;
  callId?: string;
  /** Du lieu rieng cua print.* / table.moved */
  data?: Record<string, unknown>;
}

type Listener = (e: OrderEvent) => void;

// Mot ket noi SSE dung chung cho toan bo man hinh (thong bao don, banner may in, POS, ...)
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let failCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function open() {
  if (es || retryTimer) return;
  const token = getToken();
  if (!token) return;
  const source = new EventSource(`/api/v1/realtime/events?token=${encodeURIComponent(token)}`);
  es = source;
  source.onmessage = (ev) => {
    failCount = 0;
    try {
      const data = JSON.parse(ev.data) as OrderEvent;
      if (data && typeof data === 'object' && typeof data.type === 'string') {
        listeners.forEach((l) => l(data));
      }
    } catch {
      // message khong hop le — bo qua
    }
  };
  source.onerror = () => {
    failCount += 1;
    // EventSource tu noi lai khi dut ket noi dang mo; nhung neu lan noi lai nhan loi HTTP (vd API khoi dong lai
    // tra 5xx) thi trinh duyet DONG han (CLOSED): tu mo lai sau vai giay, toi da 30 giay giua cac lan.
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      if (es === source) es = null;
      // token (JWT) het han thi SSE bi 401 va bi dong han: goi mot API co xac thuc, neu 401 thi api() tu dang xuat ve trang dang nhap
      void api('/auth/me').catch(() => undefined);
      if (failCount >= 40 || listeners.size === 0) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (listeners.size > 0) open();
      }, Math.min(30000, 2000 * failCount));
    }
  };
}

/**
 * Dang ky nhan su kien realtime (SSE /api/v1/realtime/events). EventSource tu dong
 * ket noi lai khi mat ket noi. Tra ve ham huy dang ky; het nguoi nghe thi dong ket noi.
 * Khong co token thi khong ket noi.
 */
export function connectRealtime(onEvent: Listener): () => void {
  listeners.add(onEvent);
  open();
  return () => {
    listeners.delete(onEvent);
    if (listeners.size === 0) {
      es?.close();
      es = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}

/**
 * Hook: goi handler (ban moi nhat) cho moi su kien cua quan dang chon. Dung de lam moi
 * ngam du lieu man hinh; nguoi goi tu loc loai su kien va debounce neu can.
 */
export function useRealtime(storeId: string | null | undefined, handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!storeId) return;
    return connectRealtime((e) => {
      if (e.type === 'ping' || e.storeId !== storeId) return;
      ref.current(e);
    });
  }, [storeId]);
}

/** Lam moi ngam (gop nhieu su kien lien tiep trong `delay` ms thanh 1 lan) khi co su kien thuoc `types` */
export function useRealtimeRefresh(
  storeId: string | null | undefined,
  types: OrderEvent['type'][],
  refresh: () => void,
  delay = 400,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typesRef = useRef(types);
  typesRef.current = types;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useRealtime(storeId, (e) => {
    if (!typesRef.current.includes(e.type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => refreshRef.current(), delay);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
