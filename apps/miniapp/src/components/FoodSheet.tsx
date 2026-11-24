import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Img from './Img';
import { fmtMoney } from '../format';
import type { CartOption } from '../cart';
import type { MenuItem } from '../types';

const MAX_QTY = 99;

export interface FoodSheetInitial {
  quantity: number;
  note: string;
  options: CartOption[];
}

/** Tag dau tien cua mon (JSON array string) — vd "Phu hop 2-3 nguoi" */
export function itemTags(tags: unknown): string[] {
  return Array.isArray(tags)
    ? (tags as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];
}

/**
 * Chi tiet mon dang bottom sheet (thiet ke v2): dong bang nut X, phim Esc hoac cham ra ngoai;
 * khoa cuon nen; vung nut them gio co dinh. Mon co option bat buoc phai chon truoc khi them.
 */
export default function FoodSheet({
  item,
  initial,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  initial?: FoodSheetInitial;
  onClose: () => void;
  onConfirm: (quantity: number, note: string, options: CartOption[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const editing = Boolean(initial);
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [note, setNote] = useState(initial?.note ?? '');
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.options ?? []).map((o) => [o.groupName, o.optionName])),
  );
  const [err, setErr] = useState<string | null>(null);
  // nhom option bat buoc con thieu (danh dau do + cuon toi)
  const [missingGroup, setMissingGroup] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const groups = useMemo(() => {
    const map = new Map<string, MenuItem['options']>();
    for (const o of item.options) {
      const list = map.get(o.groupName) ?? [];
      list.push(o);
      map.set(o.groupName, list);
    }
    return [...map.entries()];
  }, [item]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const extra = Object.entries(selected).reduce((s, [g, o]) => {
    const opt = item.options.find((x) => x.groupName === g && x.optionName === o);
    return s + (opt?.extraPrice ?? 0);
  }, 0);

  const confirm = () => {
    const missing = groups.find(([name, opts]) => opts.some((o) => o.isRequired) && !selected[name]);
    if (missing) {
      setErr(`Vui lòng chọn “${missing[0]}” trước khi thêm vào giỏ.`);
      setMissingGroup(missing[0]);
      // cuon toi nhom con thieu de khach thay ngay
      window.setTimeout(() => {
        groupRefs.current[missing[0]]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 0);
      return;
    }
    const options: CartOption[] = Object.entries(selected).map(([groupName, optionName]) => ({
      groupName,
      optionName,
    }));
    onConfirm(quantity, note.trim(), options);
  };

  const tags = itemTags(item.tags);

  return (
    <dialog
      ref={ref}
      className="bottom-sheet"
      aria-labelledby="food-sheet-title"
      onClose={onClose}
      onClick={(e) => {
        // Cham vao lop nen (backdrop) thi dong
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
            ref.current!.close();
          }
        }
      }}
    >
      <button className="sheet-close" aria-label="Đóng chi tiết món" onClick={() => ref.current?.close()}>
        <Icon name="close" />
      </button>
      <div className="sheet-scroll">
        <div className="sheet-handle" />
        <Img
          className="sheet-photo"
          src={item.imageUrl ?? ''}
          alt={item.name}
          fallbackChar={item.name.charAt(0).toUpperCase()}
          fallbackClassName="sheet-photo-fallback"
        />
        <div className="sheet-body">
          <div className="row between start gap8">
            <h2 id="food-sheet-title">{item.name}</h2>
            <span className="price">{fmtMoney(item.price + extra)}</span>
          </div>
          {item.description && <p className="muted small mt8">{item.description}</p>}
          {tags.length > 0 && (
            <div className="row wrap gap8">
              {tags.map((t) => (
                <span className="pill pink" key={t}>
                  <Icon name="user" size="sm" /> {t}
                </span>
              ))}
            </div>
          )}
          <div className="divider" />

          {groups.map(([name, opts]) => {
            const required = opts.some((o) => o.isRequired);
            return (
              <div
                className={`option-group${missingGroup === name ? ' invalid' : ''}`}
                key={name}
                ref={(el) => {
                  groupRefs.current[name] = el;
                }}
              >
                <p className="label">
                  {name} <small>{required ? '· Chọn 1' : '· Không bắt buộc'}</small>
                </p>
                <div className="chips" role="group" aria-label={name}>
                  {opts.map((o) => {
                    const on = selected[name] === o.optionName;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`chip${on ? ' selected' : ''}`}
                        aria-pressed={on}
                        onClick={() => {
                          // Chon lai option dang chon thi bo chon (chi voi nhom khong bat buoc)
                          setSelected((s) => {
                            const next = { ...s };
                            if (on && !required) delete next[name];
                            else next[name] = o.optionName;
                            return next;
                          });
                          setErr(null);
                          setMissingGroup(null);
                        }}
                      >
                        {o.optionName}
                        {o.extraPrice > 0 && ` +${fmtMoney(o.extraPrice)}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <label className="label" htmlFor="food-note" style={{ marginTop: groups.length ? 18 : 0 }}>
            Ghi chú cho bếp <span className="muted tiny">(không bắt buộc)</span>
          </label>
          <textarea
            id="food-note"
            maxLength={300}
            value={note}
            placeholder="Ví dụ: ít cay, không hành..."
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="tiny muted mt8 mb0">Quán sẽ cố gắng đáp ứng yêu cầu của bạn.</p>
        </div>
      </div>
      <div className="sheet-dock">
        {/* Loi nam ngay tren nut hanh dong de luon nhin thay (khong bi dock che) */}
        {err && (
          <p className="sheet-error" role="alert">
            {err}
          </p>
        )}
        <div className="stepper">
          <button aria-label="Giảm số lượng" disabled={quantity <= 1} onClick={() => setQuantity((n) => Math.max(1, n - 1))}>
            <Icon name="minus" size="sm" />
          </button>
          <output>{quantity}</output>
          <button
            aria-label="Tăng số lượng"
            disabled={quantity >= MAX_QTY}
            onClick={() => setQuantity((n) => Math.min(MAX_QTY, n + 1))}
          >
            <Icon name="plus" size="sm" />
          </button>
        </div>
        <button className="btn" onClick={confirm}>
          {editing ? 'Cập nhật' : 'Thêm vào giỏ'} · {fmtMoney((item.price + extra) * quantity)}
        </button>
      </div>
    </dialog>
  );
}
