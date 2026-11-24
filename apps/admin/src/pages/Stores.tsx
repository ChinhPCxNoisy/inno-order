import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { MODULE_DEFS } from '../labels';
import type { Store } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

function StoreFormModal({ initial, isEdit, onClose, onSaved }: { initial: Store | null; isEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const st = initial?.settings ?? {};
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    slug: initial?.slug ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
    logoUrl: initial?.logoUrl ?? '',
    bannerUrl: st.bannerUrl ?? '',
    themeColor: st.themeColor ?? '',
    welcomeText: st.welcomeText ?? '',
    paymentNote: st.paymentNote ?? '',
    showVoucherTab: st.showVoucherTab ?? true,
    showZaloLogin: st.showZaloLogin ?? true,
    allowWaiterMoveTable: st.pos?.allowWaiterMoveTable === true,
    printMode: st.printing?.mode ?? '',
    customerCanPayQr: st.payment?.customerCanPayQr === true,
  });
  // ban da tai luc mo form (de chi gui khoa da sua)
  const baseRef = useRef(form);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isEdit) {
        // Chi gui cac khoa nguoi dung THUC SU sua (so voi ban da tai): khong ghi de thay doi dong thoi tu noi khac.
        // Backend gop settings theo khoa; null chi khi chu y xoa (o trong).
        const base = baseRef.current;
        const ch = (k: keyof typeof form) => form[k] !== base[k];
        const txt = (k: 'bannerUrl' | 'themeColor' | 'welcomeText' | 'paymentNote') => form[k].trim() || null;
        const settings: Record<string, unknown> = {};
        if (ch('bannerUrl')) settings.bannerUrl = txt('bannerUrl');
        if (ch('themeColor')) settings.themeColor = txt('themeColor');
        if (ch('welcomeText')) settings.welcomeText = txt('welcomeText');
        if (ch('paymentNote')) settings.paymentNote = txt('paymentNote');
        if (ch('showVoucherTab')) settings.showVoucherTab = form.showVoucherTab;
        if (ch('showZaloLogin')) settings.showZaloLogin = form.showZaloLogin;
        if (ch('allowWaiterMoveTable')) settings.pos = { allowWaiterMoveTable: form.allowWaiterMoveTable };
        if (ch('printMode')) settings.printing = { mode: form.printMode || null };
        if (ch('customerCanPayQr')) settings.payment = { customerCanPayQr: form.customerCanPayQr };
        const body: Record<string, unknown> = {};
        if (ch('name') && form.name) body.name = form.name;
        if (ch('phone')) body.phone = form.phone || null;
        if (ch('address')) body.address = form.address || null;
        if (ch('logoUrl')) body.logoUrl = form.logoUrl.trim() || null;
        if (Object.keys(settings).length > 0) body.settings = settings;
        if (Object.keys(body).length > 0) await api(`/stores/${initial!.id}`, { method: 'PATCH', body });
        toast('Đã cập nhật thông tin quán');
      } else {
        if (!form.name || !form.slug) throw new Error('Thiếu tên quán hoặc slug');
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
          throw new Error('Slug chỉ dùng chữ thường, số, gạch ngang');
        }
        await api('/stores', {
          method: 'POST',
          body: {
            name: form.name,
            slug: form.slug,
            phone: form.phone || undefined,
            address: form.address || undefined,
            owner:
              form.ownerName && form.ownerPassword
                ? { name: form.ownerName, email: form.ownerEmail || undefined, password: form.ownerPassword }
                : undefined,
          },
        });
        toast('Đã tạo quán mới');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Sửa thông tin quán' : 'Thêm quán mới'}
      subtitle="Thông tin hiển thị trên mini app khách hàng"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="button" onClick={onClose}>
            Huỷ
          </button>
          <button className="button primary" disabled={busy} onClick={submit}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Tên quán" required>
          <input value={form.name} onChange={set('name')} placeholder="vd: Quán Bún Bò Hương" />
        </Field>
        {!isEdit && (
          <Field label="Slug" required hint="Chữ thường, số, gạch ngang — dùng cho link QR: /s/{slug}">
            <input value={form.slug} onChange={set('slug')} placeholder="vd: bunbo-huong" />
          </Field>
        )}
      </div>
      <div className="form-grid">
        <Field label="Điện thoại">
          <input value={form.phone} onChange={set('phone')} placeholder="0901234567" />
        </Field>
        <Field label="Địa chỉ">
          <input value={form.address} onChange={set('address')} placeholder="123 Nguyễn Huệ, Q.1, TP.HCM" />
        </Field>
      </div>

      {isEdit && (
        <>
          <hr className="divider" />
          <div className="form-section-title">Branding & Zalo Mini App</div>
          <div className="form-grid">
            <Field label="Logo quán" hint="URL ảnh — hiện trên màn gọi món của khách">
              <input value={form.logoUrl} onChange={set('logoUrl')} placeholder="https://.../logo.png" />
            </Field>
            <Field label="Ảnh banner" hint="URL ảnh ngang — hiện đầu trang menu khách">
              <input value={form.bannerUrl} onChange={set('bannerUrl')} placeholder="https://.../banner.jpg" />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Màu chủ đạo (hex)" hint="Mini app đổi màu nút/tab theo màu này">
              <div className="color-row">
                <input
                  type="color"
                  className="color-picker"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.themeColor) ? form.themeColor : '#137d69'}
                  onChange={(e) => setForm((f) => ({ ...f, themeColor: e.target.value }))}
                />
                <input value={form.themeColor} onChange={set('themeColor')} placeholder="#137d69" />
              </div>
            </Field>
            <Field label="Lời chào" hint="Hiện dưới tên quán trên menu khách (trống = ẩn)">
              <input value={form.welcomeText} onChange={set('welcomeText')} maxLength={200} placeholder="Chào mừng! Chọn món và gửi đơn nhé" />
            </Field>
          </div>
          <Field label="Ghi chú thanh toán" hint="Hiện cho khách sau khi gọi món (trống = mặc định)">
            <input value={form.paymentNote} onChange={set('paymentNote')} maxLength={200} placeholder="Vui lòng thanh toán tại quầy hoặc gọi nhân viên" />
          </Field>
          <div className="form-grid">
            <label className="check-row">
              <input type="checkbox" checked={form.showVoucherTab} onChange={(e) => setForm((f) => ({ ...f, showVoucherTab: e.target.checked }))} />
              Hiện tab Voucher trên mini app
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.showZaloLogin} onChange={(e) => setForm((f) => ({ ...f, showZaloLogin: e.target.checked }))} />
              Hiện nút Đăng nhập Zalo
            </label>
          </div>
          <hr className="divider" />
          <div className="form-section-title">Vận hành bán hàng & in phiếu</div>
          <label className="check-row">
            <input type="checkbox" checked={form.allowWaiterMoveTable} onChange={(e) => setForm((f) => ({ ...f, allowWaiterMoveTable: e.target.checked }))} />
            Cho phép nhân viên phục vụ đổi bàn (cài đặt pos.allowWaiterMoveTable; gộp bàn luôn từ thu ngân trở lên)
          </label>
          <label className="check-row">
            <input type="checkbox" checked={form.customerCanPayQr} onChange={(e) => setForm((f) => ({ ...f, customerCanPayQr: e.target.checked }))} />
            Cho khách tự lấy mã QR thanh toán trên mini app (mặc định TẮT; chỉ coi là đã trả khi tiền về hoặc thu ngân xác nhận)
          </label>
          <Field label="Chế độ in phiếu" hint="Tự động: có Print Agent hoạt động thì in giấy, chưa có thì chỉ dùng màn hình bếp">
            <select value={form.printMode} onChange={(e) => setForm((f) => ({ ...f, printMode: e.target.value }))}>
              <option value="">Tự động</option>
              <option value="AGENT">Luôn in qua Print Agent</option>
              <option value="KDS_ONLY">Chỉ dùng màn hình bếp (không in giấy)</option>
            </select>
          </Field>
        </>
      )}

      {!isEdit && (
        <>
          <hr className="divider" />
          <div className="form-section-title">Tài khoản chủ quán (Owner)</div>
          <div className="form-grid">
            <Field label="Họ tên">
              <input value={form.ownerName} onChange={set('ownerName')} placeholder="Nguyễn Văn A" />
            </Field>
            <Field label="Email">
              <input value={form.ownerEmail} onChange={set('ownerEmail')} placeholder="owner@quanan.com" />
            </Field>
          </div>
          <Field label="Mật khẩu" hint="Tối thiểu 8 ký tự">
            <input type="password" value={form.ownerPassword} onChange={set('ownerPassword')} />
          </Field>
        </>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function SuspendModal({ store, onClose, onDone }: { store: Store; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const suspending = store.status === 'ACTIVE';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${store.id}/status`, {
        method: 'PATCH',
        body: { status: suspending ? 'SUSPENDED' : 'ACTIVE', reason: reason || undefined },
      });
      toast(suspending ? `Đã tạm khóa ${store.name}` : `Đã mở khóa ${store.name}`);
      onDone();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={suspending ? `Tạm khóa "${store.name}"?` : `Mở khóa "${store.name}"?`}
      subtitle="Quán tạm khóa sẽ không nhận đơn mới từ QR"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className={`button ${suspending ? 'danger' : 'primary'}`} disabled={busy} onClick={submit}>
            {busy ? 'Đang xử lý...' : suspending ? 'Tạm khóa' : 'Mở khóa'}
          </button>
        </>
      }
    >
      {suspending ? (
        <p>
          Quán bị tạm khóa sẽ <b>không nhận đơn mới</b> từ QR khách. Nhân viên vẫn đăng nhập được nhưng không thao tác được.
        </p>
      ) : (
        <p>Quán sẽ hoạt động bình thường, nhận đơn QR và POS.</p>
      )}
      {suspending && (
        <Field label="Lý do (tuỳ chọn)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="vd: Hết hợp đồng" />
        </Field>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function ModulesModal({ store, onClose, onDone }: { store: Store; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toggle = async (key: string, enabled: boolean) => {
    setBusyKey(key);
    try {
      await api(`/stores/${store.id}/modules`, { method: 'PATCH', body: { module: key, enabled } });
      toast(enabled ? `Đã bật module cho ${store.name}` : `Đã tắt module của ${store.name}`);
      onDone();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Modal
      title={`Module trả phí — ${store.name}`}
      subtitle="Chỉ Super Admin bật được. Quán trả thêm phí mới nên bật."
      onClose={onClose}
      width={520}
      footer={
        <>
          <span />
          <button className="button primary" onClick={onClose}>
            Xong
          </button>
        </>
      }
    >
      <div className="stack">
        {MODULE_DEFS.map((m) => {
          const on = store.enabledModules.includes(m.key);
          return (
            <div key={m.key} className="task-row">
              <div>
                <strong>{m.label}</strong>
                <small>{m.description}</small>
              </div>
              <span
                className={`switch${on ? ' on' : ''}${busyKey === m.key ? ' disabled' : ''}`}
                title={on ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
                onClick={() => busyKey === null && toggle(m.key, !on)}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function Stores() {
  const { selectStore } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Store[]>(() => api('/stores'), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [suspending, setSuspending] = useState<Store | null>(null);
  const [managingModulesId, setManagingModulesId] = useState<string | null>(null);
  const managingStore = (data ?? []).find((s) => s.id === managingModulesId) ?? null;

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const copyMini = async (s: Store) => {
    try {
      await navigator.clipboard.writeText(`/s/${s.slug}`);
      toast(`Đã copy link mini app của ${s.name}`);
    } catch {
      toast(`/s/${s.slug}`, 'err');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Quán trên nền tảng</h1>
          <p>Danh sách quán, branding mini app và trạng thái hoạt động.</p>
        </div>
        <div className="actions">
          <button className="button primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Thêm quán
          </button>
        </div>
      </header>

      <div className="store-grid">
        {(data ?? []).map((s) => (
          <div key={s.id} className="store-card">
            <div className="logo">
              {s.logoUrl ? <img src={s.logoUrl} alt="" /> : s.name.charAt(0).toUpperCase()}
            </div>
            <h3>{s.name}</h3>
            <div className="slug">
              /{s.slug}
              {s.phone ? ` · ${s.phone}` : ''}
            </div>
            {s.address && <div className="small muted">{s.address}</div>}
            <div className="meta">
              <span>
                <b>{s.tables}</b> bàn
              </span>
              <span>
                <b>{s.users}</b> nhân viên
              </span>
              <span>
                <b>{s.orders}</b> đơn
              </span>
            </div>
            <div className="mini-path" role="button" tabIndex={0} onClick={() => copyMini(s)} onKeyDown={(e) => e.key === 'Enter' && copyMini(s)}>
              /s/{s.slug}
              <Icon name="copy" size={12} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <Badge cls={s.status === 'ACTIVE' ? 'green' : 'red'}>{s.status === 'ACTIVE' ? 'Hoạt động' : 'Tạm khóa'}</Badge>
              <div className="row-actions">
                <button
                  className="button tiny"
                  onClick={() => {
                    selectStore(s.id);
                    navigate('/');
                  }}
                >
                  Quản lý →
                </button>
                <button className="icon-btn" title="Module trả phí" onClick={() => setManagingModulesId(s.id)}>
                  <Icon name="key" size={14} />
                </button>
                <button className="icon-btn" title="Sửa" onClick={() => setEditing(s)}>
                  <Icon name="edit" size={14} />
                </button>
                <button className="icon-btn" title={s.status === 'ACTIVE' ? 'Tạm khóa' : 'Mở khóa'} onClick={() => setSuspending(s)}>
                  <Icon name={s.status === 'ACTIVE' ? 'x' : 'check'} size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {(data ?? []).length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <Empty title="Chưa có quán nào" sub="Thêm quán đầu tiên để bắt đầu." />
          </div>
        )}
      </div>

      {creating && <StoreFormModal initial={null} isEdit={false} onClose={() => setCreating(false)} onSaved={reload} />}
      {editing && <StoreFormModal initial={editing} isEdit onClose={() => setEditing(null)} onSaved={reload} />}
      {suspending && <SuspendModal store={suspending} onClose={() => setSuspending(null)} onDone={reload} />}
      {managingStore && (
        <ModulesModal store={managingStore} onClose={() => setManagingModulesId(null)} onDone={reload} />
      )}
    </>
  );
}
