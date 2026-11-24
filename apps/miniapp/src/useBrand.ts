import { useEffect, useState } from 'react';
import { publicApi } from './api';
import { getBrand, getTableArea, setBrand, setTableArea } from './brand';
import { applyTheme } from './theme';
import type { StoreBrand } from './types';

/**
 * Dam bao brand cua quan co trong cache (lay tu API neu chua co) va ap theme.
 * Dung cho cac trang khong tuong tac truc tiep voi menu (Tracking, Profile,
 * Voucher) de khi moi link thang (fresh load) van co mau chu dao cua quan.
 * Tra ve brand (null cho den khi tai xong) de trang co the hien settings.
 */
export function useBrand(storeSlug: string | undefined): StoreBrand | null {
  const [brand, setBrandState] = useState<StoreBrand | null>(() =>
    storeSlug ? getBrand(storeSlug) : null,
  );

  useEffect(() => {
    if (!storeSlug) return;
    const cached = getBrand(storeSlug);
    if (cached) {
      setBrandState(cached);
      applyTheme(cached.themeColor);
      return;
    }
    let cancelled = false;
    publicApi
      .getBrand(storeSlug)
      .then((b) => {
        if (cancelled) return;
        setBrand(b);
        setBrandState(b);
        applyTheme(b.themeColor);
      })
      .catch(() => {
        // Brand chi mang tinh trang tri — trang van chay voi mau mac dinh
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug]);

  return brand;
}

/**
 * Ten khu vuc cua ban (vd "Trong nha"). Lay tu cache (Home/Menu da luu khi xac nhan ban);
 * chua co thi goi xac nhan ban mot lan. Chua co du lieu hoac loi mang thi tra ve null (khong hien dau thua).
 */
export function useTableArea(storeSlug: string | undefined, table: string | null): string | null {
  const [area, setArea] = useState<string | null>(() => (storeSlug && table ? getTableArea(storeSlug, table) : null));

  useEffect(() => {
    if (!storeSlug || !table) {
      setArea(null);
      return;
    }
    const cached = getTableArea(storeSlug, table);
    setArea(cached);
    if (cached) return;
    let cancelled = false;
    publicApi
      .confirmTable(storeSlug, table.toUpperCase())
      .then((c) => {
        if (cancelled) return;
        setTableArea(storeSlug, table, c.table.areaName);
        setArea(c.table.areaName || null);
      })
      .catch(() => {
        // chi la thong tin phu
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, table]);

  return area;
}
