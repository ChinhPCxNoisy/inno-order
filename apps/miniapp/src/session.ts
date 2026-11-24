// Lua du lieu khach ben thiet bi (localStorage) — MVP chua co tai khoan khach.
// Sau nay thay bang customer co zalo_user_id khi backend co OAuth Zalo.

const CUSTOMER_KEY = 'innoorder_customer';
const ORDERS_KEY = 'innoorder_orders';
const MAX_ORDERS = 20;

export interface SessionCustomer {
  phone?: string;
  name?: string;
  zaloUserId?: string;
  marketingConsent?: boolean;
  transactionalConsent?: boolean;
}

export interface SessionOrder {
  orderId: string;
  orderNumber: string;
  storeSlug: string;
  storeName: string;
  tableCode: string;
  totalAmount: number;
  createdAt: string;
  /** Anh mon dai dien cua don (mon dau tien trong gio) — lam anh nho o lich su/danh gia */
  imageUrl?: string | null;
  /** Ma uu dai khach khai bao cho don nay (chi la khai bao) */
  voucherCode?: string;
}

export function getCustomer(): SessionCustomer {
  try {
    const raw = localStorage.getItem(CUSTOMER_KEY);
    return raw ? (JSON.parse(raw) as SessionCustomer) : {};
  } catch {
    return {};
  }
}

export function saveCustomer(patch: SessionCustomer) {
  const next = { ...getCustomer(), ...patch };
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(next));
}

export function getOrders(): SessionOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as SessionOrder[]) : [];
  } catch {
    return [];
  }
}

export function addOrder(order: SessionOrder) {
  const rest = getOrders().filter((o) => o.orderId !== order.orderId);
  localStorage.setItem(ORDERS_KEY, JSON.stringify([order, ...rest].slice(0, MAX_ORDERS)));
}

export function clearSession() {
  localStorage.removeItem(CUSTOMER_KEY);
  localStorage.removeItem(ORDERS_KEY);
  localStorage.removeItem(STORE_SESSIONS_KEY);
  window.dispatchEvent(new Event(STORE_SESSION_EVENT));
}

/** Anh dai dien cua don: anh mon luu kem don, khong co thi logo quan, roi anh banner quan ('' = dung chu cai) */
export function orderThumb(
  orderId: string | undefined,
  brand: { logoUrl: string | null; bannerUrl: string | null } | null,
): string {
  const saved = orderId ? getOrders().find((o) => o.orderId === orderId)?.imageUrl : null;
  return saved || brand?.logoUrl || brand?.bannerUrl || '';
}

// ===== Phien ban cua khach (sessionToken) =====
// Luu theo quan: token + ban hien tai + cac ma ban cu (da doi) de gui don vao dung ban sau khi quan doi/gop ban.

const STORE_SESSIONS_KEY = 'innoorder_store_sessions';
/** Qua thoi gian nay khong cap nhat thi bo qua (khach da roi quan, tranh map nham ma ban cu sang ban moi) */
const STORE_SESSION_TTL = 12 * 3600_000;
export const STORE_SESSION_EVENT = 'innoorder:store-session';

export interface TableNotice {
  /** Khoa de nho thong bao da dong (cung khoa thi khong hien lai) */
  key: string;
  kind: 'moved' | 'merged';
  text: string;
}

export interface StoreSession {
  /** Token phien (khong co khi chi biet ban moi qua man theo doi don) */
  token?: string;
  /** Ban hien tai cua khach (viet hoa) */
  tableCode: string;
  /** Ma ban cu da doi di (viet hoa): ?t= la ma nay thi dung tableCode */
  aliases: string[];
  /** Cac ban cua phien lan cuoi biet (de bao gop ban) */
  tables: string[];
  savedAt: string;
  notice?: TableNotice;
  dismissed?: string;
}

const up = (s: string) => s.trim().toUpperCase();

