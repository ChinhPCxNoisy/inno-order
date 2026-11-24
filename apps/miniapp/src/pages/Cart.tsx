import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import FoodSheet from '../components/FoodSheet';
import Icon from '../components/Icon';
import Img from '../components/Img';
import Shell, { PageTitle, useTable } from '../components/Shell';
import ErrorState, { EmptyBody } from '../components/StateView';
import { useUi } from '../components/ui';
import { ApiError, errMsg, publicApi, type QuoteItem } from '../api';
import type { QuoteResult } from '../types';
import { lineTotal, useCart, type CartLine } from '../cart';
import { fmtMoney } from '../format';
import { addOrder, clearStoreSession, getStoreSession, noteMoveFromOrder, saveSessionFromOrder, sessionMatchesTable } from '../session';
import { useBrand, useTableArea } from '../useBrand';
import { getDeclaredVoucher, normVoucher, setDeclaredVoucher } from '../voucher';

const MAX_QTY = 99;

/** Id chong gui trung (toi da 64 ky tu): randomUUID, khong co thi tu sinh */
function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // moi truong khong co crypto.randomUUID
  }
  return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

const reqKey = (slug: string) => `innoorder_reqid_${slug}`;

/** Lay id dang giu cho noi dung gio nay (cung noi dung -> cung id, ke ca sau khi reload); doi noi dung -> id moi */
function requestIdFor(slug: string, sig: string): string {
  try {
    const raw = localStorage.getItem(reqKey(slug));
    if (raw) {
      const saved = JSON.parse(raw) as { id?: string; sig?: string };
      if (saved.id && saved.sig === sig) return saved.id;
    }
  } catch {
    // bo qua, tao id moi
  }
  const id = newRequestId();
  try {
    localStorage.setItem(reqKey(slug), JSON.stringify({ id, sig }));
  } catch {
    // localStorage khong dung duoc: id van dung trong lan gui nay
  }
  return id;
}

function clearRequestId(slug: string) {
  try {
    localStorage.removeItem(reqKey(slug));
  } catch {
    // bo qua
  }
}

