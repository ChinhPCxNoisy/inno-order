import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { TABLE_STATUS } from '../labels';
import { fmtAgo, fmtDateTime, STALE_CALL_MINUTES } from '../format';
import type { Order, OrderItem, TableCallRequest, TableInfo, TablesData } from '../types';
import { useRealtimeRefresh } from '../realtime';
import { useFetch } from '../useFetch';
import { Badge, Empty, Icon, Loading, useToast } from '../ui';

/** Nhan ly do khach chon o man Ho tro tai ban cua mini app */
const CALL_REASON: Record<string, string> = {
  CALL_STAFF: 'Gọi nhân viên',
  WATER: 'Xin thêm nước',
  TOOLS: 'Xin khăn / dụng cụ',
  BILL: 'Yêu cầu tính tiền',
};

export default function Service() {
  const { activeStore } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data: orders, loading, refresh: reloadOrders } = useFetch<Order[]>(
    () => api(`/stores/${activeStore!.id}/kitchen/orders`),
    [activeStore?.id],
  );
  const { data: tables, refresh: reloadTables } = useFetch<TablesData>(
    () => api(`/stores/${activeStore!.id}/pos/tables`),
    [activeStore?.id],
  );
  const { data: calls, refresh: reloadCalls } = useFetch<TableCallRequest[]>(
    () => api(`/stores/${activeStore!.id}/table-calls`),
    [activeStore?.id],
  );

  useEffect(() => {
    const t = setInterval(() => {
      reloadOrders();
      reloadTables();
      reloadCalls();
    }, 15000);
    return () => clearInterval(t);
  }, [reloadOrders, reloadTables, reloadCalls]);

  // realtime: mon san sang, doi ban, goi ban -> cap nhat ngam
  useRealtimeRefresh(activeStore?.id, ['order.created', 'order.status', 'table.moved', 'table.call', 'table.call_resolved'], () => {
    reloadOrders();
    reloadTables();
    reloadCalls();
  }, 300);

  if (loading) return <Loading />;

  const readyItems = (orders ?? []).flatMap((o) =>
    o.items.filter((it) => it.status === 'READY').map((it) => ({ o, it })),
  );
  const readyQty = readyItems.reduce((s, x) => s + x.it.quantity, 0);
  const allTables = (tables?.areas ?? []).flatMap((a) => a.tables);
  const cleanTables = allTables.filter((t) => t.status === 'NEED_CLEAN');
  const occupiedTables = allTables.filter((t) => t.status === 'OCCUPIED');

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyKey(key);
    try {
      await fn();
      toast(okMsg);
      reloadOrders();
      reloadTables();
      reloadCalls();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusyKey(null);
    }
  };

  const serve = (o: Order, it: OrderItem) =>
    run(
      `it:${it.id}`,
      () =>
        api(`/stores/${activeStore!.id}/kitchen/orders/${o.id}/items/${it.id}/status`, {
          method: 'POST',
          body: { status: 'SERVED' },
        }),
      `Đã mang "${it.name}" tới bàn ${o.table?.code ?? ''}`,
    );

  const cleanTable = (t: TableInfo) =>
    run(
      `t:${t.id}`,
      () =>
        api(`/stores/${activeStore!.id}/tables/${t.id}/status`, {
          method: 'POST',
          body: { status: 'AVAILABLE' },
        }),
      `Bàn ${t.code} sẵn sàng đón khách`,
    );

  const resolveCall = (c: TableCallRequest) =>
    run(
      `call:${c.id}`,
      () => api(`/stores/${activeStore!.id}/table-calls/${c.id}/resolve`, { method: 'PATCH' }),
      `Đã xác nhận hỗ trợ bàn ${c.tableCode}`,
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Phục vụ tại bàn</h1>
          <p>Nhìn món sẵn sàng, mang đúng bàn và mở lại bàn sau khi dọn.</p>
        </div>
        <div className="actions">
          <button className="button" onClick={() => navigate('/pos')}>
            <Icon name="pos" /> Gọi món giúp khách
          </button>
        </div>
      </header>

      {(calls ?? []).length > 0 && (
        <div className="call-banner">
          {(calls ?? []).map((c) => {
            const ageMin = Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 60000);
            const stale = ageMin >= STALE_CALL_MINUTES;
            return (
            <div key={c.id} className={`call-banner-row${stale ? ' stale' : ''}`}>
              <span>
                🔔 Bàn <b>{c.tableCode}</b> · <b>{CALL_REASON[c.reason ?? 'CALL_STAFF'] ?? 'Cần hỗ trợ'}</b> ·{' '}
                <span className="call-age" title={fmtDateTime(c.createdAt)}>
                  {fmtAgo(c.createdAt)}
                </span>
                {stale && <span className="call-stale-tag">Yêu cầu cũ</span>}
                {c.note ? ` — “${c.note}”` : ''}
              </span>
              <button
                className="button primary"
                disabled={busyKey === `call:${c.id}`}
                onClick={() => resolveCall(c)}
              >
                <Icon name="check" /> Đã hỗ trợ
              </button>
            </div>
            );
          })}
        </div>
      )}

      <div className="queue-pills">
        <div className="queue-pill">
          Món chờ mang <b>{readyQty}</b>
        </div>
        <div className="queue-pill">
          Bàn cần dọn <b>{cleanTables.length}</b>
        </div>
        <div className="queue-pill">
          Bàn đang dùng <b>{occupiedTables.length}</b>
        </div>
      </div>

      <div className="panel-head">
        <h2>Món đã sẵn sàng</h2>
        <span className="small muted">Xác nhận khi đã mang món tới bàn</span>
      </div>
      {readyItems.length ? (
        <div className="ready-grid">
          {readyItems.map(({ o, it }) => (
            <article key={it.id} className="serve-card">
              <div className="top">
                <span className="table-code">{o.table?.code ?? '—'}</span>
                <Badge cls="green">Chờ mang ra</Badge>
              </div>
              <h3>
                {it.quantity}× {it.name}
              </h3>
              <p>
                #{o.orderNumber}
                {it.note ? ` · ${it.note}` : ''}
              </p>
              <button className="button primary" disabled={busyKey === `it:${it.id}`} onClick={() => serve(o, it)}>
                <Icon name="check" /> Đã mang ra bàn
              </button>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel" style={{ marginBottom: 24 }}>
          <Empty title="Đã mang hết món sẵn sàng" sub="Món hoàn tất ở bếp sẽ xuất hiện tại đây." />
        </section>
      )}

      <div className="panel-head">
        <h2>Dọn bàn & đón khách</h2>
        <span className="small muted">Thanh toán xong, bàn chuyển sang cần dọn</span>
      </div>
      <div className="table-grid">
        {cleanTables.map((t) => (
          <div key={t.id} className="table-tile clean">
            <div className="tile-top">
              <span className="table-code">{t.code}</span>
              <Badge cls="grey">{TABLE_STATUS[t.status]?.label ?? t.status}</Badge>
            </div>
            <p className="tile-body">
              {t.name ?? t.code} · {t.seats ?? '—'} chỗ
            </p>
            {(t.openOrders ?? 0) > 0 ? (
              // ban con don mo: khong the don, API cung se tu choi
              <p className="tile-note">Còn {t.openOrders} đơn đang mở, chưa thể dọn bàn.</p>
            ) : (
              <button className="button full" disabled={busyKey === `t:${t.id}`} onClick={() => cleanTable(t)}>
                <Icon name="check" /> Đã dọn bàn
              </button>
            )}
          </div>
        ))}
        {cleanTables.length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <Empty title="Không có bàn cần dọn" />
          </div>
        )}
      </div>
    </>
  );
}
