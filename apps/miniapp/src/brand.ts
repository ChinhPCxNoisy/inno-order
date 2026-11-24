// Cache branding cua quan (theo slug) trong bon nho — de cac trang
// (TabBar, Profile, Tracking) duoc settings khong can goi API lan 2.

import type { StoreBrand } from './types';

const cache = new Map<string, StoreBrand>();

export function setBrand(brand: StoreBrand): void {
  cache.set(brand.slug, brand);
}

export function getBrand(slug: string): StoreBrand | null {
  return cache.get(slug) ?? null;
}

// Ten khu vuc cua ban ("Trong nha") tu API xac nhan ban, luu sessionStorage de gio/ca nhan hien "Ban B01 · Trong nha"
const areaKey = (slug: string, table: string) => `innoorder_area_${slug}_${table.toUpperCase()}`;

export function setTableArea(slug: string, table: string, areaName: string | null | undefined): void {
  try {
    if (areaName) sessionStorage.setItem(areaKey(slug, table), areaName);
  } catch {
    // sessionStorage khong dung duoc: bo qua, chi mat phan "· khu vuc"
  }
}

export function getTableArea(slug: string, table: string): string | null {
  try {
    return sessionStorage.getItem(areaKey(slug, table));
  } catch {
    return null;
  }
}
