import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg, errCode } from '../errors';
import { fmtMoney } from '../format';
import { QR_STATUS } from '../labels';
import { qrSvg } from '../qr';
import { useRealtime } from '../realtime';
import type { Bill, QrIntent, SessionView } from '../types';
import { Badge, Field, Modal, useToast } from '../ui';

const MIN_QR = 1000;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Thanh toan QR cua hoa don: chon so tien (con lai / mot phan / chia deu), tao ma VietQR (ve tu qrPayload),
 * dem nguoc han, gia han / huy, trang thai thoi gian thuc, thu ngan "Xac nhan da nhan tien".
 */
export default function QrModal({ bill: initialBill, tableCode, onClose, onChanged }: { bill: Bill; tableCode: string; onClose: () => void; onChanged: () => void }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const [bill, setBill] = useState<Bill>(initialBill);
  const [intents, setIntents] = useState<QrIntent[] | null>(null);
  const [mode, setMode] = useState<'FULL' | 'PART' | 'EVEN'>('FULL');
  const [partAmount, setPartAmount] = useState('');
  const [parts, setParts] = useState('2');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paidNote, setPaidNote] = useState<string | null>(null);
  const now = useNow();
  const busyRef = useRef(false);

  const loadBill = async () => {
    try {
      const v = await api<SessionView>(`/stores/${sid}/pos/bills/${bill.id}`);
      if (v.bill) setBill(v.bill);
    } catch {
      /* giu ban cu */
    }
  };
  const loadIntents = async () => {
    try {
      setIntents(await api<QrIntent[]>(`/stores/${sid}/pos/bills/${bill.id}/qr-intents`));
    } catch (e) {
      setErr(billErrMsg(e));
      setIntents((x) => x ?? []);
    }
  };
  const reloadAll = () => {
    void loadIntents();
    void loadBill();
    onChanged();
  };

  useEffect(() => {
    void loadIntents();
    const t = setInterval(() => void loadIntents(), 3000); // theo doi trang thai (du phong cho SSE)
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime(sid, (e) => {
    if (e.type === 'payment.confirmed' || e.type === 'payment.partial' || e.type === 'payment.expired') {
      if (e.type === 'payment.confirmed') {
        const d = (e.data ?? {}) as { billId?: string; amount?: number };
        if (d.billId === bill.id) setPaidNote(`Đã nhận ${fmtMoney(d.amount ?? 0)} qua QR.`);
      }
      reloadAll();
    }
    if (e.type === 'order.created' || e.type === 'order.status') void loadBill();
  });

  const closed = bill.status !== 'OPEN' && bill.status !== 'PARTIALLY_PAID';
  const remaining = bill.remaining;
  const pending = useMemo(() => (intents ?? []).filter((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_PAID'), [intents]);
  const active = pending[0] ?? null;
  const stale = (intents ?? []).filter((i) => i.status === 'SUPERSEDED' || i.status === 'EXPIRED').slice(0, 1)[0] ?? null;

  const partsN = Math.min(50, Math.max(2, Math.floor(Number(parts)) || 2));
  const amount = mode === 'FULL' ? remaining : mode === 'PART' ? Math.floor(Number(partAmount) || 0) : Math.floor(remaining / partsN);
  const amountBad = amount < MIN_QR || amount > remaining;
  const dup = pending.some((i) => i.amount === amount);

  const create = async () => {
    if (busyRef.current || amountBad) return;
    if (dup) {
      setErr(`Đã có mã QR đang chờ đúng số tiền ${fmtMoney(amount)}. Hãy dùng mã đó hoặc huỷ trước khi tạo mã mới, tránh khách quét nhầm.`);
      return;
    }
    busyRef.current = true;
    setBusy('create');
    setErr(null);
    try {
      await api<QrIntent>(`/stores/${sid}/pos/bills/${bill.id}/qr`, { method: 'POST', body: mode === 'FULL' ? {} : { amount } });
      await loadIntents();
      await loadBill();
    } catch (e) {
      setErr(billErrMsg(e));
      if (errCode(e) === 'BILL_CLOSED') reloadAll();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const act = async (i: QrIntent, what: 'cancel' | 'extend') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(what);
    setErr(null);
    try {
      await api(`/stores/${sid}/pos/qr-intents/${i.intentId}/${what}`, { method: 'POST' });
      toast(what === 'cancel' ? 'Đã huỷ mã QR' : 'Đã gia hạn mã QR');
      await loadIntents();
    } catch (e) {
      setErr(billErrMsg(e));
      void loadIntents();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const manualConfirm = async (i: QrIntent) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('confirm');
    setErr(null);
    try {
      const r = await api<{ replayed: boolean; payment: { amount: number }; bill: Bill }>(`/stores/${sid}/pos/qr-intents/${i.intentId}/manual-confirm`, { method: 'POST', body: { reason: 'Thu ngân xác nhận đã thấy tiền về' } });
      setPaidNote(`${r.replayed ? 'Đã ghi nhận trước đó: ' : 'Đã ghi nhận '}${fmtMoney(r.payment.amount)} (thu ngân xác nhận).`);
      setConfirmOpen(false);
      reloadAll();
    } catch (e) {
      const code = errCode(e);
      setErr(
        code === 'INTENT_STATE'
          ? 'Mã QR này đã được thanh toán hoặc đã huỷ (có thể tiền vừa về tự động). Đã tải lại.'
          : code === 'BILL_CLOSED'
            ? 'Hóa đơn này đã được thanh toán đủ, không cần xác nhận thêm.'
            : billErrMsg(e),
      );
      setConfirmOpen(false);
      reloadAll();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const left = active ? Math.max(0, Math.floor((new Date(active.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!active && left === 0;
  // tu xac nhan chua bat (autoConfirm=false) hoac da cho > 60 giay: cho phep thu ngan xac nhan tay
  const waitedSec = active ? Math.floor((now - new Date(active.createdAt).getTime()) / 1000) : 0;
  const canManual = !!active && (!active.autoConfirm || waitedSec >= 60);

  return (
    <Modal
      title={`Thanh toán QR · bàn ${tableCode}`}
      subtitle={`Hóa đơn ${bill.billNo} · còn phải thu ${fmtMoney(remaining)}`}
      onClose={busy ? () => undefined : onClose}
      width={560}
      footer={
        <>
          <span className="small muted">Hóa đơn chỉ được coi là đã trả khi tiền về hoặc thu ngân xác nhận.</span>
          <button className="button" onClick={onClose}>
            Đóng
          </button>
        </>
      }
    >
      {paidNote && <div className="notice" style={{ lineHeight: 1.7 }}><b>{paidNote}</b>{closed ? ' Hóa đơn đã thanh toán đủ.' : ` Còn lại ${fmtMoney(remaining)}.`}</div>}
      {closed && !paidNote && <div className="notice warning">Hóa đơn đã đóng, không tạo thêm mã QR.</div>}

      {active ? (
        <div style={{ textAlign: 'center' }}>
          <div className="qr-box" dangerouslySetInnerHTML={{ __html: qrSvg(active.qrPayload, 260) }} />
          <div className="checkout-amount" style={{ marginBottom: 4 }}>{fmtMoney(active.amount)}</div>
          <div style={{ marginBottom: 8 }}>
            <Badge cls={(QR_STATUS[expired ? 'EXPIRED' : active.status] ?? { cls: 'grey' }).cls}>{(QR_STATUS[expired ? 'EXPIRED' : active.status] ?? { label: active.status }).label}</Badge>
            {!expired && <span className="small muted" style={{ marginLeft: 8 }}>còn hiệu lực {mmss(left)}</span>}
          </div>
          <div className="small" style={{ lineHeight: 1.8 }}>
            {active.bank.bankName} · {active.bank.accountNumber}
            <br />
            {active.bank.accountName}
            <br />
            Mã đối soát (nội dung chuyển khoản): <b style={{ letterSpacing: 1 }}>{active.code}</b>
          </div>
          {active.status === 'PARTIALLY_PAID' && <div className="notice warning" style={{ marginTop: 10 }}>Mới nhận một phần, còn thiếu {fmtMoney(active.remaining)}. Khách chuyển thêm hoặc thu phần còn lại bằng cách khác.</div>}
          {!active.autoConfirm && <div className="small muted" style={{ marginTop: 8 }}>Tài khoản chưa xác minh tự động: sau khi thấy tiền về, bấm “Xác nhận đã nhận tiền”.</div>}
          <div className="actions" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button className="button primary" disabled={!!busy || !canManual} title={canManual ? '' : 'Chờ tiền về tự động; nút mở sau 60 giây'} onClick={() => setConfirmOpen(true)}>
              Xác nhận đã nhận tiền
            </button>
            <button className="button" disabled={!!busy} onClick={() => act(active, 'extend')}>
              Gia hạn
            </button>
            <button className="button danger" disabled={!!busy} onClick={() => act(active, 'cancel')}>
              Huỷ mã
            </button>
          </div>
          {!canManual && <div className="small muted" style={{ marginTop: 6 }}>Đang chờ tiền về tự động... (nút xác nhận tay mở sau {Math.max(0, 60 - waitedSec)} giây)</div>}
        </div>
      ) : !closed ? (
        <>
          {stale && (
            <div className="notice warning">
              {stale.status === 'SUPERSEDED' ? 'Hóa đơn đã thay đổi (gọi thêm, giảm giá hoặc huỷ món) nên mã QR cũ không còn đúng số tiền. Tạo lại mã mới.' : 'Mã QR gần nhất đã hết hạn. Tạo mã mới hoặc gia hạn.'}
              {stale.status === 'EXPIRED' && (
                <button className="button tiny" style={{ marginLeft: 8 }} disabled={!!busy} onClick={() => act(stale, 'extend')}>
                  Gia hạn mã cũ ({fmtMoney(stale.amount)})
                </button>
              )}
            </div>
          )}
          <div className="tabs" style={{ marginBottom: 14 }}>
            {([['FULL', 'Số còn lại'], ['PART', 'Một phần'], ['EVEN', 'Chia đều']] as const).map(([k, label]) => (
              <button key={k} className={`tab${mode === k ? ' active' : ''}`} onClick={() => setMode(k)}>
                {label}
              </button>
            ))}
          </div>
          {mode === 'PART' && (
            <Field label="Số tiền của mã QR (đ)" required hint={`Từ ${fmtMoney(MIN_QR)} đến ${fmtMoney(remaining)}`}>
              <input type="number" min={MIN_QR} max={remaining} value={partAmount} onChange={(e) => setPartAmount(e.target.value)} autoFocus />
            </Field>
          )}
          {mode === 'EVEN' && (
            <Field label="Chia cho mấy người" hint="Mỗi mã QR là một phần; tạo mã tiếp cho người sau khi người trước đã trả">
              <input type="number" min={2} max={50} value={parts} onChange={(e) => setParts(e.target.value)} />
            </Field>
          )}
          <div className="summary-line total">
            <span>Số tiền mã QR</span>
            <strong>{fmtMoney(amount)}</strong>
          </div>
          <button className="button primary full" disabled={!!busy || amountBad || remaining <= 0} onClick={create}>
            {busy === 'create' ? 'Đang tạo mã...' : 'Tạo mã QR'}
          </button>
        </>
      ) : null}
      {err && <div className="form-error" style={{ marginTop: 12 }}>{err}</div>}

      {confirmOpen && active && (
        <Modal
          title="Xác nhận đã nhận tiền"
          onClose={() => setConfirmOpen(false)}
          width={420}
          footer={
            <>
              <button className="button" onClick={() => setConfirmOpen(false)}>Chưa, quay lại</button>
              <button className="button primary" disabled={busy === 'confirm'} onClick={() => manualConfirm(active)}>
                {busy === 'confirm' ? 'Đang ghi nhận...' : `Đã thấy ${fmtMoney(active.amount)} về tài khoản`}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>
            Chỉ xác nhận khi bạn đã thấy <b>{fmtMoney(active.amount)}</b> vào tài khoản {active.bank.bankName} {active.bank.accountNumber} với nội dung chứa mã <b>{active.code}</b>. Thao tác được ghi lại là “thu ngân xác nhận”.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
