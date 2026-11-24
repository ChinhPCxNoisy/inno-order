import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtMoney } from '../format';
import { PAY_METHOD, TABLE_STATUS } from '../labels';
import { billErrMsg } from '../errors';
import { useRealtimeRefresh } from '../realtime';
import type { MenuCategory, Order, SessionView, TableInfo, TablesData } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Icon, Loading, Modal, useToast } from '../ui';
import BillPanel from '../components/BillPanel';

interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  note: string;
}

const tileCls = (status: string) =>
  status === 'OCCUPIED'
    ? 'occupied'
    : status === 'NEED_CLEAN'
      ? 'clean'
      : status === 'LOCKED' || status === 'RESERVED'
        ? 'locked'
        : 'free';

const STATUS_FILTERS: { label: string; match: (s: string) => boolean }[] = [
  { label: 'Tất cả', match: () => true },
  { label: 'Đang dùng', match: (s) => s === 'OCCUPIED' },
  { label: 'Trống', match: (s) => s === 'AVAILABLE' || s === 'CLEANED' },
  { label: 'Cần dọn', match: (s) => s === 'NEED_CLEAN' },
];

/** Thanh toan theo don: CHI cho don le khong thuoc phien ban (du lieu cu); don thuoc phien thanh toan theo hoa don ban */
function PayModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { activeStore } = useApp();
  const [method, setMethod] = useState<'CASH' | 'TRANSFER' | 'QR_BANK'>('CASH');
  const [discount, setDiscount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const afterDiscount = order.totalAmount - (parseInt(discount) || 0);
  const change = method === 'CASH' && cashReceived ? parseInt(cashReceived) - afterDiscount : null;
  const cashShort = method === 'CASH' && cashReceived !== '' && change !== null && change < 0;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/pos/orders/${order.id}/payment`, {
        method: 'POST',
        body: {
          method,
          discountAmount: discount ? parseInt(discount) : undefined,
          cashReceived: method === 'CASH' && cashReceived ? parseInt(cashReceived) : undefined,
        },
      });
      toast(`Thanh toán đơn #${order.orderNumber} thành công`);
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
      title={`Thanh toán đơn #${order.orderNumber}`}
      subtitle={`${order.items.reduce((s, i) => s + i.quantity, 0)} món · Ghi nhận đã nhận tiền`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted">Chỉ xác nhận sau khi đã nhận đủ tiền.</span>
          <button className="button primary" disabled={busy || afterDiscount < 0 || cashShort} onClick={submit}>
            {busy ? 'Đang xử lý...' : `Xác nhận đã nhận ${fmtMoney(afterDiscount)}`}
          </button>
        </>
      }
    >
      <div className="small muted">TỔNG CẦN THU</div>
      <div className="checkout-amount">{fmtMoney(afterDiscount)}</div>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id}>
                <td>
                  {it.name}
                  {it.note ? <small>{it.note}</small> : null}
                </td>
                <td className="num">{it.quantity}×</td>
                <td className="num">{fmtMoney(it.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.discountAmount > 0 && (
        <div className="summary-line">
          <span>Giảm giá (đã ghi)</span>
          <span>− {fmtMoney(order.discountAmount)}</span>
        </div>
      )}
      <span className="option-label">Phương thức nhận tiền</span>
      <div className="radio-choices">
        {(['CASH', 'TRANSFER', 'QR_BANK'] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="payment" checked={method === m} onChange={() => setMethod(m)} />
            {PAY_METHOD[m]}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Giảm giá (đ)</span>
          <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </label>
        {method === 'CASH' && (
          <label className="field">
            <span>Tiền khách đưa (đ)</span>
            <input type="number" min={0} step={1000} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
          </label>
        )}
      </div>
      {method === 'CASH' && cashReceived !== '' && (
        <div className="summary-line">
          <span>Tiền trả lại khách</span>
          <b>{change !== null && change >= 0 ? fmtMoney(change) : `Còn thiếu ${fmtMoney(-change!)}`}</b>
        </div>
      )}
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function CreateOrderModal({ table, tables, onClose, onDone }: { table: TableInfo; tables: TableInfo[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { activeStore } = useApp();
  const { data: menu, loading } = useFetch<MenuCategory[]>(
    () => api(`/stores/${activeStore!.id}/menu`),
    [activeStore?.id],
  );
  const [tableId, setTableId] = useState(table.id);
  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cats = (menu ?? []).filter((c) => c.active);
  const activeCat = cats.find((c) => c.id === catId);
  const shownItems = (catId === 'all' ? cats.flatMap((c) => c.items) : activeCat?.items ?? [])
    .filter((it) => it.active)
    .filter((it) => !search || it.name.toLowerCase().includes(search.toLowerCase()));

  const lines = Object.values(cart);
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);

  const add = (id: string, name: string, price: number) =>
    setCart((c) => ({
      ...c,
      [id]: c[id] ? { ...c[id], quantity: Math.min(99, c[id].quantity + 1) } : { menuItemId: id, name, price, quantity: 1, note: '' },
    }));
  const dec = (id: string) =>
    setCart((c) => {
      const line = c[id];
      if (!line) return c;
      if (line.quantity <= 1) {
        const { [id]: _drop, ...rest } = c;
        return rest;
      }
      return { ...c, [id]: { ...line, quantity: line.quantity - 1 } };
    });
  const setLineNote = (id: string, n: string) => setCart((c) => (c[id] ? { ...c, [id]: { ...c[id], note: n } } : c));

  const submit = async () => {
    if (lines.length === 0) return;
    const chosen = tables.find((t) => t.id === tableId);
    if (!chosen) {
      setErr('Bàn không còn sẵn sàng. Vui lòng chọn bàn khác.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/stores/${activeStore!.id}/orders`, {
        method: 'POST',
        body: {
          tableCode: chosen.code,
          source: 'POS',
          customerNote: note || undefined,
          items: lines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            note: l.note || undefined,
          })),
        },
      });
      toast(`Đã tạo đơn cho bàn ${chosen.code} · Bếp có thể nhận món.`);
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
      title="Tạo đơn tại bàn"
      subtitle="Chọn món. Đơn sẽ xuất hiện trong màn bếp."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="small muted">
            Tổng: <b style={{ fontSize: 18, color: 'var(--green)' }}>{fmtMoney(total)}</b>
          </span>
          <button className="button primary" disabled={busy || lines.length === 0} onClick={submit}>
            {busy ? 'Đang tạo đơn...' : 'Gửi đơn đến bếp →'}
          </button>
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="form-grid">
            <label className="field">
              <span>Bàn phục vụ</span>
              <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {TABLE_STATUS[t.status]?.label ?? t.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tìm món</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên món..." />
            </label>
          </div>
          <div className="tabs" style={{ marginBottom: 15 }}>
            <button className={`tab${catId === 'all' ? ' active' : ''}`} onClick={() => setCatId('all')}>
              Tất cả
            </button>
            {cats.map((c) => (
              <button key={c.id} className={`tab${catId === c.id ? ' active' : ''}`} onClick={() => setCatId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="order-products">
            {shownItems.map((it) => (
              <button key={it.id} className="pick-product" onClick={() => add(it.id, it.name, it.price)}>
                {it.imageUrl ? (
                  <img src={it.imageUrl} alt="" />
                ) : (
                  <span className="fallback">{it.name.charAt(0).toUpperCase()}</span>
                )}
                <span>
                  <strong>{it.name}</strong>
                  <small>
                    {fmtMoney(it.price)}
                    {it.prepTimeMinutes ? ` · ${it.prepTimeMinutes} phút` : ''}
                  </small>
                </span>
                <span style={{ marginLeft: 'auto' }}>+</span>
              </button>
            ))}
            {shownItems.length === 0 && <Empty title="Không có món phù hợp" />}
          </div>
          <div className="panel-head" style={{ margin: '20px 0 3px' }}>
            <h2>Món đã chọn</h2>
            <span className="small muted">{lines.reduce((s, l) => s + l.quantity, 0)} món</span>
          </div>
          {lines.length ? (
            lines.map((l) => (
              <div key={l.menuItemId} className="draft-line">
                <span>
                  <b>{l.name}</b>
                  <input
                    style={{ fontSize: 10, padding: 7, margin: '7px 0 0', width: '100%' }}
                    value={l.note}
                    maxLength={200}
                    aria-label={`Ghi chú ${l.name}`}
                    placeholder="Ghi chú món: ít cay, không hành..."
                    onChange={(e) => setLineNote(l.menuItemId, e.target.value)}
                  />
                </span>
                <div className="qty-control">
                  <button aria-label={`Bớt ${l.name}`} onClick={() => dec(l.menuItemId)}>
                    −
                  </button>
                  <span>{l.quantity}</span>
                  <button aria-label={`Thêm ${l.name}`} onClick={() => add(l.menuItemId, l.name, l.price)}>
                    +
                  </button>
                </div>
                <b style={{ fontSize: 10, minWidth: 70, textAlign: 'right' }}>{fmtMoney(l.price * l.quantity)}</b>
              </div>
            ))
          ) : (
            <Empty title="Chưa chọn món" sub="Chạm vào món ở trên để thêm vào đơn." />
          )}
          <label className="field" style={{ marginTop: 18 }}>
            <span>Ghi chú chung cho đơn</span>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: khách gọi thêm, mang món cùng lúc..." />
          </label>
          {err && <div className="form-error">{err}</div>}
        </>
      )}
    </Modal>
  );
}

function TableTile({ table, active, mergedWith, onClick }: { table: TableInfo; active: boolean; mergedWith: string[]; onClick: () => void }) {
  const st = TABLE_STATUS[table.status] ?? { label: table.status, cls: 'grey' };
  return (
    <button className={`table-tile ${tileCls(table.status)}${active ? ' active' : ''}`} onClick={onClick} aria-pressed={active}>
      <div className="tile-top">
        <span className="table-code">{table.code}</span>
        <Badge cls={st.cls}>{st.label}</Badge>
      </div>
      <div className="tile-body">
        {table.name ?? table.code} · {table.seats ?? '—'} chỗ
      </div>
      {mergedWith.length > 0 && <div className="tile-merged">Gộp với {mergedWith.join(', ')}</div>}
      <div className="tile-amount">
        {table.openOrders > 0
          ? `${table.openOrders} đơn · ${fmtMoney(table.billTotal ?? table.openAmount)}${table.billStatus === 'PARTIALLY_PAID' && table.billRemaining != null ? ` · còn ${fmtMoney(table.billRemaining)}` : ''}`
          : table.status === 'NEED_CLEAN'
            ? 'Chờ nhân viên dọn'
            : table.status === 'LOCKED'
              ? 'Chưa đón khách'
              : 'Sẵn sàng đón khách'}
      </div>
    </button>
  );
}

export default function Pos() {
  const { activeStore } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState('Tất cả');
  const [statusFilter, setStatusFilter] = useState('Tất cả');
  const [paying, setPaying] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  const { data, loading, error, refresh } = useFetch<TablesData>(
    () => api(`/stores/${activeStore!.id}/pos/tables`),
    [activeStore?.id],
  );

  const allTables = useMemo(() => (data?.areas ?? []).flatMap((a) => a.tables), [data]);
  const areaOf = useMemo(() => {
    const m = new Map<string, string>();
    (data?.areas ?? []).forEach((a) => a.tables.forEach((t) => m.set(t.id, a.name)));
    return m;
  }, [data]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('innoorder_pos_table');
      if (saved && data) {
        const found = allTables.find((t) => t.code === saved);
        if (found) setSelectedId(found.id);
        sessionStorage.removeItem('innoorder_pos_table');
      }
    } catch {
      /* ignore */
    }
  }, [data, allTables]);

  const selectedTable = allTables.find((t) => t.id === selectedId) ?? null;

  // hoa don cua ban dang chon (tat ca don/dot goi them cua phien); gan kem tableId de khong hien nham du lieu ban truoc khi doi ban
  const { data: sess, refresh: refreshSession } = useFetch<{ tableId: string; view: SessionView } | null>(
    async () =>
      selectedId
        ? { tableId: selectedId, view: await api<SessionView>(`/stores/${activeStore!.id}/pos/tables/${selectedId}/session`) }
        : null,
    [activeStore?.id, selectedId],
  );
  const view = sess && sess.tableId === selectedId ? sess.view : null;
  const sessionLoading = !!selectedId && !view;

  // don le khong co phien (du lieu cu): van thanh toan theo don
  const needLegacy = !!selectedTable && !!view && view.session === null && selectedTable.openOrders > 0;
  const { data: legacy, refresh: refreshLegacy } = useFetch<{ tableId: string; orders: Order[] } | null>(
    async () =>
      needLegacy && selectedId
        ? { tableId: selectedId, orders: await api<Order[]>(`/stores/${activeStore!.id}/pos/tables/${selectedId}/orders`) }
        : null,
    [activeStore?.id, selectedId, needLegacy],
  );
  const legacyOrders = legacy && legacy.tableId === selectedId && needLegacy ? legacy.orders : [];

  const refreshAll = () => {
    refresh();
    refreshSession();
    refreshLegacy();
  };
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;

  // realtime: don moi / doi trang thai / thanh toan / doi ban -> lam moi ngam; du phong 20 giay
  useRealtimeRefresh(activeStore?.id, ['order.created', 'order.status', 'table.moved'], () => refreshRef.current());
  useEffect(() => {
    const t = setInterval(() => refreshRef.current(), 20000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const areas = data?.areas ?? [];
  const filtered = allTables.filter((t) => {
    if (areaFilter !== 'Tất cả' && areaOf.get(t.id) !== areaFilter) return false;
    const f = STATUS_FILTERS.find((x) => x.label === statusFilter);
    return f ? f.match(t.status) : true;
  });

  const payableTables = allTables.filter((t) => ['AVAILABLE', 'OCCUPIED', 'CLEANED'].includes(t.status));

  // ban gop chung 1 phien: hien "Gop voi ..." tren o ban
  const mergedOf = (t: TableInfo) =>
    t.sessionId ? allTables.filter((x) => x.sessionId === t.sessionId && x.id !== t.id).map((x) => x.code) : [];

  const reprintLegacy = async (o: Order) => {
    try {
      await api(`/stores/${activeStore!.id}/orders/${o.id}/reprint`, { method: 'POST', body: { kind: 'bill' } });
      toast(`Đã gửi in bill đơn #${o.orderNumber}`);
    } catch (e) {
      toast(billErrMsg(e), 'err');
    }
  };

  const setTableStatus = async (t: TableInfo, status: string, msg: string) => {
    try {
      await api(`/stores/${activeStore!.id}/tables/${t.id}/status`, { method: 'POST', body: { status } });
      toast(msg);
      refreshAll();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Bán hàng & thu ngân</h1>
          <p>Chọn bàn để gọi món, xem hóa đơn cả bàn và thanh toán.</p>
        </div>
        <div className="actions">
          <button
            className="button primary"
            onClick={() => (selectedTable && payableTables.some((t) => t.id === selectedTable.id) ? setCreating(true) : toast('Chọn một bàn trống hoặc đang dùng trước.', 'err'))}
          >
            <Icon name="plus" /> Tạo đơn tại bàn
          </button>
        </div>
      </header>
      <div className="split-pos">
        <section className="pos-area">
          <div className="filters">
            <div className="tabs">
              {['Tất cả', ...areas.map((a) => a.name)].map((name) => (
                <button key={name} className={`tab${areaFilter === name ? ' active' : ''}`} onClick={() => setAreaFilter(name)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="filters">
            <div className="tabs">
              {STATUS_FILTERS.map((f) => (
                <button key={f.label} className={`tab${statusFilter === f.label ? ' active' : ''}`} onClick={() => setStatusFilter(f.label)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {areas
            .filter((a) => areaFilter === 'Tất cả' || a.name === areaFilter)
            .map((area) => {
              const rows = filtered.filter((t) => areaOf.get(t.id) === area.name);
              if (rows.length === 0) return null;
              return (
                <div key={area.id}>
                  <div className="area-heading">
                    {area.name} <small>{rows.length} bàn</small>
                  </div>
                  <div className="table-grid">
                    {rows.map((t) => (
                      <TableTile
                        key={t.id}
                        table={t}
                        active={t.id === selectedId}
                        mergedWith={mergedOf(t)}
                        onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          {filtered.length === 0 && <Empty title="Không có bàn phù hợp" sub="Thử khu vực hoặc trạng thái khác." />}
          <div className="legend">
            <span>
              <i></i>Trống
            </span>
            <span>
              <i></i>Đang dùng
            </span>
            <span>
              <i></i>Cần dọn
            </span>
            <span>Chọn bàn để xem chi tiết →</span>
          </div>
        </section>

        {!selectedTable ? (
          <aside className="bill-panel">
            <div className="bill-body">
              <Empty title="Chọn một bàn" sub="Bấm vào bàn bên trái để xem hóa đơn của bàn." />
            </div>
          </aside>
        ) : (
          <BillPanel
            table={selectedTable}
            areaName={areaOf.get(selectedTable.id) ?? '—'}
            view={view}
            loading={sessionLoading}
            tables={data!}
            legacyOrders={legacyOrders}
            onCreateOrder={() => setCreating(true)}
            onChanged={refreshAll}
            onSelectTable={setSelectedId}
            onLegacyPay={setPaying}
            onLegacyReprint={reprintLegacy}
            onSetStatus={setTableStatus}
          />
        )}
      </div>

      {paying && <PayModal order={paying} onClose={() => setPaying(null)} onDone={refreshAll} />}
      {creating && selectedTable && (
        <CreateOrderModal table={selectedTable} tables={payableTables} onClose={() => setCreating(false)} onDone={refreshAll} />
      )}
    </>
  );
}
