import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtMoney } from '../format';
import { TABLE_STATUS, TABLE_STATUS_CHANGEABLE } from '../labels';
import type { TableInfo, TablesData } from '../types';
import { qrSvg } from '../qr';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

/** Link khach quet QR: {goc mini app}/s/{slug}/t/{ma ban}. Goc lay tu VITE_MINIAPP_BASE_URL, neu khong co thi
 *  dev -> cong 3002 cung may, con lai lay goc cua qrCode server tra ve (QR_BASE_URL), cuoi cung la origin hien tai.
 *  Slug luon lay theo quan dang chon (qrCode luu san co the cu). */
function tableLink(slug: string, t: TableInfo): string {
  let base = (import.meta.env.VITE_MINIAPP_BASE_URL ?? '').trim();
  if (!base && import.meta.env.DEV) base = `${window.location.protocol}//${window.location.hostname}:3002`;
  if (!base && t.qrCode) {
    try {
      base = new URL(t.qrCode).origin;
    } catch {
      /* qrCode khong hop le */
    }
  }
  if (!base) base = window.location.origin;
  return `${base.replace(/\/+$/, '')}/s/${slug}/t/${encodeURIComponent(t.code)}`;
}

function QrModal({ table, link, onClose, onCopy }: { table: TableInfo; link: string; onClose: () => void; onCopy: () => void }) {
  const svg = qrSvg(link, 240);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <Modal
      title={`Mã QR bàn ${table.code}`}
      subtitle="Khách quét để mở thực đơn đúng bàn"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="button" onClick={onCopy}>
            Copy link
          </button>
          <a className="button primary" href={src} download={`qr-ban-${table.code}.svg`}>
            Tải ảnh QR
          </a>
        </>
      }
    >
      <div style={{ textAlign: 'center' }}>
        <img src={src} alt={`Mã QR bàn ${table.code}`} width={240} height={240} style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 8 }} />
        <p className="small muted" style={{ wordBreak: 'break-all', marginTop: 10 }}>
          {link}
        </p>
      </div>
    </Modal>
  );
}

