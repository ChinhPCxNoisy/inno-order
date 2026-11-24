import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { MenuItem } from './types';

export interface CartOption {
  groupName: string;
  optionName: string;
}

export interface CartLine {
  /** Id rieng cua dong gio (1 mon co the co nhieu dong khac option/ghi chu) */
  id: string;
  item: MenuItem;
  quantity: number;
  note: string;
  options: CartOption[];
}

interface CartState {
  lines: CartLine[];
}

const MAX_QTY = 99;

type CartAction =
  | { type: 'load'; lines: CartLine[] }
  | { type: 'add'; item: MenuItem; quantity: number; note: string; options: CartOption[] }
  | { type: 'update'; id: string; quantity: number; note: string; options: CartOption[] }
  | { type: 'inc'; id: string; delta: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' };

function newLineId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // moi truong khong co crypto.randomUUID
  }
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Khoa bien the: cung mon + cung option + cung ghi chu thi gop vao 1 dong */
export function variantKey(itemId: string, options: CartOption[], note: string): string {
  const opts = options
    .map((o) => `${o.groupName}=${o.optionName}`)
    .sort()
    .join('|');
  return `${itemId}#${opts}#${note.trim()}`;
}

const lineKey = (l: CartLine) => variantKey(l.item.id, l.options, l.note);

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'load':
      return { lines: action.lines };
    case 'add': {
      const key = variantKey(action.item.id, action.options, action.note);
      const same = state.lines.find((l) => lineKey(l) === key);
      if (same) {
        // da co dung bien the nay: cong don so luong
        return {
          lines: state.lines.map((l) =>
            l.id === same.id ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + action.quantity) } : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          { id: newLineId(), item: action.item, quantity: action.quantity, note: action.note, options: action.options },
        ],
      };
    }
    case 'update': {
      const cur = state.lines.find((l) => l.id === action.id);
      if (!cur) return state;
      const key = variantKey(cur.item.id, action.options, action.note);
      const other = state.lines.find((l) => l.id !== action.id && lineKey(l) === key);
      if (other) {
        // sua thanh bien the da co o dong khac: gop vao dong do, bo dong dang sua
        return {
          lines: state.lines
            .filter((l) => l.id !== action.id)
            .map((l) =>
              l.id === other.id ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + action.quantity) } : l,
            ),
        };
      }
      return {
        lines: state.lines.map((l) =>
          l.id === action.id ? { ...l, quantity: action.quantity, note: action.note, options: action.options } : l,
        ),
      };
    }
    case 'inc': {
      const lines = state.lines
        .map((l) => (l.id === action.id ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + action.delta) } : l))
        .filter((l) => l.quantity > 0);
      return { lines };
    }
    case 'remove':
      return { lines: state.lines.filter((l) => l.id !== action.id) };
    case 'clear':
      return { lines: [] };
  }
}

export function lineTotal(line: CartLine): number {
  const extra = line.options.reduce((s, o) => {
    const opt = line.item.options.find((x) => x.groupName === o.groupName && x.optionName === o.optionName);
    return s + (opt?.extraPrice ?? 0);
  }, 0);
  return (line.item.price + extra) * line.quantity;
}

interface CartCtx {
  lines: CartLine[];
  count: number;
  total: number;
  add: (item: MenuItem, quantity: number, note: string, options: CartOption[]) => void;
  update: (id: string, quantity: number, note: string, options: CartOption[]) => void;
  inc: (id: string, delta: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Tong so luong cua 1 mon trong gio (cong moi bien the) */
  qtyOf: (itemId: string) => number;
}

const Ctx = createContext<CartCtx | null>(null);

const cartKey = (storeSlug: string) => `innoorder_cart_${storeSlug}`;

/** Doc gio tu localStorage; dong cu (truoc khi co id dong) duoc cap id moi khi nap */
function loadCart(storeSlug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(storeSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CartLine>[];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const lines: CartLine[] = [];
    for (const l of parsed) {
      if (!l || !l.item || typeof l.item.id !== 'string' || !Array.isArray(l.item.options)) continue;
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      let id = typeof l.id === 'string' && l.id ? l.id : newLineId();
      if (seen.has(id)) id = newLineId();
      seen.add(id);
      lines.push({
        id,
        item: l.item,
        quantity: Math.min(MAX_QTY, Math.floor(qty)),
        note: typeof l.note === 'string' ? l.note : '',
        options: Array.isArray(l.options) ? l.options : [],
      });
    }
    return lines;
  } catch {
    return [];
  }
}

/**
 * Gio hang luu ben thiet bi theo store (localStorage) de khong mat khi
 * WebView Zalo reload. Provider nam trong BrowserRouter nen doc slug tu URL.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const storeSlug = useMemo(() => {
    const m = /^\/s\/([^/]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }, [location.pathname]);

  const [state, dispatch] = useReducer(reducer, { lines: [] });
  const loadedSlug = useRef<string | null>(null);

  useEffect(() => {
    if (!storeSlug || loadedSlug.current === storeSlug) return;
    loadedSlug.current = storeSlug;
    dispatch({ type: 'load', lines: loadCart(storeSlug) });
  }, [storeSlug]);

  useEffect(() => {
    if (!storeSlug) return;
    try {
      if (state.lines.length === 0) localStorage.removeItem(cartKey(storeSlug));
      else localStorage.setItem(cartKey(storeSlug), JSON.stringify(state.lines));
    } catch {
      // localStorage full/ko duoc phep — gio hang van chay in-memory
    }
  }, [state, storeSlug]);

  const value = useMemo<CartCtx>(() => {
    const total = state.lines.reduce((s, l) => s + lineTotal(l), 0);
    const count = state.lines.reduce((s, l) => s + l.quantity, 0);
    return {
      lines: state.lines,
      count,
      total,
      add: (item, quantity, note, options) => dispatch({ type: 'add', item, quantity, note, options }),
      update: (id, quantity, note, options) => dispatch({ type: 'update', id, quantity, note, options }),
      inc: (id, delta) => dispatch({ type: 'inc', id, delta }),
      remove: (id) => dispatch({ type: 'remove', id }),
      clear: () => dispatch({ type: 'clear' }),
      qtyOf: (itemId) => state.lines.filter((l) => l.item.id === itemId).reduce((s, l) => s + l.quantity, 0),
    };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart phai duoc dung trong CartProvider');
  return ctx;
}
