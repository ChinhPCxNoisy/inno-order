import { BadRequestException } from '@nestjs/common';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Kiem tra 1 gia tri; tra ve gia tri da chuan hoa. null = xoa khoa. */
type Rule = (v: unknown, path: string) => unknown;

const bad = (path: string, why: string): never => {
  throw new BadRequestException(`Cài đặt "${path}" không hợp lệ: ${why}`);
};
const str = (max: number): Rule => (v, p) => {
  if (typeof v !== 'string') return bad(p, 'phải là chuỗi');
  if (v.length > max) return bad(p, `tối đa ${max} ký tự`);
  return v;
};
const bool: Rule = (v, p) => (typeof v === 'boolean' ? v : bad(p, 'phải là true/false'));
const oneOf = (...vals: string[]): Rule => (v, p) =>
  typeof v === 'string' && vals.includes(v) ? v : bad(p, `chỉ nhận ${vals.join(' | ')}`);
const num = (min: number, max: number, int = false): Rule => (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(p, 'phải là số');
  if (v < min || v > max) return bad(p, `phải từ ${min} đến ${max}`);
  if (int && !Number.isInteger(v)) return bad(p, 'phải là số nguyên');
  return v;
};

/** Khoa nhay cam: chi chu quan / Super Admin duoc doi, quan ly bi bo qua (khong bao loi de form cu van gui duoc) */
const OWNER_ONLY = new Set(['pos.discountLimits']);

/** Hai han muc nay: null = KHONG GIOI HAN (khac voi khoa vang mat = han muc mac dinh), nen giu null thay vi xoa */
const NULL_KEEPS = new Set(['pos.discountLimits.cashierMaxPercent', 'pos.discountLimits.cashierMaxAmount']);

/**
 * Danh sach khoa hop le cua stores.settings cho PATCH /stores/:id. Khoa khac (hoac khoa khong nam
 * trong danh sach) bi BO QUA, khong ghi de: giu tuong thich voi form admin gui lai ca khoi settings da tai.
 */
const SCHEMA: Record<string, Rule | Record<string, Rule | Record<string, Rule>>> = {
  bannerUrl: str(500),
  themeColor: str(30),
  welcomeText: str(300),
  paymentNote: str(500),
  showVoucherTab: bool,
  showZaloLogin: bool,
  vatEnabled: bool,
  vatRate: num(0, 100),
  rounding: oneOf('none', 'nearest_100'),
  pos: {
    allowWaiterMoveTable: bool,
    warnUnservedOnPay: bool,
    discountLimits: {
      cashierMaxPercent: num(0, 100),
      cashierMaxAmount: num(0, 10_000_000_000, true),
    },
  },
  printing: {
    mode: oneOf('AGENT', 'KDS_ONLY'),
    autoPrintBill: bool,
    footerText: str(200),
  },
  payment: {
    customerCanPayQr: bool,
    qrIntentTtlMinutes: num(1, 1440, true),
    autoAcceptPartial: bool,
  },
};

/** Gop `patch` vao `current` theo khoa (de quy theo SCHEMA). null trong patch = xoa khoa do. Khong mutate dau vao. */
export function mergeStoreSettings(current: unknown, patch: unknown, opts: { canEditOwnerOnly: boolean }): Json {
  const base: Json = isObj(current) ? structuredClone(current) : {};
  if (patch === undefined) return base;
  if (!isObj(patch)) throw new BadRequestException('settings phải là một đối tượng');
  apply(base, patch, SCHEMA, '', opts);
  return base;
}

function apply(
  target: Json,
  patch: Json,
  schema: Record<string, Rule | Record<string, unknown>>,
  prefix: string,
  opts: { canEditOwnerOnly: boolean },
): void {
  for (const [key, val] of Object.entries(patch)) {
    const rule = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
    if (!rule) continue; // khoa la: bo qua
    const path = prefix ? `${prefix}.${key}` : key;
    if (OWNER_ONLY.has(path) && !opts.canEditOwnerOnly) continue;
    if (val === null && typeof rule !== 'function' && !opts.canEditOwnerOnly) {
      // Xoa ca khoi: voi vai tro thap phai di tung khoa con de khoa owner-only (vd pos.discountLimits) khong bi xoa theo
      const child: Json = isObj(target[key]) ? (target[key] as Json) : {};
      const nulls: Json = Object.fromEntries(Object.keys(rule).map((k) => [k, null]));
      apply(child, nulls, rule as Record<string, Rule | Record<string, unknown>>, path, opts);
      if (Object.keys(child).length === 0) delete target[key];
      else target[key] = child;
      continue;
    }
    if (val === null) {
      if (NULL_KEEPS.has(path)) target[key] = null;
      else delete target[key];
      continue;
    }
    if (typeof rule === 'function') {
      target[key] = rule(val, path);
    } else {
      if (!isObj(val)) {
        bad(path, 'phải là một đối tượng');
        continue;
      }
      const child: Json = isObj(target[key]) ? (target[key] as Json) : {};
      apply(child, val, rule as Record<string, Rule | Record<string, unknown>>, path, opts);
      target[key] = child;
    }
  }
}
