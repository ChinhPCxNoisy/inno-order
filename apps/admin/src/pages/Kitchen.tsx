import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtWaited } from '../format';
import { ITEM_STATUS, ORDER_SOURCE } from '../labels';
import type { Order } from '../types';
import { useRealtimeRefresh } from '../realtime';
import { useFetch } from '../useFetch';
import { Empty, Icon, Loading, useToast } from '../ui';

const COLS: { key: string; title: string; statuses: string[]; hint: string }[] = [
  { key: 'waiting', title: '01 · Chờ nhận', statuses: ['PENDING', 'ACCEPTED'], hint: 'chờ nhận' },
  { key: 'cooking', title: '02 · Đang chế biến', statuses: ['PREPARING'], hint: 'đang làm' },
  { key: 'ready', title: '03 · Chờ mang ra', statuses: ['READY'], hint: 'chờ phục vụ' },
];

const NEXT_ITEM: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'ACCEPTED', label: 'Nhận' },
  ACCEPTED: { status: 'PREPARING', label: 'Làm' },
  PREPARING: { status: 'READY', label: 'Xong' },
  READY: { status: 'SERVED', label: 'Phục vụ' },
};

function KdsCard({
  order,
  colKey,
  busy,
  onAccept,
  onReady,
  onItemStatus,
  onCallService,
}: {
  order: Order;
  colKey: string;
  busy: boolean;
  onAccept: (o: Order) => void;
  onReady: (o: Order) => void;
  onItemStatus: (o: Order, itemId: string, status: string) => void;
  onCallService: () => void;
}) {
  const qty = order.items.filter((i) => i.status !== 'CANCELLED').reduce((s, i) => s + i.quantity, 0);
  const hint = COLS.find((c) => c.key === colKey)?.hint ?? '';

  return (
    <article className={`kds-card${order.isLate ? ' late' : ''}`}>
      <header className="kds-card-head">
        <div>
          <span className="table-code">{order.table?.code ?? '—'}</span>
          <small>
            #{order.orderNumber} · {ORDER_SOURCE[order.source] ?? order.source}
          </small>
        </div>
        <span className={`timer${order.isLate ? ' late' : ''}`}>
          <Icon name="clock" size={12} /> {fmtWaited(order.waitedSeconds)}{order.isLate ? ' · Chờ lâu' : ''}
        </span>
      </header>
      <div className="kds-items">
        {order.items.map((it) => (
          <div key={it.id} className="kds-item">
            <span className="kds-qty">{it.quantity}×</span>
            <div className="kds-item-name">
              {it.name}
              {it.note && <small>{it.note}</small>}
              {it.options.map((o, i) => (
                <small key={i}>
                  {o.optionGroup}: {o.optionValue}
                  {o.extraPrice > 0 ? ` (+${o.extraPrice.toLocaleString('vi-VN')}đ)` : ''}
                </small>
              ))}
              <span className="small muted" style={{ display: 'block', fontWeight: 400, marginTop: 6 }}>
                {(ITEM_STATUS[it.status] ?? { label: it.status }).label}
              </span>
            </div>
            {it.status !== 'CANCELLED' && it.status !== 'SERVED' && NEXT_ITEM[it.status] && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => onItemStatus(order, it.id, NEXT_ITEM[it.status].status)}
              >
                {NEXT_ITEM[it.status].label}
              </button>
            )}
          </div>
        ))}
        {order.customerNote && (
          <p className="small muted" style={{ padding: '8px 0 12px' }}>
            Ghi chú đơn: {order.customerNote}
          </p>
        )}
      </div>
      <footer className="kds-card-foot">
        <span>{qty} món {hint}</span>
        {colKey === 'ready' ? (
          <button className="button tiny" onClick={onCallService}>
            Gọi phục vụ →
          </button>
        ) : (
          <>
            {(order.status === 'PENDING' || order.status === 'ACCEPTED') && (
              <button className="button" disabled={busy} onClick={() => onAccept(order)}>
                {order.status === 'PENDING' ? 'Nhập đơn' : 'Tiếp tục'}
              </button>
            )}
            {['PENDING', 'ACCEPTED', 'PREPARING'].includes(order.status) && (
              <button className="button primary" disabled={busy} onClick={() => onReady(order)}>
                <Icon name="check" size={13} /> Sẵn sàng
              </button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

export default function Kitchen() {
  const { activeStore } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const { data, loading, error, refresh } = useFetch<Order[]>(
    () => api(`/stores/${activeStore!.id}/kitchen/orders`),
    [activeStore?.id],
  );

  // lam moi ngam: khong hien Loading, khong unmount bang dang hien thi
  useEffect(() => {
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  // don moi / doi trang thai / doi ban -> man bep cap nhat ngay (khong cho 15 giay)
  useRealtimeRefresh(activeStore?.id, ['order.created', 'order.status', 'table.moved'], refresh, 300);

  useEffect(() => {
    document.body.classList.toggle('focus-mode', focus);
    return () => document.body.classList.remove('focus-mode');
  }, [focus]);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const orders = data ?? [];

  const run = async (o: Order, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(o.id);
    try {
      await fn();
      toast(okMsg);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusyId(null);
    }
  };

  const onAccept = (o: Order) =>
    run(o, () => api(`/stores/${activeStore!.id}/kitchen/orders/${o.id}/accept`, { method: 'POST' }), `Đã nhập đơn #${o.orderNumber}`);
  const onReady = (o: Order) =>
    run(o, () => api(`/stores/${activeStore!.id}/kitchen/orders/${o.id}/ready`, { method: 'POST' }), `Đơn #${o.orderNumber} sẵn sàng`);
  const onItemStatus = (o: Order, itemId: string, status: string) =>
    run(
      o,
      () =>
        api(`/stores/${activeStore!.id}/kitchen/orders/${o.id}/items/${itemId}/status`, {
          method: 'POST',
          body: { status },
        }),
      status === 'READY' ? 'Món đã xuất hiện ở màn Phục vụ.' : status === 'SERVED' ? 'Đã xác nhận mang món tới bàn.' : 'Đã cập nhật trạng thái món.',
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Bếp & pha chế</h1>
          <p>Ưu tiên đơn chờ lâu. Ghi chú được giữ nổi bật trên từng món.</p>
        </div>
        <div className="actions">
          <button className="button" onClick={() => setFocus((v) => !v)}>
            <Icon name="focus" /> {focus ? 'Thu gọn' : 'Toàn màn hình'}
          </button>
          <button className="button" onClick={refresh}>
            <Icon name="refresh" /> Làm mới
          </button>
        </div>
      </header>
      <div className="filters">
        <span className="small muted">Tính thời gian từ lúc tạo đơn · Cảnh báo từ 15 phút</span>
      </div>
      <div className="kds-layout">
        {COLS.map((col) => {
          const colOrders = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <section key={col.key} className="kds-col">
              <header className="kds-col-head">
                {col.title}
                <span>{colOrders.length}</span>
              </header>
              {colOrders.length === 0 && (
                <Empty
                  title={col.key === 'waiting' ? 'Không có món chờ' : col.key === 'cooking' ? 'Chưa có món đang làm' : 'Chưa có món hoàn tất'}
                />
              )}
              {colOrders.map((o) => (
                <KdsCard
                  key={o.id}
                  order={o}
                  colKey={col.key}
                  busy={busyId === o.id}
                  onAccept={onAccept}
                  onReady={onReady}
                  onItemStatus={onItemStatus}
                  onCallService={() => navigate('/service')}
                />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
