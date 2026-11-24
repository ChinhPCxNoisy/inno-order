import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg } from '../errors';
import { fmtDateTime, fmtMoney } from '../format';
import { BILL_STATUS, OFFER_STATE } from '../labels';
import type { Offer, OfferRedemptions } from '../types';
import { useFetch } from '../useFetch';
import { Badge, ConfirmModal, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

const REDEMPTION_STATUS: Record<string, { label: string; cls: string }> = {
  RESERVED: { label: 'Đang giữ (hóa đơn chưa đóng)', cls: 'amber' },
  CONSUMED: { label: 'Đã dùng', cls: 'green' },
  RELEASED: { label: 'Đã trả lượt', cls: 'grey' },
};

/** datetime-local <-> ISO */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

const valueText = (o: Offer) => (o.discountType === 'PERCENT' ? `Giảm ${o.value}%${o.maxDiscount ? ` (tối đa ${fmtMoney(o.maxDiscount)})` : ''}` : `Giảm ${fmtMoney(o.value)}`);

function OfferModal({ initial, onClose, onSaved }: { initial: Offer | null; onClose: () => void; onSaved: () => void }) {
  const { activeStore } = useApp();
  const toast = useToast();
  const isEdit = !!initial;
  const used = (initial?.usedCount ?? 0) > 0;
  const [f, setF] = useState({
    code: initial?.code ?? '',
    headline: initial?.headline ?? '',
    tagline: initial?.tagline ?? '',
    subtitle: initial?.subtitle ?? '',
    description: initial?.description ?? '',
    discountType: initial?.discountType ?? 'PERCENT',
    value: initial ? String(initial.value) : '',
    maxDiscount: initial?.maxDiscount ? String(initial.maxDiscount) : '',
    minSubtotal: initial?.minSubtotal ? String(initial.minSubtotal) : '',
    startsAt: toLocal(initial?.startsAt ?? null),
    endsAt: toLocal(initial?.endsAt ?? null),
    totalLimit: initial?.totalLimit ? String(initial.totalLimit) : '',
    stackable: initial?.stackable ?? false,
    listed: initial?.listed ?? true,
    active: initial?.active ?? true,
    cashierCanApply: initial?.cashierCanApply ?? true,
    extraTerms: (initial?.extraTerms ?? []).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // kiem tra hop le ngay gio truoc khi gui
  const dateErr =
    f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt)
      ? 'Ngày kết thúc phải sau ngày bắt đầu'
      : f.endsAt && new Date(f.endsAt) < new Date() && f.active
        ? 'Ưu đãi đã hết hạn ngay khi lưu (ngày kết thúc ở quá khứ)'
        : null;

  const submit = async () => {
    if (busy) return;
    setErr(null);
    const v = Number(f.value);
    if (!isEdit && !/^[A-Za-z0-9-]{4,20}$/.test(f.code.trim())) return setErr('Mã gồm 4-20 chữ, số hoặc dấu gạch ngang');
    if (!f.headline.trim()) return setErr('Nhập tiêu đề ưu đãi');
    if (!isFinite(v) || v <= 0) return setErr('Nhập giá trị giảm lớn hơn 0');
    if (f.discountType === 'PERCENT' && (v < 1 || v > 100)) return setErr('Phần trăm giảm từ 1 đến 100');
    if (dateErr && !f.endsAt) return setErr(dateErr);
    if (f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt)) return setErr(dateErr);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        headline: f.headline.trim(),
        tagline: f.tagline.trim() || undefined,
        subtitle: f.subtitle.trim() || undefined,
        description: f.description.trim() || undefined,
        maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : undefined,
        minSubtotal: f.minSubtotal ? Number(f.minSubtotal) : undefined,
        startsAt: toIso(f.startsAt),
        endsAt: toIso(f.endsAt),
        totalLimit: f.totalLimit ? Number(f.totalLimit) : undefined,
        stackable: f.stackable,
        listed: f.listed,
        active: f.active,
        cashierCanApply: f.cashierCanApply,
        extraTerms: f.extraTerms.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      if (!(isEdit && used)) {
        body.discountType = f.discountType;
        body.value = v;
      }
      if (isEdit) {
        await api(`/stores/${activeStore!.id}/offers/${initial!.id}`, { method: 'PATCH', body });
        toast('Đã cập nhật ưu đãi');
      } else {
        await api(`/stores/${activeStore!.id}/offers`, { method: 'POST', body: { ...body, code: f.code.trim().toUpperCase() } });
        toast('Đã tạo ưu đãi');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(billErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Sửa ưu đãi ${initial!.code}` : 'Tạo ưu đãi'}
      subtitle="Mã công khai dùng chung; thu ngân áp vào hóa đơn khi khách đọc mã"
      onClose={busy ? () => undefined : onClose}
      wide
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>Huỷ</button>
          <button className="button primary" disabled={busy} onClick={submit}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Mã ưu đãi" required={!isEdit} hint={isEdit ? 'Không đổi được mã' : '4-20 ký tự, tự viết HOA'}>
          <input value={f.code} disabled={isEdit} maxLength={20} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="vd: HELLO10" autoFocus={!isEdit} />
        </Field>
        <Field label="Tiêu đề" required>
          <input value={f.headline} maxLength={120} onChange={(e) => set('headline', e.target.value)} placeholder="vd: Giảm 10% cho hóa đơn từ 300k" />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Nhãn ngắn (tagline)">
          <input value={f.tagline} maxLength={40} onChange={(e) => set('tagline', e.target.value)} placeholder="vd: MỚI" />
        </Field>
        <Field label="Phụ đề">
          <input value={f.subtitle} maxLength={160} onChange={(e) => set('subtitle', e.target.value)} />
        </Field>
      </div>
      <Field label="Mô tả">
        <textarea rows={2} maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="radio-choices" style={{ marginTop: 0 }}>
        {(['PERCENT', 'AMOUNT'] as const).map((t) => (
          <label key={t}>
            <input type="radio" name="offer-type" disabled={isEdit && used} checked={f.discountType === t} onChange={() => set('discountType', t)} />
            {t === 'PERCENT' ? 'Giảm theo phần trăm (%)' : 'Giảm số tiền (đ)'}
          </label>
        ))}
      </div>
      {isEdit && used && <div className="small muted" style={{ marginBottom: 10 }}>Ưu đãi đã có lượt dùng: không đổi được loại và giá trị giảm.</div>}
      <div className="form-grid">
        <Field label={f.discountType === 'PERCENT' ? 'Phần trăm giảm' : 'Số tiền giảm (đ)'} required>
          <input type="number" min={1} disabled={isEdit && used} value={f.value} onChange={(e) => set('value', e.target.value)} />
        </Field>
        <Field label="Giảm tối đa (đ)" hint="Chỉ áp cho giảm theo %">
          <input type="number" min={0} value={f.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Đơn tối thiểu (đ)" hint="Tạm tính hóa đơn phải từ mức này">
          <input type="number" min={0} value={f.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value)} />
        </Field>
        <Field label="Giới hạn tổng số lượt" hint={isEdit && used ? `Đã dùng ${initial!.usedCount}, không giảm dưới mức này` : 'Trống = không giới hạn'}>
          <input type="number" min={used ? initial!.usedCount : 1} value={f.totalLimit} onChange={(e) => set('totalLimit', e.target.value)} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Bắt đầu">
          <input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </Field>
        <Field label="Kết thúc">
          <input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
        </Field>
      </div>
      {dateErr && <div className="form-error">{dateErr}</div>}
      <Field label="Điều khoản thêm (mỗi dòng một điều)">
        <textarea rows={2} value={f.extraTerms} onChange={(e) => set('extraTerms', e.target.value)} />
      </Field>
      <div className="form-grid">
        <label className="check-row"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Đang bật</label>
        <label className="check-row"><input type="checkbox" checked={f.listed} onChange={(e) => set('listed', e.target.checked)} /> Công khai trên mini app (bỏ tích = mã ẩn)</label>
        <label className="check-row"><input type="checkbox" checked={f.stackable} onChange={(e) => set('stackable', e.target.checked)} /> Cho phép cộng dồn với giảm giá tay</label>
        <label className="check-row"><input type="checkbox" checked={f.cashierCanApply} onChange={(e) => set('cashierCanApply', e.target.checked)} /> Thu ngân được tự áp mã</label>
      </div>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function RedemptionsModal({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const { activeStore } = useApp();
  const r = useFetch<OfferRedemptions>(() => api(`/stores/${activeStore!.id}/offers/${offer.id}/redemptions`), [offer.id]);
  const s = r.data?.stats;
  return (
    <Modal title={`Lượt dùng ${offer.code}`} subtitle={offer.headline} onClose={onClose} wide>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <div className="form-error">{r.error}</div>
      ) : (
        <>
          {s && (
            <div className="chip-row" style={{ marginBottom: 14 }}>
              <Badge cls="blue">Tổng lượt: {s.usedCount}</Badge>
              <Badge cls="green">Đã dùng: {s.consumed} ({fmtMoney(s.totalDiscountConsumed)})</Badge>
              <Badge cls="amber">Đang giữ: {s.reserved} ({fmtMoney(s.totalDiscountReserved)})</Badge>
              <Badge cls="grey">Đã trả lượt: {s.released}</Badge>
            </div>
          )}
          {(r.data?.redemptions ?? []).length === 0 ? (
            <Empty title="Chưa có lượt dùng" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Thời gian</th><th>Hóa đơn</th><th>Trạng thái</th><th className="num">Giảm</th></tr></thead>
                <tbody>
                  {r.data!.redemptions.map((x) => (
                    <tr key={x.id}>
                      <td>{fmtDateTime(x.createdAt)}{x.overrideReason && <small>Ngoại lệ: {x.overrideReason}</small>}</td>
                      <td>{x.billNo ?? '—'}{x.billStatus && <small>{(BILL_STATUS[x.billStatus] ?? { label: x.billStatus }).label}</small>}</td>
                      <td><Badge cls={(REDEMPTION_STATUS[x.status] ?? { cls: 'grey' }).cls}>{(REDEMPTION_STATUS[x.status] ?? { label: x.status }).label}</Badge></td>
                      <td className="num"><strong>{fmtMoney(x.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function Offers() {
  const { activeStore } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const { data, loading, error, refresh } = useFetch<Offer[]>(() => api(`/stores/${sid}/offers`), [sid]);
  const [modal, setModal] = useState<{ offer: Offer | null } | null>(null);
  const [view, setView] = useState<Offer | null>(null);
  const [del, setDel] = useState<Offer | null>(null);

  const toggle = async (o: Offer) => {
    try {
      await api(`/stores/${sid}/offers/${o.id}`, { method: 'PATCH', body: { active: !o.active } });
      toast(o.active ? `Đã tạm dừng ${o.code}` : `Đã bật ${o.code}`);
      refresh();
    } catch (e) {
      toast(billErrMsg(e), 'err');
    }
  };

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;
  const list = data ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Ưu đãi</h1>
          <p>Mã giảm giá dùng chung. Thu ngân nhập mã ở màn Bán hàng để áp vào hóa đơn.</p>
        </div>
        <div className="actions">
          <button className="button primary" onClick={() => setModal({ offer: null })}>
            <Icon name="plus" /> Tạo ưu đãi
          </button>
        </div>
      </header>
      <section className="panel">
        {list.length === 0 ? (
          <Empty title="Chưa có ưu đãi" sub="Tạo mã đầu tiên để thu ngân và khách dùng." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Ưu đãi</th>
                  <th>Hiệu lực</th>
                  <th className="num">Lượt dùng</th>
                  <th>Trạng thái</th>
                  <th className="num"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const st = OFFER_STATE[o.state] ?? { label: o.state, cls: 'grey' };
                  return (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.code}</strong>
                        <small>{o.listed ? 'Công khai' : 'Mã ẩn'}</small>
                      </td>
                      <td>
                        {o.headline}
                        <small>
                          {valueText(o)}
                          {o.minSubtotal ? ` · đơn từ ${fmtMoney(o.minSubtotal)}` : ''}
                          {o.stackable ? ' · cộng dồn' : ''}
                        </small>
                      </td>
                      <td className="muted">
                        {o.startsAt ? fmtDateTime(o.startsAt) : 'Ngay'} → {o.endsAt ? fmtDateTime(o.endsAt) : 'không hết hạn'}
                      </td>
                      <td className="num">
                        {o.usedCount}
                        {o.totalLimit ? ` / ${o.totalLimit}` : ''}
                      </td>
                      <td><Badge cls={st.cls}>{st.label}</Badge></td>
                      <td>
                        <div className="job-actions">
                          <button className="button tiny" onClick={() => setView(o)}>Lượt dùng</button>
                          <button className="button tiny" onClick={() => toggle(o)}>{o.active ? 'Tạm dừng' : 'Bật'}</button>
                          <button className="button tiny" onClick={() => setModal({ offer: o })}><Icon name="edit" size={13} /> Sửa</button>
                          <button className="button tiny danger" onClick={() => setDel(o)}>Xoá</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {modal && <OfferModal initial={modal.offer} onClose={() => setModal(null)} onSaved={refresh} />}
      {view && <RedemptionsModal offer={view} onClose={() => setView(null)} />}
      {del && (
        <ConfirmModal
          title={`Xoá ưu đãi ${del.code}`}
          message={del.usedCount > 0 ? 'Ưu đãi đã có lượt dùng nên không xoá được; hãy tạm dừng.' : 'Xoá hẳn ưu đãi này? Không thể hoàn tác.'}
          confirmLabel="Xoá"
          danger
          onClose={() => setDel(null)}
          onConfirm={async () => {
            try {
              await api(`/stores/${sid}/offers/${del.id}`, { method: 'DELETE' });
              toast('Đã xoá ưu đãi');
              refresh();
            } catch (e) {
              toast(billErrMsg(e), 'err');
            }
            setDel(null);
          }}
        />
      )}
    </>
  );
}
