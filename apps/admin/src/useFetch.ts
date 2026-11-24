import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './api';

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // true khi lan tai nay la lam moi ngam (giu nguyen du lieu cu, khong bat loading)
  const silentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    (async () => {
      try {
        const d = await fetcherRef.current();
        if (!cancelled) {
          setData(d);
          if (silent) setError(null);
        }
      } catch (e) {
        // lam moi ngam that bai: giu du lieu dang hien thi, khong thay bang man loi
        if (!cancelled && !silent) setError(errMsg(e));
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // tai lai ngam: khong bat loading, khong unmount noi dung dang hien thi
  const refresh = useCallback(() => {
    silentRef.current = true;
    setTick((t) => t + 1);
  }, []);
  return { data, loading, error, reload, refresh };
}
