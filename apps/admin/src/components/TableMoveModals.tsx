import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg, errCode } from '../errors';
import { fmtMoney } from '../format';
import { TABLE_STATUS } from '../labels';
import type { SessionView, TablesData } from '../types';
import { Badge, Field, Modal, useToast } from '../ui';

function moveErr(e: unknown, role: string | undefined): string {
  const code = errCode(e);
  const msg = billErrMsg(e);
  if ((e as { status?: number }).status === 403) {
    return role === 'WAITER'
      ? 'Phục vụ chỉ được đổi bàn khi quán bật cài đặt “pos.allowWaiterMoveTable”. Hãy nhờ thu ngân hoặc quản lý đổi bàn.'
      : msg;
  }
  if (code === 'TARGET_TABLE_BUSY') return `${msg}. Danh sách bàn đã được tải lại, hãy chọn bàn khác.`;
  if (code === 'SESSION_CHANGED') return 'Phiên bàn vừa thay đổi (có người khác đổi/gộp bàn). Đã tải lại, vui lòng thử lại.';
  return msg;
}

/** Doi ban: chon ban dich (chi liet ke ban trong), xac nhan, xu ly loi bien. */
export function MoveTableModal({
  view,
  tables,
  currentTableId,
  onClose,
  onDone,
}: {
  view: SessionView;
  tables: TablesData;
  currentTableId: string;
  onClose: () => void;
  onDone: (toTableId: string, toCode: string) => void;
}) {
  const { activeStore, me } = useApp();
  const toast = useToast();
  const active = view.tables.filter((t) => t.active);
  const [fromId, setFromId] = useState(
    active.find((t) => t.id === currentTableId)?.id ?? active.find((t) => t.role === 'PRIMARY')?.id ?? active[0]?.id ?? currentTableId,
  );
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const free = (tables.areas ?? [])
    .map((a) => ({
      area: a.name,
      rows: a.tables.filter((t) => (t.status === 'AVAILABLE' || t.status === 'CLEANED') && !t.sessionId),
    }))
    .filter((a) => a.rows.length > 0);
  const toCode = free.flatMap((a) => a.rows).find((t) => t.id === toId)?.code;
  const fromCode = active.find((t) => t.id === fromId)?.code ?? '';
  const paid = (view.bill?.paidAmount ?? 0) > 0;

  const submit = async () => {
    if (busy || !toId || !view.session) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/pos/sessions/${view.session.id}/move-table`, {
        method: 'POST',
        body: { toTableId: toId, fromTableId: active.length > 1 ? fromId : undefined, reason: reason.trim() || undefined },
      });
      toast(`Đã đổi bàn ${fromCode} → ${toCode}. Bàn ${fromCode} chuyển sang “Cần dọn”.`);
      onDone(toId, toCode ?? '');
      onClose();
    } catch (e) {
      setErr(moveErr(e, me?.role));
      if (errCode(e) === 'TARGET_TABLE_BUSY' || errCode(e) === 'SESSION_CHANGED') {
        setToId('');
        onDone('', '');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Đổi bàn ${fromCode}`}
      subtitle="Chuyển cả phiên (các đợt gọi món, hóa đơn) sang bàn trống khác"
      onClose={busy ? () => undefined : onClose}
      width={520}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className="button primary" disabled={busy || !toId} onClick={submit}>
            {busy ? 'Đang chuyển...' : toCode ? `Đổi sang bàn ${toCode}` : 'Chọn bàn đích'}
          </button>
        </>
      }
    >
      {active.length > 1 && (
        <Field label="Bàn cần chuyển (phiên đang gộp nhiều bàn)">
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
                {t.role === 'MERGED' ? ' (bàn gộp)' : ' (bàn chính)'}
              </option>
            ))}
          </select>
        </Field>
      )}
      <span className="option-label" style={{ marginTop: 0 }}>
        Bàn đích (chỉ liệt kê bàn trống)
      </span>
      {free.length === 0 ? (
        <div className="notice warning">Hiện không có bàn trống để đổi. Dọn bàn trước hoặc dùng “Gộp bàn”.</div>
      ) : (
        free.map((a) => (
          <div key={a.area}>
            <div className="area-heading" style={{ margin: '12px 0 6px' }}>
              {a.area}
            </div>
            <div className="chip-pick">
              {a.rows.map((t) => (
                <button key={t.id} className={toId === t.id ? 'on' : ''} onClick={() => setToId(t.id)} type="button">
                  {t.code}
                  <small>{t.seats ?? '—'} chỗ</small>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      <Field label="Lý do (tuỳ chọn)">
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="vd: Khách muốn ngồi gần cửa sổ" />
      </Field>
      <div className="notice" style={{ marginTop: 6 }}>
        Trạng thái các món giữ nguyên. Bàn {fromCode} chuyển sang “Cần dọn”, bếp/bar nhận phiếu “ĐỔI BÀN” cho các món chưa ra.
        {paid && ' Hóa đơn đã thu một phần vẫn được giữ nguyên khi đổi bàn.'}
      </div>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

/** Gop ban: gop phien cua ban nguon VAO phien dang xem. Khong hoan tac. */
export function MergeTableModal({
  view,
  tables,
  onClose,
  onDone,
}: {
  view: SessionView;
  tables: TablesData;
  onClose: () => void;
  onDone: () => void;
}) {
  const { activeStore, me } = useApp();
  const toast = useToast();
  const [srcSession, setSrcSession] = useState('');
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mine = new Set(view.tables.map((t) => t.id));
  const cands = (tables.areas ?? [])
    .flatMap((a) => a.tables.map((t) => ({ ...t, area: a.name })))
    .filter((t) => t.status === 'OCCUPIED' && t.sessionId && t.sessionId !== view.session?.id && !mine.has(t.id));
  const src = cands.find((t) => t.sessionId === srcSession);
  const srcPaid = !!src && (src.billStatus === 'PARTIALLY_PAID' || (src.billTotal != null && src.billRemaining != null && src.billRemaining < src.billTotal));
  const myPaid = (view.bill?.paidAmount ?? 0) > 0;
  const blocked = srcPaid || myPaid;
  const myCodes = view.tables.filter((t) => t.active).map((t) => t.code).join(', ');

  const submit = async () => {
    if (busy || !srcSession || !view.session) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/pos/sessions/${view.session.id}/merge`, {
        method: 'POST',
        body: { sourceSessionId: srcSession, reason: reason.trim() || undefined },
      });
      toast(`Đã gộp bàn ${src?.code} vào ${myCodes}. Hai bàn dùng chung một hóa đơn.`);
      onDone();
      onClose();
    } catch (e) {
      const code = errCode(e);
      setErr(
        code === 'HAS_PAYMENT'
          ? 'Một trong hai hóa đơn đã thanh toán một phần nên không thể gộp. Thu nốt hoặc hoàn tiền trước.'
          : code === 'SESSION_CHANGED'
            ? 'Phiên bàn vừa thay đổi. Đã tải lại, vui lòng thử lại.'
            : moveErr(e, me?.role),
      );
      if (code === 'SESSION_CHANGED' || code === 'HAS_PAYMENT') onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Gộp bàn vào ${myCodes}`}
      subtitle="Hai bàn dùng chung một hóa đơn; món vẫn mang ra đúng bàn của khách"
      onClose={busy ? () => undefined : onClose}
      width={540}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className="button danger" disabled={busy || !srcSession || blocked || !sure} onClick={submit}>
            {busy ? 'Đang gộp...' : src ? `Gộp bàn ${src.code} vào ${myCodes}` : 'Chọn bàn cần gộp'}
          </button>
        </>
      }
    >
      <span className="option-label" style={{ marginTop: 0 }}>
        Chọn bàn đang có khách để gộp vào bàn này
      </span>
      {cands.length === 0 ? (
        <div className="notice warning">Không có bàn nào khác đang có khách để gộp.</div>
      ) : (
        <div className="chip-pick">
          {cands.map((t) => (
            <button key={t.id} className={srcSession === t.sessionId ? 'on' : ''} onClick={() => { setSrcSession(t.sessionId!); setSure(false); }} type="button">
              {t.code}
              <small>
                {t.openOrders} đơn · {fmtMoney(t.billTotal ?? t.openAmount)}
              </small>
            </button>
          ))}
        </div>
      )}
      {blocked && (
        <div className="form-error" style={{ marginTop: 12 }}>
          {srcPaid ? `Bàn ${src?.code} đã thanh toán một phần` : 'Hóa đơn bàn này đã thanh toán một phần'}, không thể gộp. Hãy thu nốt hoặc nhờ quản lý hoàn tiền trước.
        </div>
      )}
      <Field label="Lý do (tuỳ chọn)">
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="vd: Hai nhóm khách ghép chung" />
      </Field>
      <div className="notice warning" style={{ marginTop: 6, lineHeight: 1.7 }}>
        <b>Không thể hoàn tác.</b> Hóa đơn của bàn nguồn bị huỷ (các khoản giảm giá đã áp trên hóa đơn đó sẽ mất), hóa đơn của bàn này được tính lại. Thanh toán xong cả hai bàn cùng sang “Cần dọn”.
      </div>
      <label className="check-row">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        Tôi hiểu và muốn gộp bàn
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

export function MergedBadges({ view, currentTableId }: { view: SessionView; currentTableId: string }) {
  const merged = view.tables.filter((t) => t.active && t.id !== currentTableId);
  const moved = view.tables.filter((t) => !t.active && t.role === 'MOVED_FROM');
  if (merged.length === 0 && moved.length === 0) return null;
  return (
    <div className="trace-row">
      {merged.map((t) => (
        <Badge key={t.id} cls="blue">
          {t.role === 'PRIMARY' ? 'Bàn chính' : 'Gộp với'} {t.code}
          {t.status ? ` · ${TABLE_STATUS[t.status]?.label ?? ''}` : ''}
        </Badge>
      ))}
      {moved.map((t) => (
        <Badge key={t.id} cls="amber">
          Đổi từ bàn {t.code}
        </Badge>
      ))}
    </div>
  );
}
