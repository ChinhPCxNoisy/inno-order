import { useCallback, useEffect, useState } from 'react';
import { ApiError, errMsg, publicApi } from './api';
import type { PublicOrderTracking } from './types';

export const FINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIAL_REFUND'];

/**
 * Tai don theo id va poll 3s den khi don ket thuc (BRD FR-CUST-11).
 * Loi mang tam thoi tu retry (3s, 6s); sau 3 lan that bai moi bao loi.
 * Quay lai tab/app (vd. tu app ngan hang) thi tai lai ngay.
 */
export function useOrder(orderId: string | undefined, poll = true) {
  const [order, setOrder] = useState<PublicOrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** API 404: don khong ton tai (hoac sai duong dan) — khong thu lai */
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setError(null);
    setNotFound(false);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let timer: number | undefined;
    let cancelled = false;
    let fails = 0;
    const load = () => {
      publicApi
        .trackOrder(orderId)
        .then((o) => {
          if (cancelled) return;
          fails = 0;
          setOrder(o);
          if (poll && !FINAL_STATUSES.includes(o.status)) timer = window.setTimeout(load, 3000);
        })
        .catch((e) => {
          if (cancelled) return;
          // don khong ton tai: bao ngay, khong thu lai
          if (e instanceof ApiError && e.status === 404) {
            setNotFound(true);
            return;
          }
          fails += 1;
          if (fails >= 3) setError(errMsg(e));
          else timer = window.setTimeout(load, 3000 * fails);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [orderId, tick, poll]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return { order, error, notFound, reload };
}
