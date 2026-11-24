import { useRef, useState } from 'react';
import { api, apiUpload, errMsg } from '../api';
import { useApp } from '../context';
import { fmtMoney } from '../format';
import { TICKET_STATION } from '../labels';
import type { MenuCategory, MenuItem, MenuItemOption, TicketStation } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

interface CategoryInit {
  id?: string;
  name: string;
  sortOrder: number;
  active: boolean;
  station?: TicketStation;
}

function CategoryModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: CategoryInit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { activeStore } = useApp();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    sortOrder: String(initial?.sortOrder ?? 0),
    active: initial?.active ?? true,
    station: (initial?.station ?? 'KITCHEN') as TicketStation,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (isEdit) {
        await api(`/stores/${activeStore!.id}/menu/categories/${initial!.id}`, {
          method: 'PATCH',
          body: { name: form.name, sortOrder: parseInt(form.sortOrder) || 0, active: form.active, station: form.station },
        });
        toast('Đã cập nhật danh mục');
      } else {
        if (!form.name.trim()) throw new Error('Thiếu tên danh mục');
        await api(`/stores/${activeStore!.id}/menu/categories`, {
          method: 'POST',
          body: { name: form.name.trim(), sortOrder: parseInt(form.sortOrder) || 0, active: form.active, station: form.station },
        });
        toast('Đã thêm danh mục');
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
      title={isEdit ? 'Sửa danh mục' : 'Thêm danh mục'}
      subtitle="Danh mục hiển thị ở menu khách và POS"
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
      <Field label="Tên danh mục" required>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus placeholder="vd: Bún, Phở, Đồ uống" />
      </Field>
      <Field label="Thứ tự hiển thị">
        <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
      </Field>
      <Field label="In phiếu tại" hint="Món của danh mục này in ở máy Bếp, máy Bar hoặc không in phiếu">
        <select value={form.station} onChange={(e) => setForm((f) => ({ ...f, station: e.target.value as TicketStation }))}>
          {Object.entries(TICKET_STATION).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        Đang bật (khách nhìn thấy)
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function OptionForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
}: {
  initial: Partial<MenuItemOption>;
  submitLabel: string;
  onSubmit: (v: { groupName: string; optionName: string; extraPrice: number; isRequired: boolean }) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    groupName: initial.groupName ?? '',
    optionName: initial.optionName ?? '',
    extraPrice: initial.extraPrice !== undefined ? String(initial.extraPrice) : '0',
    isRequired: initial.isRequired ?? false,
  });
  return (
    <div className="panel" style={{ background: '#f8fafc', marginBottom: 14 }}>
      <div className="form-grid">
        <Field label="Nhóm tuỳ chọn">
          <input value={form.groupName} onChange={(e) => setForm((f) => ({ ...f, groupName: e.target.value }))} placeholder="vd: Độ cay" />
        </Field>
        <Field label="Giá trị">
          <input value={form.optionName} onChange={(e) => setForm((f) => ({ ...f, optionName: e.target.value }))} placeholder="vd: Cay vừa" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Phụ thu (đ)">
          <input type="number" min={0} value={form.extraPrice} onChange={(e) => setForm((f) => ({ ...f, extraPrice: e.target.value }))} />
        </Field>
        <label className="check-row" style={{ alignSelf: 'flex-end', paddingBottom: 10 }}>
          <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))} />
          Bắt buộc
        </label>
      </div>
      <button
        className="button primary"
        disabled={busy || !form.groupName.trim() || !form.optionName.trim()}
        onClick={() =>
          onSubmit({
            groupName: form.groupName.trim(),
            optionName: form.optionName.trim(),
            extraPrice: parseInt(form.extraPrice) || 0,
            isRequired: form.isRequired,
          })
        }
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ItemDetailModal({ item, onClose, onSaved }: { item: MenuItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { activeStore } = useApp();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MenuItemOption | null>(null);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
      onSaved();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Tuỳ chọn — ${item.name}`}
      subtitle="Cỡ, độ cay, topping... khách chọn khi gọi món"
      onClose={onClose}
      width={640}
      footer={
        <span className="small muted">
          {item.options.length} tuỳ chọn đang bật
        </span>
      }
    >
      {item.options.length === 0 && !adding && <Empty title="Món chưa có tuỳ chọn" sub="Thêm cỡ, độ cay, topping..." />}
      {item.options.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhóm</th>
                <th>Giá trị</th>
                <th className="num">Phụ thu</th>
                <th>Bắt buộc</th>
                <th className="num"></th>
              </tr>
            </thead>
            <tbody>
              {item.options.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.groupName}</strong>
                  </td>
                  <td>{o.optionName}</td>
                  <td className="num">{o.extraPrice > 0 ? fmtMoney(o.extraPrice) : '—'}</td>
                  <td>{o.isRequired ? <Badge cls="blue">Có</Badge> : <span className="muted">Không</span>}</td>
                  <td className="num">
                    <div className="row-actions">
                      <button className="icon-btn" title="Sửa" onClick={() => { setEditing(o); setAdding(false); }}>
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Xoá"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => api(`/stores/${activeStore!.id}/menu/items/${item.id}/options/${o.id}`, { method: 'DELETE' }),
                            'Đã xoá tuỳ chọn',
                          )
                        }
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <>
          <OptionForm
            initial={editing ?? {}}
            submitLabel={editing ? 'Cập nhật' : 'Thêm tuỳ chọn'}
            busy={busy}
            onSubmit={(v) =>
              run(
                async () => {
                  if (editing) {
                    await api(`/stores/${activeStore!.id}/menu/items/${item.id}/options/${editing.id}`, { method: 'PATCH', body: v });
                  } else {
                    await api(`/stores/${activeStore!.id}/menu/items/${item.id}/options`, { method: 'POST', body: v });
                  }
                },
                editing ? 'Đã cập nhật tuỳ chọn' : 'Đã thêm tuỳ chọn',
              )
            }
          />
          <button className="button" onClick={() => { setAdding(false); setEditing(null); }}>
            Đóng form
          </button>
        </>
      )}
      {!adding && !editing && (
        <button className="button primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Thêm tuỳ chọn
        </button>
      )}
    </Modal>
  );
}

function ItemModal({
  categories,
  initial,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  categories: MenuCategory[];
  initial: MenuItem | null;
  defaultCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { activeStore } = useApp();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    // sua mon: mac dinh dung danh muc hien tai cua mon (truoc day luon la danh muc dau tien -> luu se chuyen mon sang danh muc khac)
    categoryId: (initial && categories.find((c) => c.items.some((i) => i.id === initial.id))?.id) ?? defaultCategoryId ?? categories[0]?.id ?? '',
    description: initial?.description ?? '',
    imageUrl: initial?.imageUrl ?? '',
    price: initial ? String(initial.price) : '',
    prepTimeMinutes: initial?.prepTimeMinutes ? String(initial.prepTimeMinutes) : '',
    active: initial?.active ?? true,
    tags: initial?.tags ?? '',
    printStation: (initial?.printStation ?? '') as TicketStation | '',
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại đúng file đó lần sau
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Chỉ chọn được file ảnh (jpg, png, webp)', 'err');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Ảnh tối đa 8MB, hãy chọn ảnh nhỏ hơn', 'err');
      return;
    }
    setUploading(true);
    try {
      const res = await apiUpload<{ url: string }>(
        `/stores/${activeStore!.id}/menu/items/upload-image`,
        file,
      );
      setForm((f) => ({ ...f, imageUrl: res.url }));
      toast('Đã tải ảnh lên');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: form.name,
        categoryId: form.categoryId,
        description: form.description || null,
        imageUrl: form.imageUrl || null,
        price: parseInt(form.price),
        prepTimeMinutes: form.prepTimeMinutes ? parseInt(form.prepTimeMinutes) : null,
        active: form.active,
        tags: form.tags || undefined,
        // '' = theo danh muc: sua thi gui null de bo ghi de, tao moi thi bo qua truong
        printStation: form.printStation || (isEdit ? null : undefined),
      };
      if (isEdit) {
        await api(`/stores/${activeStore!.id}/menu/items/${initial!.id}`, { method: 'PATCH', body });
        toast('Đã cập nhật món');
      } else {
        if (!form.name || isNaN(parseInt(form.price))) throw new Error('Thiếu tên món hoặc giá');
        await api(`/stores/${activeStore!.id}/menu/items`, { method: 'POST', body });
        toast('Đã thêm món mới');
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
      title={isEdit ? `Sửa món: ${initial!.name}` : 'Thêm món'}
      subtitle="Món mới sẽ xuất hiện ngay ở POS và mini app"
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
      <Field label="Tên món" required>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
      </Field>
      <Field label="Danh mục" required>
        <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Giá (đ)" required>
          <input type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
        </Field>
        <Field label="Thời gian chế biến (phút)">
          <input type="number" min={1} max={240} value={form.prepTimeMinutes} onChange={(e) => setForm((f) => ({ ...f, prepTimeMinutes: e.target.value }))} />
        </Field>
      </div>
      <Field label="Mô tả">
        <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <Field label="Ảnh món" hint="Chụp hoặc chọn ảnh từ điện thoại/máy tính, ảnh sẽ tự được nén gọn lại">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {form.imageUrl ? (
            <img
              src={form.imageUrl}
              alt=""
              style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }}
            />
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                flexShrink: 0,
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                color: '#94a3b8',
              }}
            >
              {form.name.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <button type="button" className="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <Icon name="plus" size={14} /> {uploading ? 'Đang tải ảnh lên...' : 'Tải ảnh từ máy'}
          </button>
          {form.imageUrl && (
            <button
              type="button"
              className="icon-btn"
              title="Xoá ảnh"
              onClick={() => setForm((f) => ({ ...f, imageUrl: '' }))}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={onFileSelected}
        />
        <input
          style={{ marginTop: 8 }}
          value={form.imageUrl}
          onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
          placeholder="hoặc dán URL ảnh có sẵn (https://...)"
        />
      </Field>
      <Field label="In phiếu tại (ghi đè danh mục)" hint="Ví dụ nước đóng chai: Không in. Mặc định theo danh mục.">
        <select value={form.printStation} onChange={(e) => setForm((f) => ({ ...f, printStation: e.target.value as TicketStation | '' }))}>
          <option value="">Theo danh mục ({TICKET_STATION[categories.find((c) => c.id === form.categoryId)?.station ?? 'KITCHEN']})</option>
          {Object.entries(TICKET_STATION).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tags (phân cách bằng dấu phẩy)">
        <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="bán chạy, cay" />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        Đang bật (đang bán)
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

export default function MenuPage() {
  const { activeStore, canWrite } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<MenuCategory[]>(
    () => api(`/stores/${activeStore!.id}/menu`),
    [activeStore?.id],
  );
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [catModal, setCatModal] = useState<{ initial: CategoryInit | null } | null>(null);
  const [itemModal, setItemModal] = useState<{ item: MenuItem | null; categoryId?: string } | null>(null);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const cats = data ?? [];
  const catName = new Map<string, string>();
  const catStation = new Map<string, TicketStation>();
  cats.forEach((c) =>
    c.items.forEach((it) => {
      catName.set(it.id, c.name);
      catStation.set(it.id, (it.printStation ?? c.station ?? 'KITCHEN') as TicketStation);
    }),
  );
  const shown = cats
    .filter((c) => catFilter === 'all' || c.id === catFilter)
    .flatMap((c) => c.items)
    .filter((it) => !search || it.name.toLowerCase().includes(search.toLowerCase()));

  const toggleActive = async (it: MenuItem) => {
    try {
      await api(`/stores/${activeStore!.id}/menu/items/${it.id}`, { method: 'PATCH', body: { active: !it.active } });
      toast(it.active ? `Tạm ẩn "${it.name}" khỏi menu bán` : `Đã bật "${it.name}"`);
      reload();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Thực đơn của quán</h1>
          <p>Quản lý món, giá, ảnh và trạng thái đang bán.</p>
        </div>
        <div className="actions">
          {canWrite && (
            <button className="button" onClick={() => setCatModal({ initial: null })}>
              <Icon name="book" /> Danh mục
            </button>
          )}
          {canWrite && (
            <button className="button primary" disabled={cats.length === 0} onClick={() => setItemModal({ item: null })}>
              <Icon name="plus" /> Thêm món
            </button>
          )}
        </div>
      </header>
      <div className="notice">
        Bật / tắt <b>“Đang bán”</b> để thu ngân không gọi nhầm món đã hết. Món tắt vẫn giữ nguyên giá và tuỳ chọn.
      </div>
      <div className="filters">
        <div className="tabs">
          <button className={`tab${catFilter === 'all' ? ' active' : ''}`} onClick={() => setCatFilter('all')}>
            Tất cả
          </button>
          {cats.map((c) => (
            <button key={c.id} className={`tab${catFilter === c.id ? ' active' : ''}`} onClick={() => setCatFilter(c.id)}>
              {c.name}
              {c.station && c.station !== 'KITCHEN' ? ` · ${TICKET_STATION[c.station]}` : ''}
            </button>
          ))}
        </div>
        {canWrite && catFilter !== 'all' && cats.find((c) => c.id === catFilter) && (
          <button
            className="button"
            onClick={() => {
              const c = cats.find((x) => x.id === catFilter)!;
              setCatModal({ initial: { id: c.id, name: c.name, sortOrder: c.sortOrder, active: c.active, station: c.station } });
            }}
          >
            <Icon name="edit" size={14} /> Sửa danh mục
          </button>
        )}
        <div className="search">
          <Icon name="search" size={16} />
          <input aria-label="Tìm món" placeholder="Tìm món..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="menu-grid">
        {shown.map((it) => (
          <article key={it.id} className={`menu-card${it.active ? '' : ' off'}`}>
            {it.imageUrl ? (
              <img src={it.imageUrl} alt="" />
            ) : (
              <span className="menu-card-fallback">{it.name.charAt(0).toUpperCase()}</span>
            )}
            <div className="menu-card-info">
              <h3>{it.name}</h3>
              <small>
                {catName.get(it.id) ?? '—'}
                {it.prepTimeMinutes ? ` · ${it.prepTimeMinutes} phút` : ''}
                {it.options.length ? ` · ${it.options.length} tuỳ chọn` : ''}
                {catStation.get(it.id) && catStation.get(it.id) !== 'KITCHEN' ? ` · In: ${TICKET_STATION[catStation.get(it.id)!]}` : ''}
              </small>
              <span className="price">{fmtMoney(it.price)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              {canWrite && (
                <span
                  className={`switch${it.active ? ' on' : ''}`}
                  title={it.active ? 'Đang bán — bấm để tắt' : 'Đã tắt — bấm để bật'}
                  onClick={() => toggleActive(it)}
                />
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="button" title="Tuỳ chọn món" onClick={() => setDetailItem(it)}>
                  <Icon name="order" size={14} />
                </button>
                {canWrite && (
                  <button className="button" title="Sửa món" onClick={() => setItemModal({ item: it })}>
                    <Icon name="edit" size={14} />
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {shown.length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <Empty title="Không có món phù hợp" sub="Thử đổi danh mục hoặc từ khóa tìm kiếm." />
          </div>
        )}
      </div>

      {catModal && <CategoryModal initial={catModal.initial} onClose={() => setCatModal(null)} onSaved={reload} />}
      {itemModal && (
        <ItemModal
          categories={cats}
          initial={itemModal.item}
          defaultCategoryId={itemModal.categoryId}
          onClose={() => setItemModal(null)}
          onSaved={reload}
        />
      )}
      {detailItem && <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} onSaved={reload} />}
    </>
  );
}
