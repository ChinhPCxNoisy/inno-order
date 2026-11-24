import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg } from '../errors';
import { fmtDateTime, fmtMoney, localDateStr } from '../format';
import { BANK_TXN_STATUS } from '../labels';
import { useRealtimeRefresh } from '../realtime';
import type { PaymentSettings, BankTxn, BankTxnList, PaymentAccount, PendingRefund, Reconciliation } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

type Tab = 'pending' | 'recon' | 'refunds' | 'accounts';

/** Danh sach ngan hang pho bien (BIN 6 so theo Napas). Kiem tra lai khi cau hinh cho quan that. */
const BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970426', name: 'MSB' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970431', name: 'Eximbank' },
];

const MANAGE_ROLES = ['SUPER_ADMIN', 'OWNER', 'MANAGER'];

// ================= Tai khoan nhan tien =================

function AccountModal({ initial, onClose, onSaved, onSecret }: { initial: PaymentAccount | null; onClose: () => void; onSaved: () => void; onSecret: (s: { url: string | null; secret: string | null; label: string }) => void }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const isEdit = !!initial;
  const [f, setF] = useState({
    label: initial?.label ?? '',
    bankBin: initial?.bankBin ?? BANKS[0].bin,
    bankName: initial?.bankName ?? BANKS[0].name,
    accountNumber: '',
    accountName: initial?.accountName ?? '',
    provider: initial?.provider ?? 'MANUAL',
    isDefault: initial?.isDefault ?? false,
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const known = BANKS.some((b) => b.bin === f.bankBin);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (!f.label.trim() || !f.accountName.trim()) throw new Error('Nhập tên gợi nhớ và tên chủ tài khoản');
      if (!/^\d{6}$/.test(f.bankBin)) throw new Error('Mã ngân hàng (BIN) gồm 6 chữ số');
      if (!isEdit && !/^\d{4,20}$/.test(f.accountNumber)) throw new Error('Số tài khoản chỉ gồm chữ số (4-20 ký tự)');
      if (!f.password) throw new Error('Nhập lại mật khẩu của bạn để xác nhận');
      const base = { label: f.label.trim(), bankBin: f.bankBin, bankName: f.bankName.trim(), accountName: f.accountName.trim().toUpperCase(), isDefault: f.isDefault, password: f.password };
      if (isEdit) {
        const body: Record<string, unknown> = { ...base };
        if (f.accountNumber) body.accountNumber = f.accountNumber; // để trống = giữ số cũ (đang bị che)
        await api(`/stores/${activeStore!.id}/payment-accounts/${initial!.id}`, { method: 'PATCH', body });
        toast('Đã cập nhật tài khoản. Nếu đổi ngân hàng/số tài khoản, cần tiền về lại để xác minh.');
      } else {
        const r = await api<{ webhookUrl: string | null; webhookSecret: string | null }>(`/stores/${activeStore!.id}/payment-accounts`, {
          method: 'POST',
          body: { ...base, accountNumber: f.accountNumber, provider: f.provider },
        });
        toast('Đã thêm tài khoản nhận tiền');
        if (r.webhookSecret) onSecret({ url: r.webhookUrl, secret: r.webhookSecret, label: f.label });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error && !('status' in e) ? e.message : billErrMsg(e));
    } finally {
      setF((x) => ({ ...x, password: '' }));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Sửa tài khoản: ${initial!.label}` : 'Thêm tài khoản nhận tiền'}
      subtitle="Mã VietQR của hóa đơn sẽ trỏ tới tài khoản này"
      onClose={busy ? () => undefined : onClose}
      width={560}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ
          </button>
          <button className="button primary" disabled={busy} onClick={submit}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </>
      }
    >
      <Field label="Tên gợi nhớ" required>
        <input value={f.label} maxLength={80} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="vd: Quầy chính" autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="Ngân hàng" required>
          <select
            value={known ? f.bankBin : 'other'}
            onChange={(e) => {
              const b = BANKS.find((x) => x.bin === e.target.value);
              setF({ ...f, bankBin: b ? b.bin : '', bankName: b ? b.name : '' });
            }}
          >
            {BANKS.map((b) => (
              <option key={b.bin} value={b.bin}>
                {b.name} ({b.bin})
              </option>
            ))}
            <option value="other">Ngân hàng khác (nhập BIN)</option>
          </select>
        </Field>
        <Field label={isEdit ? 'Số tài khoản mới' : 'Số tài khoản'} required={!isEdit} hint={isEdit ? `Hiện tại ${initial!.accountNumber}. Để trống nếu không đổi.` : 'Chỉ gồm chữ số'}>
          <input inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      {!known && (
        <div className="form-grid">
          <Field label="Mã ngân hàng (BIN, 6 số)" required>
            <input value={f.bankBin} maxLength={6} onChange={(e) => setF({ ...f, bankBin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Tên ngân hàng" required>
            <input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Tên chủ tài khoản" required hint="Đúng như ngân hàng ghi, không dấu">
        <input value={f.accountName} maxLength={100} onChange={(e) => setF({ ...f, accountName: e.target.value })} placeholder="NGUYEN VAN A" />
      </Field>
      {!isEdit && (
        <Field label="Cách nhận tín hiệu tiền về" hint="Thủ công: thu ngân tự bấm xác nhận. Giả lập (MOCK): dùng để thử, tiền về qua nút giả lập / webhook ký.">
          <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as 'MANUAL' | 'MOCK' })}>
            <option value="MANUAL">Thủ công (thu ngân xác nhận)</option>
            <option value="MOCK">Giả lập (MOCK) để thử nghiệm</option>
          </select>
        </Field>
      )}
      <label className="check-row">
        <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
        Dùng làm tài khoản mặc định
      </label>
      <Field label="Nhập lại mật khẩu của bạn để xác nhận" required hint="Bắt buộc khi thêm hoặc đổi tài khoản nhận tiền. Mật khẩu không được lưu.">
        <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

/** Hop thoai nhap lai mat khau cho thao tac nhay cam (tat tai khoan, xoay secret) */
function PasswordAction({ title, message, confirmLabel, danger, onSubmit, onClose }: { title: string; message: string; confirmLabel: string; danger?: boolean; onSubmit: (password: string) => Promise<void>; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onClose}
      width={460}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button
            className={`button ${danger ? 'danger' : 'primary'}`}
            disabled={busy || !pw}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSubmit(pw);
              } catch (e) {
                setErr(billErrMsg(e));
              } finally {
                setPw('');
                setBusy(false);
              }
            }}
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{message}</p>
      <Field label="Nhập lại mật khẩu của bạn" required>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function SecretModal({ s, onClose }: { s: { url: string | null; secret: string | null; label: string }; onClose: () => void }) {
  const toast = useToast();
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast('Đã copy');
    } catch {
      toast('Không thể copy, hãy bôi đen và sao chép', 'err');
    }
  };
  return (
    <Modal title={`Webhook của “${s.label}”`} subtitle="Chỉ hiện MỘT LẦN, đóng hộp thoại là không xem lại được" onClose={onClose} width={620} footer={<><span /><button className="button primary" onClick={onClose}>Tôi đã lưu lại</button></>}>
      <div className="notice warning" style={{ lineHeight: 1.7 }}>Dán đường dẫn và bí mật vào cấu hình webhook của đối tác ngân hàng. Giữ kín như mật khẩu. Đổi bí mật sẽ làm webhook cũ ngừng hoạt động và đặt lại trạng thái xác minh.</div>
      <span className="option-label">Đường dẫn webhook</span>
      <div className="token-box"><span>{s.url}</span><button className="button tiny" onClick={() => s.url && copy(s.url)}><Icon name="copy" size={13} /> Copy</button></div>
      <span className="option-label">Bí mật ký (HMAC)</span>
      <div className="token-box"><span>{s.secret}</span><button className="button tiny" onClick={() => s.secret && copy(s.secret)}><Icon name="copy" size={13} /> Copy</button></div>
    </Modal>
  );
}

function AccountsTab({ canManage, accounts }: { canManage: boolean; accounts: { data: PaymentAccount[] | null; loading: boolean; error: string | null; refresh: () => void } }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const [modal, setModal] = useState<{ acc: PaymentAccount | null } | null>(null);
  const [pw, setPw] = useState<{ kind: 'delete' | 'rotate'; acc: PaymentAccount } | null>(null);
  const [secret, setSecret] = useState<{ url: string | null; secret: string | null; label: string } | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const ps = useFetch<PaymentSettings | null>(() => (canManage ? api<PaymentSettings>(`/stores/${sid}/payment-settings`) : Promise.resolve(null)), [sid, canManage]);

  const setCustomerQr = async (on: boolean) => {
    if (qrBusy) return;
    setQrBusy(true);
    try {
      await api(`/stores/${sid}/payment-settings`, { method: 'PATCH', body: { customerCanPayQr: on } });
      toast(on ? 'Đã bật: khách có thể tự lấy mã QR thanh toán' : 'Đã tắt khách tự trả QR');
      ps.refresh();
    } catch (e) {
      toast(billErrMsg(e), 'err');
      ps.refresh();
    } finally {
      setQrBusy(false);
    }
  };

  const toggle = async (a: PaymentAccount) => {
    try {
      await api(`/stores/${sid}/payment-accounts/${a.id}`, { method: 'PATCH', body: { isActive: !a.isActive } });
      toast(a.isActive ? 'Đã tắt tài khoản. Mã QR đang chờ vẫn có thể hết hạn.' : 'Đã bật tài khoản');
      accounts.refresh();
    } catch (e) {
      toast(billErrMsg(e), 'err');
    }
  };

  if (accounts.loading) return <Loading />;
  if (accounts.error) return <div className="alert-strip">{accounts.error}</div>;
  const list = accounts.data ?? [];
  return (
    <>
      {canManage && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2>Khách tự trả QR</h2>
            {ps.data && <Badge cls={ps.data.customerCanPayQr ? 'green' : 'grey'}>{ps.data.customerCanPayQr ? 'Đang bật' : 'Đang tắt (mặc định)'}</Badge>}
          </div>
          <p className="small muted" style={{ lineHeight: 1.7, marginBottom: 10 }}>
            Khi bật, khách trên mini app lấy được mã QR của hóa đơn mình. Hệ thống chỉ coi là đã trả khi tiền thật về hoặc thu ngân xác nhận. Điều kiện: quán phải có ít nhất một tài khoản nhận tiền đang hoạt động.
          </p>
          {ps.loading ? (
            <Loading />
          ) : ps.error ? (
            <div className="form-error">{ps.error}</div>
          ) : ps.data ? (
            <>
              <label className="check-row">
                <input type="checkbox" checked={ps.data.customerCanPayQr} disabled={qrBusy || (!ps.data.hasActiveAccount && !ps.data.customerCanPayQr)} onChange={(e) => setCustomerQr(e.target.checked)} />
                Cho phép khách tự lấy mã QR thanh toán
              </label>
              {!ps.data.hasActiveAccount && <div className="notice warning" style={{ marginTop: 8 }}>Chưa có tài khoản nhận tiền đang hoạt động nên chưa thể bật (hoặc nút QR sẽ không hiện cho khách). Hãy thêm hoặc bật một tài khoản bên dưới.</div>}
              {ps.data.customerCanPayQr && !ps.data.hasActiveAccount && <div className="notice warning" style={{ marginTop: 8 }}>Đang bật nhưng không có tài khoản đang hoạt động: khách chưa thấy nút QR.</div>}
            </>
          ) : null}
        </section>
      )}
      {canManage && (
        <div className="actions" style={{ marginBottom: 14 }}>
          <button className="button primary" onClick={() => setModal({ acc: null })}>
            <Icon name="plus" /> Thêm tài khoản nhận tiền
          </button>
        </div>
      )}
      {list.length === 0 ? (
        <section className="panel">
          <Empty title="Chưa có tài khoản nhận tiền" sub="Thêm tài khoản để POS tạo được mã VietQR." />
        </section>
      ) : (
        <div className="agent-grid">
          {list.map((a) => (
            <div key={a.id} className={`agent-card${a.isActive ? '' : ' revoked'}`}>
              <h3>
                <span className={`dot ${a.isActive ? 'on' : ''}`} />
                {a.label}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {a.isDefault && <Badge cls="blue">Mặc định</Badge>}
                  <Badge cls={a.provider === 'MOCK' ? 'amber' : 'grey'}>{a.provider === 'MOCK' ? 'Giả lập' : 'Thủ công'}</Badge>
                  {!a.isActive && <Badge cls="grey">Đã tắt</Badge>}
                </span>
              </h3>
              <p>
                {a.bankName} · {a.accountNumber}
                <br />
                {a.accountName}
              </p>
              <div className="small muted" style={{ marginBottom: 12 }}>
                {a.verifiedAt ? `Đã xác minh ${fmtDateTime(a.verifiedAt)}` : 'Chưa xác minh (cần một giao dịch tiền về hợp lệ; tới lúc đó khách trả QR cần thu ngân xác nhận tay)'}
                {a.lastWebhookAt ? ` · webhook gần nhất ${fmtDateTime(a.lastWebhookAt)}` : ''}
              </div>
              {canManage && (
                <div className="actions">
                  <button className="button tiny" onClick={() => setModal({ acc: a })}>
                    <Icon name="edit" size={13} /> Sửa
                  </button>
                  <button className="button tiny" onClick={() => toggle(a)}>
                    {a.isActive ? 'Tắt' : 'Bật'}
                  </button>
                  {a.supportsWebhook && (
                    <button className="button tiny" onClick={() => setPw({ kind: 'rotate', acc: a })}>
                      <Icon name="key" size={13} /> Đổi bí mật webhook
                    </button>
                  )}
                  <button className="button tiny danger" onClick={() => setPw({ kind: 'delete', acc: a })}>
                    Xoá
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {modal && <AccountModal initial={modal.acc} onClose={() => setModal(null)} onSaved={accounts.refresh} onSecret={setSecret} />}
      {pw?.kind === 'rotate' && (
        <PasswordAction
          title={`Đổi bí mật webhook “${pw.acc.label}”`}
          message="Đường dẫn và bí mật cũ hết hiệu lực ngay, tài khoản trở về trạng thái chưa xác minh. Bí mật mới chỉ hiện một lần."
          confirmLabel="Đổi bí mật"
          danger
          onClose={() => setPw(null)}
          onSubmit={async (password) => {
            const r = await api<{ webhookUrl: string; webhookSecret: string }>(`/stores/${sid}/payment-accounts/${pw.acc.id}/rotate-secret`, { method: 'POST', body: { password } });
            setSecret({ url: r.webhookUrl, secret: r.webhookSecret, label: pw.acc.label });
            setPw(null);
            accounts.refresh();
          }}
        />
      )}
      {pw?.kind === 'delete' && (
        <PasswordAction
          title={`Xoá tài khoản “${pw.acc.label}”`}
          message="Tài khoản bị tắt (lịch sử giao dịch được giữ) và các mã QR đang chờ bị huỷ."
          confirmLabel="Xoá tài khoản"
          danger
          onClose={() => setPw(null)}
          onSubmit={async (password) => {
            await api(`/stores/${sid}/payment-accounts/${pw.acc.id}`, { method: 'DELETE', body: { password } });
            toast('Đã xoá (tắt) tài khoản');
            setPw(null);
            accounts.refresh();
          }}
        />
      )}
      {secret && <SecretModal s={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

// ================= Giao dich cho xu ly =================

interface OpenBill {
  id: string;
  billNo: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  tableCodes?: string[];
}

function AttachModal({ txn, onClose, onDone }: { txn: BankTxn; onClose: () => void; onDone: () => void }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const [billId, setBillId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bills = useFetch<{ data: OpenBill[] }>(() => api(`/stores/${activeStore!.id}/pos/bills?page=1&pageSize=100`), [activeStore?.id]);
  const open = (bills.data?.data ?? []).filter((b) => b.status === 'OPEN' || b.status === 'PARTIALLY_PAID');

  const submit = async () => {
    if (busy || !billId) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/bank-transactions/${txn.id}/resolve`, { method: 'POST', body: { action: 'ATTACH_TO_BILL', billId, note: note.trim() || undefined } });
      toast(`Đã gán ${fmtMoney(txn.amount)} vào hóa đơn`);
      onDone();
      onClose();
    } catch (e) {
      setErr(billErrMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Gán giao dịch ${fmtMoney(txn.amount)} vào hóa đơn`}
      subtitle={txn.content ?? ''}
      onClose={busy ? () => undefined : onClose}
      width={520}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>Huỷ bỏ</button>
          <button className="button primary" disabled={busy || !billId} onClick={submit}>{busy ? 'Đang gán...' : 'Gán vào hóa đơn'}</button>
        </>
      }
    >
      {bills.loading ? (
        <Loading />
      ) : open.length === 0 ? (
        <div className="notice warning">Không có hóa đơn nào đang chờ thanh toán để gán.</div>
      ) : (
        <Field label="Hóa đơn đang mở" required hint="Số tiền ghi nhận là phần còn thiếu của hóa đơn; phần dư (nếu có) để hoàn lại cho khách.">
          <select value={billId} onChange={(e) => setBillId(e.target.value)}>
            <option value="">— Chọn hóa đơn —</option>
            {open.map((b) => (
              <option key={b.id} value={b.id}>
                {b.billNo}
                {b.tableCodes?.length ? ` · bàn ${b.tableCodes.join(', ')}` : ''} · còn {fmtMoney(b.totalAmount - b.paidAmount)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Ghi chú (tuỳ chọn)">
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function NoteAction({ title, message, confirmLabel, required, onSubmit, onClose }: { title: string; message: string; confirmLabel: string; required: boolean; onSubmit: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onClose}
      width={480}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>Huỷ bỏ</button>
          <button
            className="button primary"
            disabled={busy || (required && !note.trim())}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSubmit(note.trim());
              } catch (e) {
                setErr(billErrMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{message}</p>
      <Field label={required ? 'Ghi chú / số tham chiếu' : 'Ghi chú (tuỳ chọn)'} required={required}>
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function PendingTab({ canManage, accounts }: { canManage: boolean; accounts: PaymentAccount[] }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const [page, setPage] = useState(1);
  const [attach, setAttach] = useState<BankTxn | null>(null);
  const [note, setNote] = useState<{ txn: BankTxn; action: 'IGNORE' | 'MARK_REFUND_PENDING' | 'MARK_REFUNDED' } | null>(null);
  const list = useFetch<BankTxnList>(() => api(`/stores/${sid}/bank-transactions?status=PENDING&page=${page}&pageSize=20`), [sid, page]);
  useRealtimeRefresh(sid, ['payment.needs_review', 'payment.confirmed', 'payment.partial'], list.refresh);
  useEffect(() => {
    const t = setInterval(() => list.refresh(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mock = accounts.find((a) => a.provider === 'MOCK' && a.isActive);
  const [sim, setSim] = useState({ amount: '', content: '' });
  const [simBusy, setSimBusy] = useState(false);
  const simulate = async () => {
    if (!mock || simBusy) return;
    setSimBusy(true);
    try {
      const r = await api<{ duplicate: boolean; transaction: BankTxn }>(`/stores/${sid}/payments/mock/simulate`, {
        method: 'POST',
        body: { accountId: mock.id, amount: Number(sim.amount), content: sim.content },
      });
      toast(r.duplicate ? 'Giao dịch trùng, bỏ qua' : `Đã giả lập tiền về: ${BANK_TXN_STATUS[r.transaction.status]?.label ?? r.transaction.status}`);
      list.refresh();
    } catch (e) {
      toast(billErrMsg(e), 'err');
    } finally {
      setSimBusy(false);
    }
  };

  const resolve = async (txn: BankTxn, action: string, n?: string) => {
    await api(`/stores/${sid}/bank-transactions/${txn.id}/resolve`, { method: 'POST', body: { action, note: n || undefined } });
    toast(action === 'IGNORE' ? 'Đã bỏ qua giao dịch' : action === 'MARK_REFUND_PENDING' ? 'Đã đánh dấu cần chuyển trả khách' : 'Đã ghi nhận chuyển trả');
    setNote(null);
    list.refresh();
  };

  if (list.loading) return <Loading />;
  if (list.error) return <div className="alert-strip">{list.error}</div>;
  const d = list.data!;
  const totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const canAttach = (s: string) => ['UNMATCHED', 'NEEDS_REVIEW', 'DUPLICATE_PAYMENT', 'LATE_CLOSED'].includes(s);

  return (
    <>
      {mock && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2>Giả lập tiền về (tài khoản MOCK “{mock.label}”)</h2>
            <span className="small muted">Chỉ dùng thử nghiệm, không phải tiền thật</span>
          </div>
          <div className="form-grid">
            <Field label="Số tiền (đ)">
              <input type="number" min={1000} value={sim.amount} onChange={(e) => setSim({ ...sim, amount: e.target.value })} />
            </Field>
            <Field label="Nội dung chuyển khoản" hint="Dán mã đối soát (IO...) của mã QR để tự khớp">
              <input value={sim.content} onChange={(e) => setSim({ ...sim, content: e.target.value })} />
            </Field>
          </div>
          <button className="button" disabled={simBusy || !sim.amount} onClick={simulate}>
            {simBusy ? 'Đang gửi...' : 'Giả lập tiền về'}
          </button>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Giao dịch chờ xử lý</h2>
          <span className="small muted">{d.pendingCount} giao dịch · tự làm mới</span>
        </div>
        {d.data.length === 0 ? (
          <Empty title="Không có giao dịch chờ xử lý" sub="Tiền về khớp hóa đơn sẽ được ghi nhận tự động." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th className="num">Số tiền</th>
                  <th>Nội dung</th>
                  <th>Tình trạng</th>
                  <th className="num"></th>
                </tr>
              </thead>
              <tbody>
                {d.data.map((t) => {
                  const st = BANK_TXN_STATUS[t.status] ?? { label: t.status, cls: 'grey', hint: '' };
                  return (
                    <tr key={t.id}>
                      <td>
                        {fmtDateTime(t.transferredAt ?? t.receivedAt)}
                        {t.counterpartyName && <small>{t.counterpartyName}</small>}
                        {t.counterpartyAccountMasked && <small>{t.counterpartyAccountMasked}</small>}
                      </td>
                      <td className="num">
                        <strong>{fmtMoney(t.amount)}</strong>
                        {t.excessAmount ? <small>Dư {fmtMoney(t.excessAmount)}</small> : null}
                      </td>
                      <td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{t.content ?? <span className="muted">—</span>}</td>
                      <td>
                        <Badge cls={st.cls}>{st.label}</Badge>
                        {st.hint && <small>{st.hint}</small>}
                        {t.resolutionNote && <small>{t.resolutionNote}</small>}
                      </td>
                      <td>
                        <div className="job-actions">
                          {canAttach(t.status) && (
                            <button className="button tiny primary" onClick={() => setAttach(t)}>
                              Gán vào hóa đơn
                            </button>
                          )}
                          {canManage && t.status === 'REFUND_PENDING' && (
                            <button className="button tiny" onClick={() => setNote({ txn: t, action: 'MARK_REFUNDED' })}>
                              Đã chuyển trả
                            </button>
                          )}
                          {canManage && t.status !== 'REFUND_PENDING' && (
                            <button className="button tiny" onClick={() => setNote({ txn: t, action: 'MARK_REFUND_PENDING' })}>
                              Cần hoàn tiền
                            </button>
                          )}
                          {canManage && (
                            <button className="button tiny danger" onClick={() => setNote({ txn: t, action: 'IGNORE' })}>
                              Bỏ qua
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            Trang {page}/{totalPages}
          </span>
          <div className="pages">
            <button className="button tiny" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Trước</button>
            <button className="button tiny" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sau →</button>
          </div>
        </div>
      </section>
      {attach && <AttachModal txn={attach} onClose={() => setAttach(null)} onDone={list.refresh} />}
      {note && (
        <NoteAction
          title={note.action === 'IGNORE' ? 'Bỏ qua giao dịch' : note.action === 'MARK_REFUND_PENDING' ? 'Đánh dấu cần hoàn tiền' : 'Đã chuyển trả khách'}
          message={
            note.action === 'IGNORE'
              ? `Bỏ qua ${fmtMoney(note.txn.amount)}? Giao dịch không được ghi vào hóa đơn nào. Cần ghi rõ lý do.`
              : note.action === 'MARK_REFUND_PENDING'
                ? `Đánh dấu ${fmtMoney(note.txn.amount)} cần chuyển trả khách thủ công.`
                : `Xác nhận bạn đã chuyển trả ${fmtMoney(note.txn.amount)} cho khách. Ghi số tham chiếu.`
          }
          confirmLabel="Xác nhận"
          required={note.action !== 'MARK_REFUND_PENDING'}
          onClose={() => setNote(null)}
          onSubmit={(n) => resolve(note.txn, note.action, n)}
        />
      )}
    </>
  );
}

// ================= Doi soat =================

function ReconTab() {
  const { activeStore } = useApp();
  const sid = activeStore!.id;
  const [date, setDate] = useState(localDateStr());
  const r = useFetch<Reconciliation>(() => api(`/stores/${sid}/reconciliation?date=${date}`), [sid, date]);
  useRealtimeRefresh(sid, ['payment.confirmed', 'payment.partial', 'payment.needs_review'], r.refresh);
  const d = r.data;
  return (
    <>
      <div className="filters">
        <Field label="Ngày">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <div className="alert-strip">{r.error}</div>
      ) : d ? (
        <>
          <div className={`notice${d.balanced ? '' : ' warning'}`}>
            {d.balanced ? 'Đối soát cân: tiền về ngân hàng khớp với số đã ghi nhận.' : `Có chênh lệch: ${d.mismatches.length} điểm lệch và ${d.unresolvedCount} giao dịch chưa xử lý.`}
          </div>
          <div className="stat-grid">
            <section className="stat"><div className="stat-top"><span>Tiền về ngân hàng</span><i>đ</i></div><div className="stat-value">{fmtMoney(d.bankInTotal)}</div><div className="stat-bottom">{d.bankInCount} giao dịch</div></section>
            <section className="stat"><div className="stat-top"><span>Đã khớp hóa đơn</span><i>đ</i></div><div className="stat-value">{fmtMoney(d.matchedAppliedTotal)}</div><div className="stat-bottom">Đã ghi vào thanh toán</div></section>
            <section className="stat"><div className="stat-top"><span>Chưa khớp (chờ xử lý)</span><i>đ</i></div><div className="stat-value">{fmtMoney(d.pendingTotal)}</div><div className="stat-bottom">{d.unresolvedCount} giao dịch</div></section>
            <section className="stat"><div className="stat-top"><span>Bỏ qua / đã chuyển trả</span><i>đ</i></div><div className="stat-value">{fmtMoney(d.ignoredTotal + d.refundedTotal)}</div><div className="stat-bottom">Bỏ qua {fmtMoney(d.ignoredTotal)} · trả {fmtMoney(d.refundedTotal)}</div></section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Thanh toán QR trong ngày</h2></div>
            <div className="metric-list">
              <div className="metric-row"><span>Tổng thu QR</span><b>{fmtMoney(d.qrPaymentTotal)}</b></div>
              <div className="metric-row"><span>Tự động (tiền về)</span><b>{fmtMoney(d.qrAutoConfirmTotal)}</b></div>
              <div className="metric-row"><span>Thu ngân xác nhận tay</span><b>{fmtMoney(d.qrManualConfirmTotal)}</b></div>
              <div className="metric-row"><span>Hoàn tiền QR</span><b>{fmtMoney(d.qrRefundTotal)}</b></div>
            </div>
          </section>
          {d.mismatches.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Điểm lệch</h2></div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Loại</th><th className="num">Kỳ vọng</th><th className="num">Thực tế</th><th>Mã</th></tr></thead>
                  <tbody>
                    {d.mismatches.map((m, i) => (
                      <tr key={i}>
                        <td>{m.type}</td>
                        <td className="num">{m.expected != null ? fmtMoney(m.expected) : '—'}</td>
                        <td className="num">{m.actual != null ? fmtMoney(m.actual) : '—'}</td>
                        <td className="muted">{m.txnId ?? m.paymentId ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {d.unresolved.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Giao dịch chưa xử lý trong ngày</h2></div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {d.unresolved.map((t) => (
                      <tr key={t.id}>
                        <td>{fmtDateTime(t.transferredAt ?? t.receivedAt)}</td>
                        <td className="num"><strong>{fmtMoney(t.amount)}</strong></td>
                        <td>{t.content}</td>
                        <td><Badge cls={(BANK_TXN_STATUS[t.status] ?? { cls: 'grey' }).cls}>{(BANK_TXN_STATUS[t.status] ?? { label: t.status }).label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}

// ================= Can chuyen tra thu cong =================

function RefundsTab() {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const list = useFetch<PendingRefund[]>(() => api(`/stores/${sid}/payments/pending-refunds`), [sid]);
  const [target, setTarget] = useState<PendingRefund | null>(null);
  if (list.loading) return <Loading />;
  if (list.error) return <div className="alert-strip">{list.error}</div>;
  const rows = list.data ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Cần chuyển trả khách thủ công</h2>
        <span className="small muted">Hoàn tiền hóa đơn đã trả bằng QR</span>
      </div>
      {rows.length === 0 ? (
        <Empty title="Không có khoản nào cần chuyển trả" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Thời gian</th><th className="num">Số tiền</th><th>Ghi chú</th><th className="num"></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.paymentId}>
                  <td>{fmtDateTime(r.createdAt)}</td>
                  <td className="num"><strong>{fmtMoney(r.amount)}</strong></td>
                  <td className="muted">{r.note ?? 'Cần chuyển trả thủ công cho khách'}</td>
                  <td className="num">
                    <button className="button tiny primary" onClick={() => setTarget(r)}>Hoàn tất</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <NoteAction
          title="Hoàn tất chuyển trả"
          message={`Xác nhận bạn đã chuyển trả ${fmtMoney(target.amount)} cho khách. Nhập số tham chiếu giao dịch chuyển khoản.`}
          confirmLabel="Hoàn tất"
          required
          onClose={() => setTarget(null)}
          onSubmit={async (reference) => {
            await api(`/stores/${sid}/payments/${target.paymentId}/refund/complete`, { method: 'POST', body: { reference } });
            toast('Đã ghi nhận chuyển trả');
            setTarget(null);
            list.refresh();
          }}
        />
      )}
    </section>
  );
}

export default function Payments() {
  const { activeStore, me } = useApp();
  const role = me?.role ?? '';
  const canManage = MANAGE_ROLES.includes(role);
  const [tab, setTab] = useState<Tab>('pending');
  const sid = activeStore!.id;
  const accounts = useFetch<PaymentAccount[]>(() => api(`/stores/${sid}/payment-accounts`), [sid]);
  const pend = useFetch<BankTxnList>(() => api(`/stores/${sid}/bank-transactions?status=PENDING&page=1&pageSize=1`), [sid]);
  const pendRef = useRef(pend.refresh);
  pendRef.current = pend.refresh;
  useRealtimeRefresh(sid, ['payment.needs_review', 'payment.confirmed'], () => pendRef.current());

  const tabs: [Tab, string][] = [
    ['pending', `Chờ xử lý${pend.data?.pendingCount ? ` (${pend.data.pendingCount})` : ''}`],
    ['recon', 'Đối soát trong ngày'],
    ...(canManage ? ([['refunds', 'Cần chuyển trả']] as [Tab, string][]) : []),
    ['accounts', 'Tài khoản nhận tiền'],
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Giao dịch ngân hàng</h1>
          <p>Tiền về qua VietQR: giao dịch cần xử lý, đối soát trong ngày và tài khoản nhận tiền.</p>
        </div>
      </header>
      <div className="filters">
        <div className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'pending' && <PendingTab canManage={canManage} accounts={accounts.data ?? []} />}
      {tab === 'recon' && <ReconTab />}
      {tab === 'refunds' && canManage && <RefundsTab />}
      {tab === 'accounts' && <AccountsTab canManage={canManage} accounts={accounts} />}
    </>
  );
}
