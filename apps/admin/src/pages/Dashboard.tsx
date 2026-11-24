import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { fmtDateTime, fmtMoney, localDateStr, methodRows } from '../format';
import { ORDER_STATUS, PAY_METHOD } from '../labels';
import type { DailyReport, Order, TablesData } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Icon, Loading } from '../ui';

function StoreOverview() {
  const { stores, selectStore } = useApp();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tổng quan hệ thống</h1>
          <p>Các quán đang chạy trên nền tảng InnoOrder.</p>
        </div>
        <div className="actions">
          <Link to="/stores" className="button primary">
            <Icon name="plus" /> Thêm quán
          </Link>
        </div>
      </header>
      <div className="store-grid">
        {stores.map((s) => (
          <div key={s.id} className="store-card">
            <div className="logo">
              {s.logoUrl ? <img src={s.logoUrl} alt="" /> : s.name.charAt(0).toUpperCase()}
            </div>
            <h3>{s.name}</h3>
            <div className="slug">/{s.slug}</div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <Badge cls={s.status === 'ACTIVE' ? 'green' : 'red'}>{s.status === 'ACTIVE' ? 'Hoạt động' : 'Tạm khóa'}</Badge>
              <button className="button tiny primary" onClick={() => selectStore(s.id)}>
                Quản lý quán →
              </button>
            </div>
          </div>
        ))}
        {stores.length === 0 && <Empty title="Chưa có quán nào" sub="Hãy tạo quán đầu tiên." />}
      </div>
    </>
  );
}

function Stat({ name, value, sub, ic, feature }: { name: string; value: string; sub: string; ic: string; feature?: boolean }) {
  return (
    <section className={`stat${feature ? ' featured' : ''}`}>
      <div className="stat-top">
        <span>{name}</span>
        <Icon name={ic} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-bottom">{sub}</div>
    </section>
  );
}

