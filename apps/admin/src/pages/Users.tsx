import { useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtDateTime } from '../format';
import { ROLE_LABEL } from '../labels';
import type { User } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

const STORE_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];

function UserModal({ initial, onClose, onSaved }: { initial: User | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { activeStore, me } = useApp();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    role: initial?.role ?? 'CASHIER',
    status: initial?.status ?? 'ACTIVE',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSelf = initial?.id === me?.id;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isEdit) {
        await api(`/stores/${activeStore!.id}/users/${initial!.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            email: form.email || null,
            phone: form.phone || null,
            ...(isSelf ? {} : { role: form.role, status: form.status }),
            ...(form.password ? { password: form.password } : {}),
          },
        });
        toast('Đã cập nhật nhân viên');
      } else {
        if (!form.name || !form.password) throw new Error('Thiếu họ tên hoặc mật khẩu');
        if (!form.email && !form.phone) throw new Error('Cần email hoặc số điện thoại');
        await api(`/stores/${activeStore!.id}/users`, {
          method: 'POST',
          body: {
            name: form.name,
            email: form.email || undefined,
            phone: form.phone || undefined,
            role: form.role,
            password: form.password,
          },
        });
        toast('Đã thêm nhân viên');
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
      title={isEdit ? `Sửa: ${initial!.name}` : 'Thêm nhân viên'}
      subtitle="Nhân viên dùng email hoặc SĐT để đăng nhập vào POS"
      onClose={onClose}
      width={520}
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
      <Field label="Họ tên" required>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="Email">
          <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Số điện thoại">
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Vai trò" required>
          <select value={form.role} disabled={isSelf} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {STORE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trạng thái">
          <select
            value={form.status}
            disabled={isSelf}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'ACTIVE' | 'DISABLED' }))}
          >
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="DISABLED">Tạm khóa</option>
          </select>
        </Field>
      </div>
      <Field
        label={isEdit ? 'Đặt lại mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu (tối thiểu 8 ký tự)'}
        required={!isEdit}
      >
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          autoComplete="new-password"
        />
      </Field>
      {isSelf && (
        <div className="notice">Bạn đang sửa chính tài khoản của mình — không thể đổi vai trò hoặc khóa bản thân.</div>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

export default function Users() {
  const { activeStore } = useApp();
  const { data, loading, error, reload } = useFetch<User[]>(
    () => api(`/stores/${activeStore!.id}/users`),
    [activeStore?.id],
  );
  const [modal, setModal] = useState<{ user: User | null } | null>(null);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Nhân sự & vai trò</h1>
          <p>Mỗi vai trò vào một không gian làm việc riêng: Thu ngân, Bếp, Phục vụ.</p>
        </div>
        <div className="actions">
          <button className="button primary" onClick={() => setModal({ user: null })}>
            <Icon name="plus" /> Thêm nhân viên
          </button>
        </div>
      </header>
      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Liên hệ</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th className="num"></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>
                    {u.email ?? <span className="muted">—</span>}
                    <small>{u.phone ?? ''}</small>
                  </td>
                  <td>
                    <Badge cls={u.role === 'OWNER' ? 'blue' : u.role === 'MANAGER' ? 'amber' : 'grey'}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </Badge>
                  </td>
                  <td>
                    {u.status === 'ACTIVE' ? <Badge cls="green">Hoạt động</Badge> : <Badge cls="red">Tạm khóa</Badge>}
                  </td>
                  <td className="muted">{fmtDateTime(u.createdAt)}</td>
                  <td className="num">
                    <button className="icon-btn" title="Sửa" onClick={() => setModal({ user: u })}>
                      <Icon name="edit" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data ?? []).length === 0 && <Empty title="Chưa có nhân viên" />}
      </section>

      {modal && <UserModal initial={modal.user} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}
