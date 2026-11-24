import { useState, useEffect, useMemo, useCallback, createContext, useContext, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { MeData, Store } from './types';

const STORE_KEY = 'innoorder_store_id';

interface AppContextValue {
  me: MeData | null;
  booting: boolean;
  login: (login: string, password: string) => Promise<string>;
  logout: () => void;
  stores: Store[];
  activeStoreId: string | null;
  selectStore: (id: string | null) => void;
  activeStore: { id: string; name: string; slug: string; status: string } | null;
  isSuper: boolean;
  canWrite: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeData | null>(null);
  const [booting, setBooting] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(
    () => localStorage.getItem(STORE_KEY),
  );

  const loadStores = useCallback(async () => {
    try {
      const list = await api<Store[]>('/stores');
      setStores(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const data = await api<MeData>('/auth/me');
        setMe(data);
        if (data.role === 'SUPER_ADMIN') {
          const list = await loadStores();
          const saved = localStorage.getItem(STORE_KEY);
          const hasSaved = saved && list.some((s) => s.id === saved);
          const nextId = hasSaved ? saved : list[0]?.id ?? null;
          setActiveStoreId(nextId);
          if (nextId) localStorage.setItem(STORE_KEY, nextId);
        } else {
          setActiveStoreId(data.storeId);
        }
      } catch {
        setMe(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [loadStores]);

  const login = useCallback(
    async (loginValue: string, password: string) => {
      const res = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { login: loginValue, password },
      });
      setToken(res.accessToken);
      const data = await api<MeData>('/auth/me');
      setMe(data);
      if (data.role === 'SUPER_ADMIN') {
        const list = await loadStores();
        const first = list[0]?.id ?? null;
        setActiveStoreId(first);
        if (first) localStorage.setItem(STORE_KEY, first);
      } else {
        setActiveStoreId(data.storeId);
      }
      return data.role;
    },
    [loadStores],
  );

  const logout = useCallback(() => {
    api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setMe(null);
    window.location.href = '/login';
  }, []);

  const selectStore = useCallback((id: string | null) => {
    setActiveStoreId(id);
    if (id) localStorage.setItem(STORE_KEY, id);
    else localStorage.removeItem(STORE_KEY);
  }, []);

  const isSuper = me?.role === 'SUPER_ADMIN';
  const activeStore = useMemo(() => {
    if (!me) return null;
    if (isSuper) {
      const s = stores.find((x) => x.id === activeStoreId);
      return s ? { id: s.id, name: s.name, slug: s.slug, status: s.status } : null;
    }
    return me.store;
  }, [me, isSuper, stores, activeStoreId]);

  const canWrite =
    me?.role === 'SUPER_ADMIN' || me?.role === 'OWNER' || me?.role === 'MANAGER';

  const value: AppContextValue = {
    me,
    booting,
    login,
    logout,
    stores,
    activeStoreId,
    selectStore,
    activeStore,
    isSuper,
    canWrite,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp phải dùng trong AppProvider');
  return ctx;
}