function AreaModal({
  modal,
  onClose,
  onSaved,
}: {
  modal: { mode: 'create' } | { mode: 'edit'; name: string; id: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { activeStore } = useApp();
  const isEdit = modal.mode === 'edit';
  const [name, setName] = useState(isEdit ? modal.name : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr('Vui lòng nhập tên khu vực');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (isEdit) {
        await api(`/stores/${activeStore!.id}/areas/${modal.id}`, { method: 'PATCH', body: { name: name.trim() } });
        toast('Đã đổi tên khu vực');
      } else {
        await api(`/stores/${activeStore!.id}/areas`, { method: 'POST', body: { name: name.trim() } });
        toast('Đã thêm khu vực');
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
      title={isEdit ? 'Đổi tên khu vực' : 'Thêm khu vực'}
      subtitle="Khu vực dùng để nhóm bàn trong POS"
      onClose={onClose}
      width={420}
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
      <Field label="Tên khu vực" required>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="vd: Tầng 1, Sảnh chính" />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function TableFormModal({
  initial,
  initialAreaId,
  areas,
  onClose,
  onSaved,
}: {
  initial: TableInfo | null;
  initialAreaId?: string;
  areas: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { activeStore } = useApp();
  const [form, setForm] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    areaId: initialAreaId ?? areas[0]?.id ?? '',
    seats: initial?.seats ? String(initial.seats) : '',
    notes: initial?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (initial) {
        await api(`/stores/${activeStore!.id}/tables/${initial.id}`, {
          method: 'PATCH',
          body: {
            name: form.name || null,
            areaId: form.areaId || undefined,
            seats: form.seats ? parseInt(form.seats) : null,
            notes: form.notes || null,
          },
        });
        toast('Đã cập nhật bàn');
      } else {
        if (!form.code || !form.areaId) throw new Error('Thiếu mã bàn hoặc khu vực');
        await api(`/stores/${activeStore!.id}/tables`, {
          method: 'POST',
          body: {
            code: form.code.toUpperCase(),
            areaId: form.areaId,
            name: form.name || undefined,
            seats: form.seats ? parseInt(form.seats) : undefined,
            notes: form.notes || undefined,
          },
        });
        toast('Đã thêm bàn mới');
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
      title={initial ? `Sửa bàn ${initial.code}` : 'Thêm bàn'}
      subtitle="Mã bàn dùng cho link QR và in bill"
      onClose={onClose}
      width={560}
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
      {!initial && (
        <Field label="Mã bàn" required hint="Chữ và số, vd: B07">
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} autoFocus />
        </Field>
      )}
      <Field label="Khu vực">
        <select value={form.areaId} onChange={(e) => setForm((f) => ({ ...f, areaId: e.target.value }))}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Tên hiển thị">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Bàn 7 góc" />
        </Field>
        <Field label="Số chỗ">
          <input type="number" min={1} max={200} value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))} />
        </Field>
      </div>
      <Field label="Ghi chú">
        <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function DeleteModal({ table, onClose, onDone }: { table: TableInfo; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { activeStore } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/tables/${table.id}`, { method: 'DELETE' });
      toast(`Đã xoá bàn ${table.code}`);
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
      title={`Xoá bàn ${table.code}?`}
      subtitle="Thao tác không thể hoàn tác"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Huỷ bỏ
          </button>
          <button className="button danger" disabled={busy} onClick={submit}>
            {busy ? 'Đang xoá...' : 'Xoá bàn'}
          </button>
        </>
      }
    >
      <p>
        Bàn <b>{table.code}</b>
        {table.name ? ` (${table.name})` : ''} sẽ bị xoá. Nếu bàn có lịch sử đơn hàng thì hệ thống sẽ chặn xoá.
      </p>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

export default function Tables() {
  const { activeStore, canWrite } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch<TablesData>(
    () => api(`/stores/${activeStore!.id}/tables`),
    [activeStore?.id],
  );
  const [areaModal, setAreaModal] = useState<{ mode: 'create' } | { mode: 'edit'; name: string; id: string } | null>(null);
  const [tableModal, setTableModal] = useState<{ table: TableInfo | null; areaId?: string } | null>(null);
  const [deleting, setDeleting] = useState<TableInfo | null>(null);
  const [qrTable, setQrTable] = useState<TableInfo | null>(null);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const areas = data?.areas ?? [];

  const viewTable = (t: TableInfo) => {
    try {
      sessionStorage.setItem('innoorder_pos_table', t.code);
    } catch {
      /* ignore */
    }
    navigate('/pos');
  };

  const slug = data?.store?.slug ?? activeStore?.slug ?? '';
  const copyQr = async (t: TableInfo) => {
    const link = tableLink(slug, t);
    try {
      await navigator.clipboard.writeText(link);
      toast(`Đã copy link QR bàn ${t.code}`);
    } catch {
      toast(link, 'err');
    }
  };

  const changeStatus = async (t: TableInfo, status: string) => {
    try {
      await api(`/stores/${activeStore!.id}/tables/${t.id}/status`, { method: 'POST', body: { status } });
      toast(`Bàn ${t.code} → ${TABLE_STATUS[status]?.label}`);
      reload();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Khu vực & bàn</h1>
          <p>Quản lý bàn, trạng thái và liên kết QR khách.</p>
        </div>
        <div className="actions">
          {canWrite && (
            <button className="button" onClick={() => setAreaModal({ mode: 'create' })}>
              <Icon name="plus" /> Khu vực
            </button>
          )}
          {canWrite && (
            <button
              className="button primary"
              disabled={areas.length === 0}
              onClick={() => setTableModal({ table: null })}
            >
              <Icon name="plus" /> Thêm bàn
            </button>
          )}
        </div>
      </header>
      <div className="notice">
        Trạng thái <b>Đang dùng</b> được xác định từ đơn đang mở. Sau khi thanh toán, bàn chuyển sang <b>Cần dọn</b> cho
        tới khi nhân viên xác nhận đã dọn.
      </div>

      {areas.map((area) => (
        <section key={area.id} className="panel">
          <div className="panel-head">
            <h2>
              {area.name} <span className="small muted">({area.tables.length} bàn)</span>
            </h2>
            {canWrite && (
              <div className="actions">
                <button className="button tiny" onClick={() => setAreaModal({ mode: 'edit', id: area.id, name: area.name })}>
                  <Icon name="edit" size={13} /> Đổi tên
                </button>
                <button className="button tiny primary" onClick={() => setTableModal({ table: null, areaId: area.id })}>
                  <Icon name="plus" size={13} /> Thêm bàn
                </button>
              </div>
            )}
          </div>
          {area.tables.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã bàn</th>
                    <th>Tên</th>
                    <th>Chỗ ngồi</th>
                    <th>Trạng thái</th>
                    <th className="num">Chưa thanh toán</th>
                    <th className="num"></th>
                  </tr>
                </thead>
                <tbody>
                  {area.tables.map((t) => {
                    const st = TABLE_STATUS[t.status] ?? { label: t.status, cls: 'grey' };
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.code}</strong>
                        </td>
                        <td>{t.name ?? <span className="muted">—</span>}</td>
                        <td>{t.seats ?? '—'}</td>
                        <td>
                          {canWrite ? (
                            <select
                              className="status-select"
                              value={t.status}
                              onChange={(e) => changeStatus(t, e.target.value)}
                            >
                              {TABLE_STATUS_CHANGEABLE.map((s) => (
                                <option key={s} value={s}>
                                  {TABLE_STATUS[s]?.label ?? s}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge cls={st.cls}>{st.label}</Badge>
                          )}
                        </td>
                        <td className="num">
                          <strong>{t.openAmount > 0 ? fmtMoney(t.openAmount) : '—'}</strong>
                          {t.openOrders > 0 && <small>{t.openOrders} đơn mở</small>}
                        </td>
                        <td className="num">
                          <div className="row-actions">
                            <button className="button tiny" onClick={() => viewTable(t)}>
                              Xem bàn →
                            </button>
                            <button className="icon-btn" title="Xem mã QR" aria-label={`Xem mã QR bàn ${t.code}`} onClick={() => setQrTable(t)}>
                              <Icon name="qrcode" size={15} />
                            </button>
                            {canWrite && (
                              <>
                                <button className="icon-btn" title="Sửa" onClick={() => setTableModal({ table: t, areaId: area.id })}>
                                  <Icon name="edit" size={15} />
                                </button>
                                <button className="icon-btn" title="Xoá" onClick={() => setDeleting(t)}>
                                  <Icon name="trash" size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Khu vực chưa có bàn" />
          )}
        </section>
      ))}

      {areas.length === 0 && (
        <section className="panel">
          <Empty title="Chưa có khu vực nào" sub="Hãy tạo khu vực đầu tiên." />
        </section>
      )}

      {areaModal && <AreaModal modal={areaModal} onClose={() => setAreaModal(null)} onSaved={reload} />}
      {tableModal && (
        <TableFormModal
          initial={tableModal.table}
          initialAreaId={tableModal.areaId}
          areas={areas.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setTableModal(null)}
          onSaved={reload}
        />
      )}
      {qrTable && (
        <QrModal table={qrTable} link={tableLink(slug, qrTable)} onClose={() => setQrTable(null)} onCopy={() => copyQr(qrTable)} />
      )}
      {deleting && <DeleteModal table={deleting} onClose={() => setDeleting(null)} onDone={reload} />}
    </>
  );
}
