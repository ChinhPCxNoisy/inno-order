import { useCallback, useEffect, useState } from 'react';
import { ApiError, errMsg, publicApi } from './api';
import { applyServerView, clearStoreSession, getOrders, getStoreSession, sessionMatchesTable } from './session';
import type { PublicBill } from './types';

/** Hoa don dang mo thi hoi lai moi 8 giay (GET /public/sessions gioi han 60 lan/phut/IP: giu thua) */
const POLL_MS = 8000;

/**
 * Hoa don cua ban (chi doc), giong cach useOrder: tai lan dau, poll nhe den khi phien dong,
 * loi mang tam thoi tu thu lai (sau 3 lan that bai moi bao loi), quay lai app thi tai lai ngay.
 * Nguon: token phien luu tren thiet bi; khong co (hoac het han) thi dung id don khach da gui.
 * Du lieu cu duoc giu nguyen khi dang tai lai nen man hinh khong nhap nhay.
 * `table` = ma ban dang mo (da doi theo ban cu/moi): khong hien hoa don cua ban khac (token phien cu cua ban khac,
 * hoac don gan nhat cua khach o ban khac) khi khong vao tu mot don cu the.
 */
export function useBill(storeSlug: string | undefined, orderHint: string | null, table: string | null = null) {
  const [bill, setBill] = useState<PublicBill | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Khong co token lan don de tra cuu (khach chua tung goi mon o day) */
  const [noSource, setNoSource] = useState(false);
  /** Hoa don dang xem lay theo token phien cua thiet bi (can token de tao QR) */
  const [viaToken, setViaToken] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setError(null);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!storeSlug) return;
    let timer: number | undefined;
    let cancelled = false;
    let fails = 0;
    let have = false;
    // don gan nhat cua khach o quan nay (don cu chua luu token van xem duoc hoa don)
    const T = table ? table.trim().toUpperCase() : null;
    const latestOrder = () => {
      if (orderHint) return orderHint;
      const mine = getOrders().filter((o) => o.storeSlug === storeSlug);
      return (mine.find((o) => !T || o.tableCode.toUpperCase() === T) ?? mine[0])?.orderId ?? null;
    };
    // hoa don co thuoc ban dang mo khong (ban hien tai, ban gop, hoac ban cu vua duoc doi)
    const belongs = (b: PublicBill) => {
      if (!T) return true;
      const codes = [b.table.code, ...b.tables.map((x) => x.code), b.movedFrom?.code ?? ''].map((c) => c.toUpperCase());
      return codes.includes(T);
    };

    const fetchBill = async (): Promise<{ b: PublicBill; viaToken: boolean } | null> => {
      const sess = getStoreSession(storeSlug);
      const token = sess?.token;
      // token cua phien o ban khac (khach quet QR ban moi) thi bo qua, khong lay hoa don cua ban kia
      if (token && (orderHint || sessionMatchesTable(sess, table))) {
        try {
          const b = await publicApi.getSession(token);
          // vao tu mot don cu the (man Theo doi don): chi dung hoa don theo token neu don do thuoc phien nay
          if (!orderHint || b.orders.some((o) => o.id === orderHint)) return { b, viaToken: true };
        } catch (e) {
          // token sai/phien da ket thuc: go token, thu lai bang id don
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          clearStoreSession(storeSlug);
        }
      }
      const oid = latestOrder();
      if (!oid) return null;
      const b = await publicApi.getOrderBill(oid);
      if (!orderHint && !belongs(b)) return null;
      return { b, viaToken: false };
    };

    const load = () => {
      fetchBill()
        .then((r) => {
          if (cancelled) return;
          fails = 0;
          have = true;
          if (!r) {
            setNoSource(true);
            setBill(null);
            return;
          }
          setNoSource(false);
          setViaToken(r.viaToken);
          // chi cap nhat state khi noi dung doi -> khong render lai/nhap nhay moi lan poll
          const b = r.b;
          setBill((prev) => (prev && JSON.stringify(prev) === JSON.stringify(b) ? prev : b));
          // dong bo ban/phien tren thiet bi (doi/gop ban, phien ket thuc) — chi khi xem dung phien cua minh (theo token)
          if (r.viaToken) applyServerView(storeSlug, b);
          if (b.status === 'OPEN') timer = window.setTimeout(load, POLL_MS);
        })
        .catch((e) => {
          if (cancelled) return;
          fails += 1;
          // 4xx nghiep vu (khong thuoc hoa don ban, het han...) khong thu lai; loi mang/429/5xx thu lai 3 lan
          const retryable = e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
          // da co hoa don tren man hinh thi giu nguyen, thu lai cham hon thay vi thay bang man loi
          if (have && retryable) timer = window.setTimeout(load, 15000);
          else if (!retryable || fails >= 3) setError(errMsg(e));
          else timer = window.setTimeout(load, 3000 * fails);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [storeSlug, orderHint, table, tick]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return { bill, error, noSource, viaToken, reload };
}
