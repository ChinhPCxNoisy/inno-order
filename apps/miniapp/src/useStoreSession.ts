import { useEffect, useState } from 'react';
import { ApiError, publicApi } from './api';
import {
  STORE_SESSION_EVENT,
  applyServerView,
  clearStoreSession,
  getStoreSession,
  type StoreSession,
} from './session';

/** Phien ban luu tren thiet bi (token, ban hien tai, thong bao doi ban); tu cap nhat khi du lieu doi */
export function useStoreSession(slug: string | undefined): StoreSession | null {
  const [s, setS] = useState<StoreSession | null>(() => getStoreSession(slug));
  useEffect(() => {
    const read = () => setS(getStoreSession(slug));
    read();
    window.addEventListener(STORE_SESSION_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(STORE_SESSION_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, [slug]);
  return s;
}

// GET /public/sessions/:token gioi han 60 lan/phut/IP (nhieu khach cung WiFi quan): khong goi qua 1 lan / 20 giay moi quan
const MIN_GAP_MS = 20_000;
const lastSync = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

/**
 * Dong bo phien voi server: biet quan da doi/gop ban chua, phien con mo khong.
 * 404 (token sai, phien da ket thuc/het han): go token, khach goi lai binh thuong (se mo phien moi).
 * Loi mang/429/5xx: bo qua, de lan sau.
 */
export function syncStoreSession(slug: string, force = false): Promise<void> {
  const s = getStoreSession(slug);
  if (!s?.token) return Promise.resolve();
  const running = inflight.get(slug);
  if (running) return running;
  if (!force && Date.now() - (lastSync.get(slug) ?? 0) < MIN_GAP_MS) return Promise.resolve();
  lastSync.set(slug, Date.now());
  const p = publicApi
    .getSession(s.token)
    .then((view) => {
      applyServerView(slug, view);
    })
    .catch((e) => {
      if (e instanceof ApiError && e.status === 404) clearStoreSession(slug);
    })
    .finally(() => {
      inflight.delete(slug);
    });
  inflight.set(slug, p);
  return p;
}

/** Goi o khung man hinh: dong bo khi mo man va khi quay lai app (vd tu app ngan hang) */
export function useSessionSync(slug: string | undefined) {
  useEffect(() => {
    if (!slug) return;
    void syncStoreSession(slug);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncStoreSession(slug);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [slug]);
}
