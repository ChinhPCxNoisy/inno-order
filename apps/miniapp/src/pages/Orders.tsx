import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Img from '../components/Img';
import Shell, { Loading, PageTitle, useTable } from '../components/Shell';
import { EmptyBody } from '../components/StateView';
import { publicApi } from '../api';
import { fmtDate, fmtMoney } from '../format';
import { FINAL_STATUSES } from '../useOrder';
import { getOrders, orderThumb, type SessionOrder } from '../session';
import { useBrand } from '../useBrand';
import type { PublicOrderTracking } from '../types';

type Filter = 'all' | 'active' | 'paid';
interface Row {
  session: SessionOrder;
  order: PublicOrderTracking | null;
}

/** Lich su don hang (thiet ke v2, man 11): don luu tren thiet bi + trang thai that tu server. */
export default function Orders() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { q } = useTable();
  const brand = useBrand(storeSlug);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    const mine = getOrders().filter((o) => o.storeSlug === storeSlug);
    Promise.all(
      mine.map((session) =>
        publicApi
          .trackOrder(session.orderId)
          .then((order) => ({ session, order }))
          .catch(() => ({ session, order: null })),
      ),
    ).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [storeSlug]);

  const isPaid = (r: Row) => r.order?.status === 'COMPLETED';
  const isActive = (r: Row) => r.order !== null && !FINAL_STATUSES.includes(r.order.status);
  const list = (rows ?? []).filter((r) => filter === 'all' || (filter === 'active' ? isActive(r) : isPaid(r)));
  const menuHref = `/s/${storeSlug}${q}`;

  const tabs: [Filter, string][] = [
    ['all', 'Tất cả'],
    ['active', 'Đang phục vụ'],
    ['paid', 'Đã hoàn tất'],
  ];

  return (
    <Shell title="Lịch sử đơn hàng" nav="orders">
      <PageTitle to={`/s/${storeSlug}/profile${q}`}>Lịch sử đơn hàng</PageTitle>
      <p className="muted small">Những bữa ngon trong các lần bạn ghé quán.</p>

      <div className="switch-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyBody icon="receipt" title="Chưa có đơn hàng" text="Đơn bạn gửi tại quán sẽ xuất hiện tại đây.">
          <Link className="btn" to={menuHref}>
            Xem thực đơn
          </Link>
        </EmptyBody>
      ) : (
        list.map(({ session, order }) => {
          const paid = order?.status === 'COMPLETED';
          const label = !order ? 'Không tải được' : paid ? 'Hoàn tất' : isActive({ session, order }) ? 'Đang phục vụ' : 'Đã đóng';
          const pill = paid ? 'green' : order && isActive({ session, order }) ? 'amber' : '';
          const itemCount = order?.items.reduce((s, it) => s + it.quantity, 0);
          return (
            <Link
              key={session.orderId}
              className="card history-card"
              style={{ display: 'block' }}
              to={`/s/${storeSlug}/order/${session.orderId}?t=${encodeURIComponent(session.tableCode)}`}
            >
              <div className="row">
                <Img
                  src={orderThumb(session.orderId, brand)}
                  alt=""
                  fallbackChar={(session.storeName || brand?.name || 'Q').charAt(0).toUpperCase()}
                  fallbackClassName="food-img"
                />
                <div className="grow">
                  <h3>Đơn #{session.orderNumber}</h3>
                  <span className="tiny muted">
                    {fmtDate(session.createdAt)} · {session.tableCode}
                  </span>
                </div>
                <span className={`pill ${pill}`}>{label}</span>
              </div>
              <div className="row between">
                <span className="small muted">{itemCount != null ? `${itemCount} món` : ''}</span>
                <span className="price small">{fmtMoney(order?.totalAmount ?? session.totalAmount)}</span>
              </div>
            </Link>
          );
        })
      )}
      <p className="tiny muted center">Lịch sử được lưu trên thiết bị này.</p>
    </Shell>
  );
}
