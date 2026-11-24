import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg, errCode, errExtra } from '../errors';
import { fmtMoney } from '../format';
import type { Bill, SessionView } from '../types';
import { Field, Modal, useToast } from '../ui';

interface CheckResult {
  valid: boolean;
  amount?: number;
  message?: string;
  canOverride?: boolean;
  needsApproval?: boolean;
}

/**
 * Ap ma uu dai vao hoa don: o nhap ma + chip ma khach khai bao, kiem tra truoc (khong tru luot),
 * hien so tien giam, ngoai le "chua dat toi thieu" / giam tay co san can quan ly duyet bang mat khau.
 */
export default function OfferApplyModal({ bill, requested, onClose, onDone }: { bill: Bill; requested: string[]; onClose: () => void; onDone: (v: SessionView) => void }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const [code, setCode] = useState(requested[0] ?? '');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [needApproval, setNeedApproval] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasManual = bill.discounts.some((d) => !d.offerId && d.kind !== 'VOUCHER');
  const clean = code.trim().toUpperCase();

  const doCheck = async () => {
    if (!clean || busy) return;
    setBusy('check');
    setErr(null);
    setCheck(null);
    try {
      const r = await api<CheckResult>(`/stores/${sid}/pos/bills/${bill.id}/offers/check`, { method: 'POST', body: { code: clean } });
      setCheck(r);
      if (r.needsApproval) setNeedApproval(true);
    } catch (e) {
      setErr(billErrMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!clean || busy) return;
    setBusy('apply');
    setErr(null);
    try {
      const view = await api<SessionView>(`/stores/${sid}/pos/bills/${bill.id}/offers`, {
        method: 'POST',
        body: {
          code: clean,
          override: override || undefined,
          reason: override ? reason.trim() : undefined,
          approver: needApproval || override ? { email: email.trim(), password: pw } : undefined,
        },
      });
      toast(`Đã áp mã ${clean}${check?.amount ? `: giảm ${fmtMoney(check.amount)}` : ''}`);
      onDone(view);
      onClose();
    } catch (e) {
      const c = errCode(e);
      if (c === 'MIN_SUBTOTAL' && errExtra<boolean>(e, 'canOverride')) {
        setOverride(true);
        setErr('Hóa đơn chưa đạt mức tối thiểu của ưu đãi. Có thể áp ngoại lệ: nhập lý do và nhờ quản lý duyệt.');
      } else if (c === 'NEED_APPROVAL') {
        setNeedApproval(true);
        setErr(null);
      } else setErr(billErrMsg(e));
    } finally {
      setPw('');
      setBusy(null);
    }
  };

  const needMgr = needApproval || override;
  return (
    <Modal
      title="Áp mã ưu đãi"
      subtitle={`Hóa đơn ${bill.billNo} · tạm tính ${fmtMoney(bill.subtotal)}`}
      onClose={busy ? () => undefined : onClose}
      width={500}
      footer={
        <>
          <button className="button" disabled={!!busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className="button primary" disabled={!!busy || !clean || (needMgr && (!email.trim() || !pw)) || (override && !reason.trim())} onClick={apply}>
            {busy === 'apply' ? 'Đang áp...' : needMgr ? 'Duyệt và áp mã' : 'Áp mã'}
          </button>
        </>
      }
    >
      {requested.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span className="option-label" style={{ marginTop: 0 }}>
            Khách muốn dùng (khai báo khi gọi món)
          </span>
          <div className="chip-pick">
            {requested.map((c) => (
              <button
                key={c}
                type="button"
                className={clean === c ? 'on' : ''}
                onClick={() => {
                  setCode(c);
                  setCheck(null);
                  setErr(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="Mã ưu đãi" required>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={code}
            maxLength={20}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setCheck(null);
            }}
            autoFocus
            placeholder="vd: HELLO10"
            onKeyDown={(e) => e.key === 'Enter' && doCheck()}
          />
          <button className="button" type="button" disabled={!!busy || !clean} onClick={doCheck}>
            {busy === 'check' ? 'Đang kiểm...' : 'Kiểm tra'}
          </button>
        </div>
      </Field>
      {check && (
        <div className={`notice${check.valid ? '' : ' warning'}`} style={{ lineHeight: 1.7 }}>
          {check.valid ? (
            <>
              Mã hợp lệ: giảm khoảng <b>{fmtMoney(check.amount ?? 0)}</b> (chưa trừ lượt, chưa áp vào hóa đơn).
            </>
          ) : (
            (check.message ?? 'Mã không áp dụng được cho hóa đơn này.')
          )}
          {!check.valid && check.canOverride && ' Có thể áp ngoại lệ với quản lý duyệt.'}
        </div>
      )}
      {hasManual && <div className="small muted" style={{ marginBottom: 8 }}>Hóa đơn đã có giảm giá tay: nếu ưu đãi không cho cộng dồn, cần quản lý duyệt.</div>}
      {override && (
        <Field label="Lý do áp ngoại lệ" required>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {needMgr && (
        <div className="notice warning" style={{ lineHeight: 1.7 }}>
          <b>Cần quản lý duyệt.</b> Nhờ quản lý hoặc chủ quán nhập thông tin:
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Email quản lý" required>
              <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mật khẩu quản lý" required>
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}