function StoreDashboard({ storeId }: { storeId: string }) {
  const navigate = useNavigate();
  const date = localDateStr();

  const { data, loading, error, reload } = useFetch<DailyReport>(
    () => api(`/stores/${storeId}/reports/daily?date=${date}`),
    [storeId],
  );
  const { data: kitchenOrders } = useFetch<Order[]>(() => api(`/stores/${storeId}/kitchen/orders`), [storeId]);
  const { data: tablesData } = useFetch<TablesData>(() => api(`/stores/${storeId}/pos/tables`), [storeId]);

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;
  if (!data) return null;

  const tables = (tablesData?.areas ?? []).flatMap((a) => a.tables);
  const openOrders = kitchenOrders ?? [];
  const late = openOrders.filter((o) => o.isLate);
  const waiting = openOrders.filter((o) => o.status === 'PENDING' || o.status === 'ACCEPTED');
  const readyQty = openOrders.flatMap((o) => o.items).filter((i) => i.status === 'READY').reduce((s, i) => s + i.quantity, 0);
  const cleanTables = tables.filter((t) => t.status === 'NEED_CLEAN');
  const occupied = tables.filter((t) => t.status === 'OCCUPIED').length;
  const totalTables = tables.length;
  const free = tables.filter((t) => t.status === 'AVAILABLE' || t.status === 'CLEANED').length;
  const methodList = methodRows(data.byMethod, data.refundByMethod);
  const methodTotal = methodList.reduce((s, m) => s + Math.max(0, m.net), 0);

  const tasks: [string, string, string, string, string, string][] = [
    ['kitchen', '', 'Đơn chờ bếp nhận', `${waiting.length} đơn chưa được nhận`, 'Mở bếp', '/kitchen'],
    ['serve', '', 'Món đã sẵn sàng', `${readyQty} món đang chờ mang ra`, 'Phục vụ', '/service'],
    ['table', '', 'Bàn dùng xong', `${cleanTables.length} bàn cần dọn trước khi đón khách`, 'Xem bàn', '/service'],
    ['order', '', 'Đơn đang mở', `${openOrders.length} đơn chưa thanh toán`, 'Xem đơn', '/orders'],
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tổng quan vận hành</h1>
          <p>
            Những việc cần chú ý và kết quả kinh doanh trong ngày ·{' '}
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="actions">
          <Link to="/reports" className="button">
            <Icon name="chart" /> Xem báo cáo
          </Link>
          <button className="button" onClick={reload}>
            <Icon name="refresh" /> Làm mới
          </button>
        </div>
      </header>

      <div className="stat-grid">
        <Stat
          name="Doanh thu đã thu"
          value={fmtMoney(data.revenue)}
          sub={`${data.orders.completed} đơn đã thanh toán · Gross ${fmtMoney(data.grossRevenue)}`}
          ic="money"
          feature
        />
        <Stat
          name="Đơn đã tạo"
          value={String(data.orders.created)}
          sub={`${data.orders.cancelled} huỷ · ${data.orders.refunded} lượt hoàn tiền`}
          ic="order"
        />
        <Stat
          name="Bàn đang dùng"
          value={`${occupied} / ${totalTables}`}
          sub={`${free} bàn trống · ${cleanTables.length} cần dọn`}
          ic="table"
        />
        <Stat
          name="Hoàn tiền hôm nay"
          value={fmtMoney(data.refundAmount)}
          sub={`${data.orders.refunded} lượt hoàn tiền (theo phương thức gốc)`}
          ic="chart"
        />
      </div>

      {late.length > 0 && (
        <div className="alert-strip">
          <span>{late.length} đơn có món chờ từ 15 phút, cần ưu tiên xử lý.</span>
          <button className="button tiny" onClick={() => navigate('/kitchen')}>
            Xử lý ngay →
          </button>
        </div>
      )}

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>Cần xử lý trong ca</h2>
            <span className="badge grey">Dữ liệu realtime</span>
          </div>
          {tasks.map(([ic, , t, s, a, to]) => (
            <div key={t} className="task-row">
              <span className="task-icon">
                <Icon name={ic} />
              </span>
              <span>
                <strong>{t}</strong>
                <small>{s}</small>
              </span>
              <button className="button tiny" onClick={() => navigate(to)}>
                {a} →
              </button>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Thu tiền theo phương thức</h2>
            <span className="small muted">Thực thu, đã trừ hoàn tiền</span>
          </div>
          <div className="metric-list">
            {methodList.length ? (
              methodList.map((m) => (
                <div key={m.method}>
                  <div className="metric-row">
                    <span>
                      {PAY_METHOD[m.method] ?? m.method}{' '}
                      <small>
                        · {m.count} lần{m.refund > 0 ? ` · hoàn ${fmtMoney(m.refund)}` : ''}
                      </small>
                    </span>
                    <b>{fmtMoney(m.net)}</b>
                  </div>
                  <div className="mini-bar">
                    <span style={{ width: `${methodTotal ? (Math.max(0, m.net) / methodTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Chưa có thanh toán hôm nay" />
            )}
          </div>
          <div className="notice" style={{ margin: '16px 0 0' }}>
            Chỉ ghi nhận doanh thu khi xác nhận đã nhận tiền. Đơn huỷ không được tính vào doanh thu.
          </div>
        </section>
      </div>

      <div className="workspace-links">
        <Link className="workspace-link" to="/pos">
          <Icon name="pos" />
          <span>
            <b>Thu ngân</b>
            <small>Bàn, gọi món, thanh toán</small>
          </span>
        </Link>
        <Link className="workspace-link" to="/kitchen">
          <Icon name="kitchen" />
          <span>
            <b>Bếp / Bar</b>
            <small>Nhận và chế biến món</small>
          </span>
        </Link>
        <Link className="workspace-link" to="/service">
          <Icon name="serve" />
          <span>
            <b>Phục vụ</b>
            <small>Mang món, dọn bàn</small>
          </span>
        </Link>
        <Link className="workspace-link" to="/reports">
          <Icon name="chart" />
          <span>
            <b>Chủ quán</b>
            <small>Doanh thu, hiệu suất</small>
          </span>
        </Link>
      </div>

      <section className="panel" style={{ marginTop: 22 }}>
        <div className="panel-head">
          <h2>Đơn đang mở gần đây</h2>
          <Link to="/orders">Tất cả đơn hàng →</Link>
        </div>
        {openOrders.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Đơn hàng</th>
                  <th>Bàn / nguồn</th>
                  <th>Số món</th>
                  <th>Trạng thái</th>
                  <th>Thời gian</th>
                  <th className="num">Thành tiền</th>
                  <th className="num"></th>
                </tr>
              </thead>
              <tbody>
                {openOrders
                  .slice()
                  .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                  .slice(0, 5)
                  .map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>#{o.orderNumber}</strong>
                      </td>
                      <td>
                        <strong>{o.table?.code ?? '—'}</strong>
                        <small>{ORDER_SOURCE_LABEL(o.source)}</small>
                      </td>
                      <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td>
                        <Badge cls={ORDER_STATUS[o.status]?.cls ?? 'grey'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                      </td>
                      <td>
                        {new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        <small>{fmtDateTime(o.createdAt).slice(0, 11)}</small>
                      </td>
                      <td className="num">
                        <strong>{fmtMoney(o.totalAmount)}</strong>
                      </td>
                      <td className="num">
                        <button className="button tiny" onClick={() => navigate(`/orders?open=${o.id}`)}>
                          Chi tiết →
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Không có đơn đang mở" sub="Tạo đơn mới ở màn Bán hàng." />
        )}
      </section>
    </>
  );
}

function ORDER_SOURCE_LABEL(s: string) {
  return s === 'QR' ? 'QR khách' : s === 'POS' ? 'POS' : 'Admin';
}

export default function Dashboard() {
  const { isSuper, activeStore } = useApp();

  if (isSuper && !activeStore) return <StoreOverview />;
  if (!activeStore) return null;

  return <StoreDashboard storeId={activeStore.id} />;
}
