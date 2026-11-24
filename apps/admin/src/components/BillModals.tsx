import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg, errCode, errExtra, newIdemKey } from '../errors';
import { fmtDateTime, fmtMoney } from '../format';
import { BILL_STATUS, CONFIRMED_BY, ITEM_STATUS, PAY_METHOD } from '../labels';
import { useRealtime } from '../realtime';
import type { Bill, BillPayment, SessionView } from '../types';
import { Badge, Field, Icon, Modal, useToast } from '../ui';

// ================= Giam gia cap ban =================

interface DiscountLimits {
  cashierMaxPercent: number | null;
  cashierMaxAmount: number | null;
}

/**
 * Them giam gia cap ban. Vuot han muc cashier thi API tra 403 NEED_APPROVAL: hien o nhap
 * thong tin quan ly duyet (email + mat khau). Mat khau chi nam trong state cua hop thoai nay,
 * khong luu o dau khac va bi xoa sau moi lan gui.
 */
export function DiscountModal({
  bill,
  onClose,
  onDone,
}: {
  bill: Bill;
  onClose: () => void;
  onDone: (view: SessionView) => void;
}) {
  const { activeStore } = useApp();
  const toast = useToast();
  const [type, setType] = useState<'AMOUNT' | 'PERCENT'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [needApproval, setNeedApproval] = useState<DiscountLimits | null>(null);
  const [approverEmail, setApproverEmail] = useState('');
  const [approverPw, setApproverPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const num = Number(value.replace(',', '.'));
  const preview = type === 'PERCENT' ? Math.round((bill.subtotal * num) / 100) : num;
  const invalid =
    !value || !isFinite(num) || num <= 0 || !reason.trim() || (type === 'PERCENT' && num > 100) || (needApproval !== null && (!approverEmail.trim() || !approverPw));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const view = await api<SessionView>(`/stores/${activeStore!.id}/pos/bills/${bill.id}/discounts`, {
        method: 'POST',
        body: {
          type,
          value: num,
          reason: reason.trim(),
          expectedVersion: bill.version,
          approver: needApproval ? { email: approverEmail.trim(), password: approverPw } : undefined,
        },
      });
      toast(needApproval ? 'Đã áp giảm giá (quản lý đã duyệt)' : 'Đã áp giảm giá cho cả bàn');
      onDone(view);
      onClose();
    } catch (e) {
      if (errCode(e) === 'NEED_APPROVAL') {
        setNeedApproval(errExtra<DiscountLimits>(e, 'limits') ?? { cashierMaxPercent: null, cashierMaxAmount: null });
        setErr(null);
      } else {
        setErr(billErrMsg(e));
      }
    } finally {
      setApproverPw(''); // khong giu mat khau sau khi gui
      setBusy(false);
    }
  };

  const lim = needApproval;
  return (
    <Modal
      title="Giảm giá cho cả bàn"
      subtitle={`Hóa đơn ${bill.billNo} · Tạm tính ${fmtMoney(bill.subtotal)}`}
      onClose={busy ? () => undefined : onClose}
      width={480}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className="button primary" disabled={busy || invalid} onClick={submit}>
            {busy ? 'Đang xử lý...' : needApproval ? 'Duyệt và áp giảm giá' : 'Áp giảm giá'}
          </button>
        </>
      }
    >
      <div className="radio-choices" style={{ marginTop: 0 }}>
        {(['PERCENT', 'AMOUNT'] as const).map((t) => (
          <label key={t}>
            <input type="radio" name="disc-type" checked={type === t} onChange={() => setType(t)} />
            {t === 'PERCENT' ? 'Theo phần trăm (%)' : 'Theo số tiền (đ)'}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <Field label={type === 'PERCENT' ? 'Phần trăm giảm' : 'Số tiền giảm (đ)'} required>
          <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={type === 'PERCENT' ? 'vd: 10' : 'vd: 20000'} />
        </Field>
        <Field label="Giảm quy đổi">
          <input readOnly value={value && isFinite(num) ? fmtMoney(preview) : ''} />
        </Field>
      </div>
      <Field label="Lý do giảm giá" required hint="Bắt buộc, được ghi vào nhật ký để đối soát">
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="vd: Khách quen, khuyến mãi sinh nhật" />
      </Field>
      {lim && (
        <div className="notice warning" style={{ lineHeight: 1.7 }}>
          <b>Giảm giá vượt hạn mức của thu ngân.</b> Hạn mức:{' '}
          {lim.cashierMaxPercent !== null ? `${lim.cashierMaxPercent}% tạm tính` : 'không giới hạn %'}
          {' · '}
          {lim.cashierMaxAmount !== null ? `${fmtMoney(lim.cashierMaxAmount)}` : 'không giới hạn số tiền'}. Nhờ quản lý hoặc chủ quán nhập thông tin để duyệt:
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Email quản lý" required>
              <input type="email" autoComplete="off" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} />
            </Field>
            <Field label="Mật khẩu quản lý" required>
              <input type="password" autoComplete="new-password" value={approverPw} onChange={(e) => setApproverPw(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

// ================= Thanh toan hoa don =================

type Mode = 'FULL' | 'PART' | 'EVEN' | 'ITEMS';

const MODES: { key: Mode; label: string }[] = [
  { key: 'FULL', label: 'Thu đủ' },
  { key: 'PART', label: 'Thu một phần' },
  { key: 'EVEN', label: 'Chia đều' },
  { key: 'ITEMS', label: 'Chia theo món' },
];

const intOf = (s: string) => {
  const n = Number(s);
  return isFinite(n) ? Math.floor(n) : 0;
};

/** Goi y tien khach dua: so tien, roi cac menh gia tron lon hon */
function cashSuggestions(amount: number): number[] {
  const out = new Set<number>([amount]);
  for (const step of [10000, 50000, 100000, 200000, 500000]) {
    const v = Math.ceil(amount / step) * step;
    if (v >= amount) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

interface PayResult {
  replayed: boolean;
  bill: Bill;
  payment: BillPayment;
  remaining: number;
  change: number | null;
  tablesStatus: { id: string; code: string; status: string }[];
}

export function CheckoutModal({
  tableCode,
  initial,
  canPrint,
  onClose,
  onChanged,
}: {
  tableCode: string;
  initial: SessionView;
  canPrint: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const billId = initial.bill!.id;

  const [view, setView] = useState<SessionView>(initial);
  const bill = view.bill ?? initial.bill!;
  const [mode, setMode] = useState<Mode>('FULL');
  const [method, setMethod] = useState<'CASH' | 'TRANSFER' | 'QR_BANK'>('CASH');
  const [partAmount, setPartAmount] = useState('');
  const [parts, setParts] = useState('2');
  const [evenAmounts, setEvenAmounts] = useState<number[]>([]);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [itemPrev, setItemPrev] = useState<{ amount: number; allAssigned: boolean } | null>(null);
  const [payerLabel, setPayerLabel] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unserved, setUnserved] = useState<number | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  // khoa idempotency on dinh theo noi dung lan bam; chi doi khi noi dung doi hoac lan truoc that bai han
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const busyRef = useRef(false);

  const closed = bill.status !== 'OPEN' && bill.status !== 'PARTIALLY_PAID';
  const remaining = bill.remaining;

  const reloadView = async () => {
    try {
      const v = await api<SessionView>(`/stores/${sid}/pos/bills/${billId}`);
      setView(v);
      return v;
    } catch {
      return null;
    }
  };

  // bill doi (goi them mon, thu ngan khac thu, ...): lam moi ngam trong hop thoai
  useRealtime(sid, (e) => {
    if (e.type === 'order.created' || e.type === 'order.status' || e.type === 'table.moved') void reloadView();
  });

  // ---- Chia deu ----
  const evenPaid = useMemo(
    () => bill.payments.filter((p) => p.status === 'COMPLETED' && p.allocation?.mode === 'EVEN'),
    [bill.payments],
  );
  const partsN = evenPaid.length > 0 ? evenPaid[0].allocation!.parts ?? 2 : Math.min(50, Math.max(2, intOf(parts) || 2));
  const nextIndex = evenPaid.length + 1;
  const leftParts = partsN - evenPaid.length;

  useEffect(() => {
    if (mode !== 'EVEN' || closed) return;
    if (leftParts < 2) {
      setEvenAmounts(leftParts === 1 ? [remaining] : []);
      return;
    }
    let cancelled = false;
    api<{ amounts: number[] }>(`/stores/${sid}/pos/bills/${billId}/split/preview`, {
      method: 'POST',
      body: { mode: 'EVEN', parts: leftParts },
    })
      .then((r) => !cancelled && setEvenAmounts(r.amounts))
      .catch((e) => !cancelled && setErr(billErrMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [mode, leftParts, remaining, closed, bill.version, sid, billId]);

  // ---- Chia theo mon ----
  const allocated = useMemo(() => {
    const m = new Map<string, number>();
    bill.payments
      .filter((p) => p.status === 'COMPLETED' && p.allocation?.mode === 'ITEMS')
      .forEach((p) => p.allocation!.lines?.forEach((l) => m.set(l.orderItemId, (m.get(l.orderItemId) ?? 0) + l.quantity)));
    return m;
  }, [bill.payments]);

  const itemRows = useMemo(
    () =>
      view.orders.flatMap((o) =>
        o.items
          .filter((it) => it.status !== 'CANCELLED')
          .map((it) => ({ o, it, left: it.quantity - (allocated.get(it.id) ?? 0) })),
      ),
    [view.orders, allocated],
  );
  const selLines = Object.entries(sel)
    .filter(([, q]) => q > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const selKey = JSON.stringify(selLines);

  useEffect(() => {
    if (mode !== 'ITEMS' || closed) return;
    if (selLines.length === 0) {
      setItemPrev(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api<{ groups: { amount: number }[]; allAssigned: boolean }>(`/stores/${sid}/pos/bills/${billId}/split/preview`, {
        method: 'POST',
        body: { mode: 'ITEMS', groups: [{ lines: selLines }] },
      })
        .then((r) => !cancelled && setItemPrev({ amount: r.groups[0]?.amount ?? 0, allAssigned: r.allAssigned }))
        .catch((e) => {
          if (!cancelled) {
            setItemPrev(null);
            setErr(billErrMsg(e));
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selKey, closed, bill.version]);

  // ---- So tien lan thu nay ----
  const amount =
    mode === 'FULL'
      ? remaining
      : mode === 'PART'
        ? intOf(partAmount)
        : mode === 'EVEN'
          ? evenAmounts[0] ?? 0
          : itemPrev?.amount ?? 0;

  const received = cashReceived === '' ? null : intOf(cashReceived);
  const cashShort = method === 'CASH' && received !== null && received < amount;
  const change = method === 'CASH' && received !== null && received >= amount ? received - amount : null;
  const amountBad =
    amount <= 0 || amount > remaining || (mode === 'EVEN' && (leftParts < 1 || (evenPaid.length === 0 && intOf(parts) < 2)));

  const buildBody = (confirmUnserved: boolean) => {
    const body: Record<string, unknown> = { method, expectedVersion: bill.version };
    if (mode === 'PART') body.amount = amount;
    if (mode === 'EVEN') body.allocation = { mode: 'EVEN', parts: partsN, index: nextIndex };
    if (mode === 'ITEMS') body.allocation = { mode: 'ITEMS', lines: selLines };
    if (method === 'CASH' && received !== null) body.cashReceived = received;
    if (payerLabel.trim()) body.payerLabel = payerLabel.trim();
    if (confirmUnserved) body.confirmUnserved = true;
    return body;
  };

  const submit = async (confirmUnserved = false) => {
    if (busyRef.current || amountBad || cashShort) return;
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    setUnserved(null);
    const body = buildBody(confirmUnserved);
    const sig = JSON.stringify(body);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdemKey() };
    try {
      const r = await api<PayResult>(`/stores/${sid}/pos/bills/${billId}/payments`, {
        method: 'POST',
        body: { ...body, idempotencyKey: keyRef.current.key },
      });
      keyRef.current = null;
      setResult(r);
      toast(r.replayed ? 'Giao dịch này đã được ghi nhận trước đó' : `Đã thu ${fmtMoney(r.payment.amount)} (${PAY_METHOD[r.payment.method] ?? r.payment.method})`);
      setPartAmount('');
      setCashReceived('');
      setSel({});
      setItemPrev(null);
      await reloadView();
      onChanged();
    } catch (e) {
      const code = errCode(e);
      const status = (e as { status?: number }).status ?? 0;
      // mat ket noi / loi may chu: ket qua chua ro, giu nguyen khoa de bam lai khong thu hai lan
      if (status === 0 || status >= 500) {
        setErr(billErrMsg(e));
      } else {
        keyRef.current = null;
        if (code === 'UNSERVED_ITEMS') {
          setUnserved(errExtra<number>(e, 'unservedItems') ?? view.unservedItems ?? 1);
        } else {
          setErr(billErrMsg(e));
          if (code === 'BILL_CLOSED' || code === 'BILL_CHANGED' || status === 409) {
            await reloadView();
            onChanged();
          }
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const printBill = async () => {
    setPrintBusy(true);
    try {
      const r = await api<{ queued: boolean; mode: string; status?: string; failedReason?: string | null }>(
        `/stores/${sid}/pos/bills/${billId}/print`,
        { method: 'POST', body: { kind: 'BILL' } },
      );
      if (!r.queued) toast('Quán đang ở chế độ chỉ dùng màn hình bếp, không in giấy.', 'info');
      else if (r.status === 'FAILED') toast(`Chưa in được bill: ${r.failedReason ?? 'máy in lỗi'}`, 'err');
      else toast('Đã gửi lệnh in bill');
    } catch (e) {
      toast(billErrMsg(e), 'err');
    } finally {
      setPrintBusy(false);
    }
  };

  const setSelQty = (id: string, q: number, max: number) =>
    setSel((s) => ({ ...s, [id]: Math.max(0, Math.min(max, q)) }));

  const paidList = bill.payments.filter((p) => p.status === 'COMPLETED');
  const st = BILL_STATUS[bill.status] ?? { label: bill.status, cls: 'grey' };

  return (
    <Modal
      title={`Thanh toán bàn ${tableCode}`}
      subtitle={`Hóa đơn ${bill.billNo} · ${view.orders.length} đợt gọi món`}
      onClose={busy ? () => undefined : onClose}
      wide
      footer={
        closed ? (
          <>
            <span className="small muted">
              <Badge cls={st.cls}>{st.label}</Badge>
            </span>
            <div className="actions">
              {canPrint && bill.status === 'PAID' && (
                <button className="button" disabled={printBusy} onClick={printBill}>
                  <Icon name="printer" size={14} /> {printBusy ? 'Đang gửi...' : 'In bill'}
                </button>
              )}
              <button className="button primary" onClick={onClose}>
                Xong
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="small muted">Chỉ xác nhận sau khi đã nhận đủ tiền của phần này.</span>
            <button className="button primary" disabled={busy || amountBad || cashShort} onClick={() => submit(false)}>
              {busy ? 'Đang xử lý...' : `Xác nhận đã nhận ${fmtMoney(amount)}`}
            </button>
          </>
        )
      }
    >
      <div className="checkout-grid">
        <div>
          <div className="small muted">CÒN PHẢI THU</div>
          <div className="checkout-amount" style={{ marginBottom: 6 }}>
            {fmtMoney(remaining)}
          </div>
          <div className="summary-line">
            <span>Tạm tính</span>
            <span>{fmtMoney(bill.subtotal)}</span>
          </div>
          {bill.discountAmount > 0 && (
            <div className="summary-line">
              <span>Giảm giá</span>
              <span>− {fmtMoney(bill.discountAmount)}</span>
            </div>
          )}
          {bill.vatAmount > 0 && (
            <div className="summary-line">
              <span>VAT</span>
              <span>{fmtMoney(bill.vatAmount)}</span>
            </div>
          )}
          <div className="summary-line">
            <span>Tổng hóa đơn</span>
            <b>{fmtMoney(bill.totalAmount)}</b>
          </div>
          <div className="summary-line">
            <span>Đã thu</span>
            <b>{fmtMoney(bill.paidAmount)}</b>
          </div>
          {paidList.length > 0 && (
            <>
              <span className="option-label">Các lần đã thu</span>
              {paidList.map((p) => (
                <div key={p.id} className="paid-row">
                  <span>
                    {PAY_METHOD[p.method] ?? p.method}
                    {p.payerLabel ? ` · ${p.payerLabel}` : ''}
                    {p.method === 'QR_BANK' && p.confirmedBy ? ` · ${CONFIRMED_BY[p.confirmedBy] ?? p.confirmedBy}` : ''}
                    <small>
                      {p.allocation?.mode === 'EVEN' ? `Phần ${p.allocation.index}/${p.allocation.parts} · ` : p.allocation?.mode === 'ITEMS' ? 'Theo món · ' : ''}
                      {p.paidAt ? fmtDateTime(p.paidAt) : ''}
                    </small>
                  </span>
                  <b>{fmtMoney(p.amount)}</b>
                </div>
              ))}
            </>
          )}
        </div>

        <div>
          {/* ket qua lan thu truoc: an khi hoa don da doi (thu ngan khac thu them, goi them mon...) de khong gay hieu nham */}
          {result && result.bill.paidAmount === bill.paidAmount && (
            <div className="notice" style={{ lineHeight: 1.7 }}>
              <b>Đã ghi nhận {fmtMoney(result.payment.amount)}</b> ({PAY_METHOD[result.payment.method] ?? result.payment.method}
              {result.replayed ? ', giao dịch trùng khóa nên không thu thêm' : ''}).
              {result.change !== null && result.change > 0 && (
                <>
                  {' '}
                  Trả lại khách: <b>{fmtMoney(result.change)}</b>.
                </>
              )}
              {result.bill.status === 'PAID' ? (
                <>
                  {' '}
                  Hóa đơn đã thanh toán đủ, bàn{' '}
                  {result.tablesStatus.map((t) => `${t.code}: ${t.status === 'NEED_CLEAN' ? 'Cần dọn' : t.status}`).join(', ')}.
                </>
              ) : (
                <> Còn lại {fmtMoney(result.remaining)}.</>
              )}
            </div>
          )}

          {closed ? (
            !(result && result.bill.paidAmount === bill.paidAmount) && (
              <div className="notice warning">
                Hóa đơn này đã {bill.status === 'PAID' ? 'thanh toán đủ' : 'đóng'}, không thể thu thêm.
              </div>
            )
          ) : (
            <>
              <div className="tabs" style={{ marginBottom: 14 }}>
                {MODES.map((m) => (
                  <button key={m.key} className={`tab${mode === m.key ? ' active' : ''}`} onClick={() => setMode(m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === 'PART' && (
                <Field label="Số tiền thu lần này (đ)" required hint={`Tối đa ${fmtMoney(remaining)}`}>
                  <input type="number" min={1} max={remaining} value={partAmount} onChange={(e) => setPartAmount(e.target.value)} autoFocus />
                </Field>
              )}

              {mode === 'EVEN' && (
                <>
                  <div className="form-grid">
                    <Field label="Chia cho mấy người" hint={evenPaid.length > 0 ? 'Đã thu theo cách chia này nên không đổi được số phần' : '2 đến 50 phần'}>
                      <input type="number" min={2} max={50} value={evenPaid.length > 0 ? partsN : parts} disabled={evenPaid.length > 0} onChange={(e) => setParts(e.target.value)} />
                    </Field>
                    <Field label="Đang thu phần">
                      <input readOnly value={leftParts >= 1 ? `${nextIndex} / ${partsN}` : 'Đã thu đủ các phần'} />
                    </Field>
                  </div>
                  {evenAmounts.length > 0 && (
                    <div className="part-chips">
                      {evenAmounts.map((a, i) => (
                        <span key={i} className={i === 0 ? 'on' : ''}>
                          Phần {nextIndex + i}: {fmtMoney(a)}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}

              {mode === 'ITEMS' && (
                <>
                  <span className="option-label" style={{ marginTop: 0 }}>
                    Chọn món của người đang thanh toán
                  </span>
                  <div className="item-pick">
                    {itemRows.length === 0 && <span className="small muted">Không còn món nào để chia.</span>}
                    {itemRows.map(({ o, it, left }) => (
                      <div key={it.id} className={`item-pick-row${left <= 0 ? ' done' : ''}`}>
                        <span>
                          {it.name}
                          <small>
                            Đợt {o.round} · #{o.orderNumber} · còn {Math.max(0, left)}/{it.quantity} · {fmtMoney(it.price)}
                          </small>
                        </span>
                        {left > 0 ? (
                          <div className="qty-control">
                            <button aria-label={`Bớt ${it.name}`} onClick={() => setSelQty(it.id, (sel[it.id] ?? 0) - 1, left)}>
                              −
                            </button>
                            <span>{sel[it.id] ?? 0}</span>
                            <button aria-label={`Thêm ${it.name}`} onClick={() => setSelQty(it.id, (sel[it.id] ?? 0) + 1, left)}>
                              +
                            </button>
                          </div>
                        ) : (
                          <Badge cls="grey">Đã thu</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  {itemPrev && (
                    <div className="small muted" style={{ marginTop: 6 }}>
                      Phần của người này: <b>{fmtMoney(itemPrev.amount)}</b>
                      {itemPrev.allAssigned ? ' (đã gồm toàn bộ số còn lại, gồm cả phần làm tròn)' : ''}
                    </div>
                  )}
                </>
              )}

              <span className="option-label">Phương thức nhận tiền</span>
              <div className="radio-choices" style={{ marginTop: 8 }}>
                {(['CASH', 'TRANSFER', 'QR_BANK'] as const).map((m) => (
                  <label key={m}>
                    <input type="radio" name="pay-method" checked={method === m} onChange={() => setMethod(m)} />
                    {PAY_METHOD[m]}
                  </label>
                ))}
              </div>

              {method === 'CASH' && (
                <>
                  <div className="form-grid">
                    <Field label="Tiền khách đưa (đ)">
                      <input type="number" min={0} step={1000} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
                    </Field>
                    <Field label="Tiền trả lại khách">
                      <input
                        readOnly
                        value={received === null ? '' : cashShort ? `Còn thiếu ${fmtMoney(amount - received)}` : fmtMoney(change)}
                        style={cashShort ? { color: 'var(--red)' } : undefined}
                      />
                    </Field>
                  </div>
                  {amount > 0 && (
                    <div className="cash-quick">
                      {cashSuggestions(amount).map((v) => (
                        <button key={v} type="button" onClick={() => setCashReceived(String(v))}>
                          {v === amount ? 'Đủ ' : ''}
                          {fmtMoney(v)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <Field label="Ghi chú người trả (tuỳ chọn)">
                <input value={payerLabel} maxLength={60} onChange={(e) => setPayerLabel(e.target.value)} placeholder="vd: Anh Nam" />
              </Field>

              {unserved !== null && (
                <div className="notice warning" style={{ lineHeight: 1.7 }}>
                  <b>Còn {unserved} món chưa ra.</b> Lần thu này sẽ đóng hóa đơn và bàn. Vẫn thanh toán?
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button className="button tiny primary" disabled={busy} onClick={() => submit(true)}>
                      Vẫn thanh toán
                    </button>
                    <button className="button tiny" onClick={() => setUnserved(null)}>
                      Chưa, để kiểm tra lại
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {err && <div className="form-error">{err}</div>}
        </div>
      </div>

      {view.orders.length > 0 && (
        <details className="bill-details">
          <summary>Chi tiết món ({view.orders.reduce((s, o) => s + o.items.filter((i) => i.status !== 'CANCELLED').length, 0)} dòng)</summary>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                {view.orders.flatMap((o) =>
                  o.items.map((it) => (
                    <tr key={it.id} style={{ opacity: it.status === 'CANCELLED' ? 0.45 : 1 }}>
                      <td>
                        {it.name}
                        <small>
                          Đợt {o.round} · #{o.orderNumber} · {(ITEM_STATUS[it.status] ?? { label: it.status }).label}
                        </small>
                      </td>
                      <td className="num">{it.quantity}×</td>
                      <td className="num">{fmtMoney(it.totalAmount)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Modal>
  );
}