/** Gio mon & xac nhan gui don (thiet ke v2, man 04). */
export default function Cart() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { table, q } = useTable();
  const navigate = useNavigate();
  const brand = useBrand(storeSlug);
  const area = useTableArea(storeSlug, table);
  const { lines, count, total, update, inc, remove, clear } = useCart();
  const { toast, message } = useUi();

  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // loi tam thoi (mat mang, 429, 5xx): bam gui lai an toan vi giu nguyen clientRequestId
  const [canRetry, setCanRetry] = useState(false);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const errRef = useRef<HTMLDivElement>(null);
  // khoa dong bo: bam doi/nhieu lan "Gui don" truoc khi state kip cap nhat chi gui mot yeu cau
  const sendingRef = useRef(false);

  // Ma uu dai khach khai bao: chi luu vao don, KHONG tru vao tong gio (nhan vien ap khi thanh toan)
  const [voucher, setVoucher] = useState(() => getDeclaredVoucher(storeSlug));
  const [voucherInput, setVoucherInput] = useState('');
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherErr, setVoucherErr] = useState<string | null>(null);
  const [voucherEst, setVoucherEst] = useState<number | null>(null);

  // Bao gia do server tinh (khop bill that). Loi/cham -> null, quay ve tam tinh phia may khach (nhan "uoc tinh")
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const quoteItems: QuoteItem[] = lines.map((l) => ({
    menuItemId: l.item.id,
    quantity: l.quantity,
    note: l.note || undefined,
    options: l.options.length > 0 ? l.options : undefined,
  }));
  const quoteKey = JSON.stringify([quoteItems, voucher]);
  useEffect(() => {
    if (!storeSlug || lines.length === 0) {
      setQuote(null);
      return;
    }
    // gio doi: bo so cu ngay (tranh hien tong cua gio truoc), debounce, huy yeu cau cu
    setQuote(null);
    setQuoteFailed(false);
    const ctrl = new AbortController();
    let retry: number | undefined;
    const t = window.setTimeout(() => {
      publicApi
        .quote(storeSlug, quoteItems, voucher || undefined, ctrl.signal)
        .then((r) => {
          setQuoteFailed(false);
          setQuote(r);
          // Chi bo ma khi server bao ro ma khong hop le/het han/het luot (loi nghiep vu)
          if (voucher && r.offer && r.offer.valid === false) {
            setDeclaredVoucher(storeSlug, '');
            setVoucher('');
            setVoucherEst(null);
            setVoucherErr(r.offer.message);
          } else if (voucher && r.offer?.valid && typeof r.offer.discountAmount === 'number') {
            setVoucherEst(r.offer.discountAmount);
          }
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          // 429/mat mang/5xx: GIU ma da khai, quay ve tam tinh va tu thu lai (theo Retry-After neu co)
          setQuote(null);
          setQuoteFailed(true);
          const ra = e instanceof ApiError ? Number(e.data?.retryAfter) || 0 : 0;
          retry = window.setTimeout(() => setRetryTick((n) => n + 1), Math.min(Math.max(ra, 5), 60) * 1000);
        });
    }, 600);
    return () => {
      window.clearTimeout(t);
      if (retry) window.clearTimeout(retry);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug, quoteKey, retryTick]);

  const checkVoucher = async (code: string, subtotal: number): Promise<boolean> => {
    if (!storeSlug) return false;
    setVoucherBusy(true);
    setVoucherErr(null);
    try {
      const r = await publicApi.checkOffer(storeSlug, code, subtotal, quoteItems);
      if (r.valid) {
        setVoucher(r.code);
        setDeclaredVoucher(storeSlug, r.code);
        setVoucherEst(r.discountAmount);
        setVoucherInput('');
        return true;
      }
      setVoucherErr(r.message);
    } catch (e) {
      setVoucherErr(errMsg(e));
    } finally {
      setVoucherBusy(false);
    }
    return false;
  };

  const removeVoucher = () => {
    if (storeSlug) setDeclaredVoucher(storeSlug, '');
    setVoucher('');
    setVoucherEst(null);
    setVoucherErr(null);
  };

  const menuHref = `/s/${storeSlug}${q}`;

  if (!table) {
    return (
      <Shell>
        <ErrorState kind="qr" />
      </Shell>
    );
  }

  const submit = async (opt?: { table?: string; noToken?: boolean }) => {
    const sendTable = opt?.table ?? table;
    if (!storeSlug || lines.length === 0 || submitting || sendingRef.current) return;
    sendingRef.current = true;
    setSubmitting(true);
    setError(null);
    setCanRetry(false);
    try {
      const order = await publicApi.createOrder(storeSlug, {
        tableCode: sendTable,
        items: lines.map((l) => ({
          menuItemId: l.item.id,
          quantity: l.quantity,
          note: l.note || undefined,
          options: l.options.length > 0 ? l.options : undefined,
        })),
        customerNote: note.trim() || undefined,
        voucherCode: voucher || undefined,
        // token phien ban: don vao dung phien/ban du quan da doi ban (server bo qua token sai/het han)
        sessionToken: opt?.noToken || !sessionMatchesTable(getStoreSession(storeSlug), sendTable) ? undefined : getStoreSession(storeSlug)?.token,
        // gui lai sau loi mang van dung id nay -> server tra don da tao thay vi tao trung
        clientRequestId: requestIdFor(
          storeSlug,
          JSON.stringify([sendTable, Boolean(opt?.noToken), note.trim(), voucher, lines.map((l) => [l.item.id, l.quantity, l.note, l.options])]),
        ),
      });
      clearRequestId(storeSlug);
      setDeclaredVoucher(storeSlug, '');
      // luu token + ban hien tai (server tra ban khac ban da gui thi bao khach doi ban)
      saveSessionFromOrder(storeSlug, sendTable, order);
      clear();
      addOrder({
        orderId: order.id,
        orderNumber: order.orderNumber,
        storeSlug,
        storeName: brand?.name ?? '',
        tableCode: order.tableCode ?? sendTable,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        imageUrl: lines.find((l) => l.item.imageUrl)?.item.imageUrl ?? null,
        voucherCode: voucher || undefined,
      });
      navigate(`/s/${storeSlug}/order/${order.id}/sent${q}`, { replace: true });
    } catch (e) {
      sendingRef.current = false;
      // Phien cua khach da chuyen sang ban khac nhung khach quet QR ban cu: API khong tu chuyen don, hoi khach
      if (e instanceof ApiError && e.code === 'SESSION_MOVED') {
        const movedTo = (e.data?.movedTo as { code?: string } | undefined)?.code;
        const scanned = (e.data?.scannedTable as { code?: string } | undefined)?.code ?? sendTable;
        setSubmitting(false);
        if (movedTo) {
          message(`Bạn đã được chuyển sang bàn ${movedTo}`, `Gọi tiếp ở bàn ${movedTo}? Nếu bạn đang ngồi ở bàn ${scanned}, chọn "Tôi đang ở bàn ${scanned}" để gọi ở bàn này.`, [
            {
              label: `Gọi ở bàn ${movedTo}`,
              onClick: () => {
                noteMoveFromOrder(storeSlug, scanned, movedTo);
                void submit({ table: movedTo });
              },
            },
            {
              label: `Tôi đang ở bàn ${scanned}`,
              neutral: true,
              onClick: () => {
                clearStoreSession(storeSlug);
                void submit({ table: scanned, noToken: true });
              },
            },
          ]);
          return;
        }
      }
      // Loi mang: gio va id chong trung van giu nguyen, khach bam gui lai an toan
      setError(errMsg(e));
      setCanRetry(e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500));
      setSubmitting(false);
      window.setTimeout(() => errRef.current?.scrollIntoView({ block: 'nearest' }), 0);
    }
  };

  const wrongTable = () =>
    message(
      `Kiểm tra bàn ${table}`,
      'Nếu đây không phải bàn của bạn, hãy quét lại mã QR trên bàn đang ngồi. Nếu quán đã chuyển bàn cho bạn, bàn mới sẽ tự cập nhật ở đây. Cần đổi chỗ, hãy nhờ nhân viên chuyển bàn để tránh nhầm món.',
    );

  const dock =
    lines.length > 0 ? (
      <>
        <div className="row between mb16">
          <span className="small muted">{count} món · {quote ? (quote.discountAmount > 0 ? 'Dự kiến sau ưu đãi' : 'Tổng cộng') : 'Tạm tính'}</span>
          <strong className="price">{fmtMoney(quote ? quote.totalAmount : total)}</strong>
        </div>
        <p className="tiny muted" style={{ margin: '-8px 0 12px' }}>
          {quote
            ? `Tạm tính ${fmtMoney(quote.subtotal)}${quote.discountAmount > 0 ? ` − ưu đãi ${fmtMoney(quote.discountAmount)}` : ''}${quote.vatAmount > 0 ? ` + VAT ${quote.vatPercent}% ${fmtMoney(quote.vatAmount)}` : ''}.${quote.discountAmount > 0 ? ' Đơn gửi đi chưa trừ ưu đãi: nhân viên áp dụng khi thanh toán nên số ghi nhận lúc gửi có thể cao hơn.' : ' Ưu đãi chỉ áp dụng khi quán xác nhận.'}`
            : 'Ước tính, chưa gồm thuế VAT (nếu quán áp dụng) và ưu đãi, sẽ được tính khi thanh toán.'}
        </p>
        {/* Loi nam trong dock, ngay tren nut gui: luon nhin thay o man hinh nho */}
        {error && (
          <div className="notice-box dock-error" role="alert" ref={errRef}>
            {error}
            <span className="tiny" style={{ display: 'block', marginTop: 4 }}>
              {canRetry
                ? 'Giỏ món vẫn được giữ. Bấm “Gửi đơn” để thử lại, hệ thống sẽ không tạo đơn trùng.'
                : 'Giỏ món vẫn được giữ. Vui lòng kiểm tra lại rồi gửi đơn.'}
            </span>
          </div>
        )}
        <button className="btn" disabled={submitting} onClick={() => void submit()}>
          {submitting ? (
            'Đang gửi đơn…'
          ) : (
            <>
              Gửi đơn · Bàn {table} <Icon name="next" size="sm" />
            </>
          )}
        </button>
      </>
    ) : undefined;

  return (
    <Shell title="Giỏ món & xác nhận" dock={dock}>
      <PageTitle to={menuHref}>Giỏ món của bạn</PageTitle>

      <div className="cart-table">
        <Icon name="table" size="lg" />
        <div className="grow">
          <strong>
            Bàn <span className="navy">{table}</span>
            {area ? ` · ${area}` : ''}
          </strong>
          <div className="small muted">Kiểm tra món và số bàn trước khi gửi.</div>
        </div>
        <button className="text-btn" onClick={wrongTable}>
          Sai bàn?
        </button>
      </div>

      {lines.length === 0 ? (
        <EmptyBody
          icon="bag"
          title="Giỏ món đang trống"
          text="Chọn món bạn thích từ thực đơn. Quán sẽ nhận đơn sau khi bạn bấm gửi."
        >
          <Link className="btn" to={menuHref}>
            Khám phá thực đơn
          </Link>
        </EmptyBody>
      ) : (
        <>
          <div className="card" style={{ padding: '0 14px' }}>
            {lines.map((l) => {
              const optionText = l.options.map((o) => `${o.groupName}: ${o.optionName}`).join(' · ');
              return (
                <article className="cart-item" key={l.id}>
                  <div className="row start">
                    <Img
                      className="cart-img"
                      src={l.item.imageUrl ?? ''}
                      alt={l.item.name}
                      fallbackChar={l.item.name.charAt(0).toUpperCase()}
                    />
                    <div className="grow">
                      <h3>{l.item.name}</h3>
                      <span className="price small">{fmtMoney(lineTotal(l) / l.quantity)}</span>
                      {optionText && <div className="tiny muted">{optionText}</div>}
                      {l.note && (
                        <div>
                          <span className="note-chip">{l.note}</span>
                        </div>
                      )}
                    </div>
                    <button
                      className="remove"
                      aria-label={`Xóa ${l.item.name}`}
                      onClick={() => {
                        remove(l.id);
                        toast('Đã xóa món khỏi giỏ');
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  </div>
                  <div className="row between mt8">
                    <button className="text-btn" onClick={() => setEditing(l)}>
                      <Icon name="edit" size="sm" /> Ghi chú / chỉnh sửa
                    </button>
                    <div className="stepper">
                      <button
                        disabled={l.quantity <= 1}
                        aria-label={`Giảm ${l.item.name}`}
                        onClick={() => inc(l.id, -1)}
                      >
                        <Icon name="minus" size="sm" />
                      </button>
                      <output>{l.quantity}</output>
                      <button
                        disabled={l.quantity >= MAX_QTY}
                        aria-label={`Tăng ${l.item.name}`}
                        onClick={() => inc(l.id, 1)}
                      >
                        <Icon name="plus" size="sm" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <Link className="btn secondary" to={menuHref}>
            <Icon name="plus" /> Thêm món
          </Link>

          <div className="card mt16">
            <label htmlFor="order-note" className="label">
              Ghi chú cho quán
            </label>
            <textarea
              id="order-note"
              value={note}
              maxLength={500}
              placeholder="Ví dụ: thêm nước chấm..."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="card">
            <label htmlFor="voucher-code" className="label">
              Có mã ưu đãi?
            </label>
            {voucher ? (
              <div className="row between">
                <div className="grow">
                  <span className="note-chip">{voucher}</span>
                  {(quote?.discountAmount ?? voucherEst) !== null && (quote || !quoteFailed) && (
                    <div className="small mt8">
                      {quote ? (
                        <>
                          Giảm dự kiến <strong>{fmtMoney(quote.discountAmount)}</strong>, đã trừ vào tổng cộng bên dưới.
                        </>
                      ) : (
                        <>
                          Giảm dự kiến khoảng <strong>{fmtMoney(voucherEst ?? 0)}</strong> (ước tính, số tiền thật theo hóa đơn khi thanh toán). Tạm tính bên dưới chưa trừ ưu đãi.
                        </>
                      )}
                    </div>
                  )}
                </div>
                <button className="text-btn" type="button" onClick={removeVoucher}>
                  Gỡ mã
                </button>
              </div>
            ) : (
              <div className="row gap8">
                <input
                  id="voucher-code"
                  className="field"
                  value={voucherInput}
                  maxLength={40}
                  autoCapitalize="characters"
                  placeholder="Nhập mã, ví dụ HENGAPLAI"
                  onChange={(e) => setVoucherInput(normVoucher(e.target.value))}
                />
                <button
                  className="btn secondary"
                  type="button"
                  style={{ width: 'auto', flex: 'none', minHeight: 44 }}
                  disabled={voucherBusy || !voucherInput}
                  onClick={() => void checkVoucher(voucherInput, total)}
                >
                  {voucherBusy ? 'Đang kiểm…' : 'Kiểm tra'}
                </button>
              </div>
            )}
            {voucher && quoteFailed && (
              <p className="tiny muted mt8 mb0" role="status">
                Chưa kiểm tra được mã, sẽ thử lại. Mã vẫn được giữ và gửi kèm đơn.
              </p>
            )}
            {voucherErr && (
              <p className="error-text" role="alert">
                {voucherErr}
              </p>
            )}
            <p className="tiny muted mt8 mb0">
              Nhân viên sẽ áp dụng khi thanh toán. Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ
              món.
            </p>
          </div>

          {error && <div aria-hidden="true" style={{ height: 96 }} />}
          <p className="tiny muted center">
            {brand?.paymentNote ?? 'Đơn chỉ được gửi khi bạn nhấn nút bên dưới.'}
          </p>
        </>
      )}

      {editing && (
        <FoodSheet
          item={editing.item}
          initial={{ quantity: editing.quantity, note: editing.note, options: editing.options }}
          onClose={() => setEditing(null)}
          onConfirm={(quantity, n, options) => {
            update(editing.id, quantity, n, options);
            setEditing(null);
            toast('Đã cập nhật món');
          }}
        />
      )}
    </Shell>
  );
}