function readAll(): Record<string, StoreSession> {
  try {
    const raw = localStorage.getItem(STORE_SESSIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, StoreSession>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoreSession>) {
  try {
    localStorage.setItem(STORE_SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // localStorage khong dung duoc: bo qua, khach van goi mon binh thuong theo ban tren URL
  }
  window.dispatchEvent(new Event(STORE_SESSION_EVENT));
}

export function getStoreSession(slug: string | undefined): StoreSession | null {
  if (!slug) return null;
  const s = readAll()[slug];
  if (!s || typeof s.tableCode !== 'string' || !Array.isArray(s.aliases) || !Array.isArray(s.tables)) return null;
  const age = Date.now() - new Date(s.savedAt).getTime();
  if (!Number.isFinite(age) || age > STORE_SESSION_TTL) return null;
  return s;
}

export function setStoreSession(slug: string, s: StoreSession | null) {
  const all = readAll();
  if (s) all[slug] = s;
  else delete all[slug];
  writeAll(all);
}

/** Phien da ket thuc/het han/khong ton tai: go token va ma ban cu */
export function clearStoreSession(slug: string) {
  if (readAll()[slug]) setStoreSession(slug, null);
}

export function dismissNotice(slug: string) {
  const s = getStoreSession(slug);
  if (s?.notice && s.dismissed !== s.notice.key) setStoreSession(slug, { ...s, dismissed: s.notice.key });
}

/** Thong bao dang can hien (chua dong) */
export function activeNotice(s: StoreSession | null): TableNotice | null {
  return s?.notice && s.dismissed !== s.notice.key ? s.notice : null;
}

/** Ma ban dang dung de goi mon: ma ban cu (da doi) thi doi sang ban hien tai */
export function effectiveTable(s: StoreSession | null, raw: string | null): string | null {
  if (!raw) return raw;
  return s && s.aliases.includes(up(raw)) ? s.tableCode : raw;
}

function movedNotice(from: string, to: string, at?: string): TableNotice {
  return {
    key: `moved:${from}>${to}@${at ?? ''}`,
    kind: 'moved',
    text: `Quán đã chuyển bạn sang bàn ${to}. Món sẽ được mang tới bàn mới, đơn gọi thêm sẽ gửi đến bàn ${to}.`,
  };
}

/** Sau khi gui don: luu token + ban hien tai tu phan hoi; ban tra ve khac ban da gui thi bao doi ban */
export function saveSessionFromOrder(
  slug: string,
  sentTable: string,
  res: { sessionToken?: string; tableCode?: string },
) {
  const prev = getStoreSession(slug);
  const now = up(res.tableCode ?? sentTable);
  // phien moi (token khac): bo cac ma ban cu cua phien truoc
  const same = prev && prev.token && prev.token === res.sessionToken ? prev : null;
  const next: StoreSession = {
    token: res.sessionToken,
    tableCode: now,
    aliases: (same?.aliases ?? []).filter((a) => a !== now),
    tables: same?.tables ?? [now],
    savedAt: new Date().toISOString(),
    notice: same?.notice,
    dismissed: same?.dismissed,
  };
  if (!next.tables.includes(now)) next.tables = [...next.tables, now];
  if (up(sentTable) !== now) {
    if (!next.aliases.includes(up(sentTable))) next.aliases.push(up(sentTable));
    next.notice = movedNotice(up(sentTable), now);
    next.dismissed = undefined;
  }
  setStoreSession(slug, next);
}

/** Man theo doi don thay quan da doi ban (don + tableMovedFrom) */
export function noteMoveFromOrder(slug: string, from: string, to: string, at?: string) {
  const F = up(from);
  const T = up(to);
  if (F === T) return;
  const prev = getStoreSession(slug);
  // Chi ap dung khi chua co phien, hoac phien dang giu ban cu/ban moi nay (don lich su cua phien khac thi bo qua)
  if (prev && prev.tableCode !== F && prev.tableCode !== T && !prev.aliases.includes(F)) return;
  if (prev && prev.tableCode === T && prev.aliases.includes(F)) return; // da ghi nhan
  const aliases = new Set([...(prev?.aliases ?? []), F]);
  if (prev && prev.tableCode !== T) aliases.add(prev.tableCode);
  aliases.delete(T);
  const notice = movedNotice(F, T, at);
  setStoreSession(slug, {
    token: prev?.token,
    tableCode: T,
    aliases: [...aliases],
    tables: [T],
    savedAt: new Date().toISOString(),
    notice,
    dismissed: prev?.dismissed === notice.key ? prev.dismissed : undefined,
  });
}

/**
 * Dong bo voi hoa don ban tu server: phien ket thuc -> go token; ban cua khach khong con trong phien -> da doi ban;
 * them ban moi vao phien -> bao gop ban. Tra ve false neu phien da ket thuc.
 */
export function applyServerView(
  slug: string,
  view: {
    status: string;
    table: { code: string };
    tables: { code: string }[];
    movedFrom?: { code: string; at: string } | null;
  },
): boolean {
  const s = getStoreSession(slug);
  if (view.status !== 'OPEN') {
    // Phien dong/huy: het luot goi mon o phien nay, bo token va ma ban cu
    clearStoreSession(slug);
    return false;
  }
  if (!s) return true;
  const codes = Array.from(new Set([view.table.code, ...view.tables.map((t) => t.code)].map(up)));
  const stamp = new Date().toISOString();
  if (codes.includes(s.tableCode)) {
    // Van o ban cu (hoac ban cua minh duoc gop vao phien): chi bao khi co them ban moi
    const grew = codes.filter((c) => !s.tables.includes(c));
    const next: StoreSession = { ...s, tables: codes, savedAt: stamp };
    if (grew.length > 0 && codes.length > 1) {
      const others = codes.filter((c) => c !== s.tableCode);
      next.notice = {
        key: `merged:${[...codes].sort().join('+')}`,
        kind: 'merged',
        text: `Bàn ${s.tableCode} đã được gộp với bàn ${others.join(', ')}. Hóa đơn là chung của cả bàn.`,
      };
      next.dismissed = s.dismissed === next.notice.key ? s.dismissed : undefined;
    }
    setStoreSession(slug, next);
    return true;
  }
  // Ban cua khach khong con trong phien: quan da doi ban
  const to = up(view.table.code);
  const aliases = new Set([...s.aliases, s.tableCode]);
  if (view.movedFrom) aliases.add(up(view.movedFrom.code));
  aliases.delete(to);
  const notice = movedNotice(s.tableCode, to, view.movedFrom?.at);
  setStoreSession(slug, {
    ...s,
    tableCode: to,
    aliases: [...aliases],
    tables: codes,
    savedAt: stamp,
    notice,
    dismissed: s.dismissed === notice.key ? s.dismissed : undefined,
  });
  return true;
}

/**
 * Phien co thuoc ve ban dang mo khong? (ma ban tren URL trung ban hien tai/ban cu da doi/ban trong phien).
 * Khong co ma ban tren URL thi coi nhu thuoc. Dung de khong hien thong bao/hoa don cua ban khac.
 */
export function sessionMatchesTable(s: StoreSession | null, raw: string | null | undefined): boolean {
  if (!s) return false;
  if (!raw) return true;
  const t = up(raw);
  return s.tableCode === t || s.aliases.includes(t) || s.tables.includes(t);
}

/** Quan gan nhat khach da dung tren thiet bi (don gan nhat, khong co thi phien ban moi nhat con han) */
export function lastStoreSlug(): string | null {
  const o = getOrders()[0]?.storeSlug;
  if (o) return o;
  const all = readAll();
  const live = Object.keys(all)
    .filter((k) => getStoreSession(k))
    .sort((a, b) => new Date(all[b].savedAt).getTime() - new Date(all[a].savedAt).getTime());
  return live[0] ?? null;
}
