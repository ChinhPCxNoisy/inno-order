import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import Shell, { Loading, PageTitle, PoweredBy, useTable } from '../components/Shell';
import ErrorState, { EmptyBody } from '../components/StateView';
import { publicApi } from '../api';
import { fmtDate, fmtMoney, fmtTime, orderBreakdown } from '../format';
import { useBrand } from '../useBrand';
import { FINAL_STATUSES, useOrder } from '../useOrder';
import { getOrders, noteMoveFromOrder } from '../session';
import { syncStoreSession } from '../useStoreSession';
import type { PublicOrderTracking, ReviewStatus } from '../types';

const STAGES = ['Đã gửi đơn', 'Quán đã nhận', 'Đang chế biến', 'Sẵn sàng'];

/** Buoc hien tai tren timeline theo trang thai don (0 = vua gui, cho quan xac nhan) */
const STEP: Record<string, number> = { PENDING: 0, ACCEPTED: 1, PREPARING: 2, READY: 3 };

const HEADLINE: Record<string, { icon: IconName; green?: boolean; title: string; text: string }> = {
  PENDING: {
    icon: 'receipt',
    green: true,
    title: 'Đang chờ quán xác nhận',
    text: 'Đơn đã được gửi. Quán sẽ xác nhận khi tiếp nhận.',
  },
  ACCEPTED: { icon: 'pot', title: 'Quán đã nhận đơn', text: 'Bếp sẽ bắt đầu chuẩn bị món của bạn.' },
  PREPARING: { icon: 'pot', title: 'Bếp đang chuẩn bị món', text: 'Món sẽ được phục vụ khi sẵn sàng.' },
  READY: { icon: 'check', green: true, title: 'Món đã sẵn sàng', text: 'Mời bạn chờ nhân viên mang món ra bàn.' },
};

const STAGE_NOTE = [
  '',
  'Quán đã tiếp nhận đơn của bạn.',
  'Quán đang chuẩn bị các món của bạn.',
  'Món sẽ được phục vụ tại bàn.',
];

function Receipt({ order }: { order: PublicOrderTracking }) {
  return (
    <>
      {order.items.map((it, i) => {
        const cancelled = it.status === 'CANCELLED';
        // options co the chua co neu API cu chua tra
        const optionText = (it.options ?? []).map((o) => `${o.group}: ${o.value}`).join(' · ');
        return (
          <div className={`receipt-row${cancelled ? ' cancelled' : ''}`} key={i}>
            <span className="grow">
              <span className="item-name">
                {it.quantity} × {it.name}
              </span>
              {cancelled && <span className="pill amber cancel-tag">Đã hủy</span>}
              {optionText && (
                <small className="muted" style={{ display: 'block' }}>
                  {optionText}
                </small>
              )}
              {it.note && (
                <small className="muted" style={{ display: 'block' }}>
                  Ghi chú: {it.note}
                </small>
              )}
            </span>
            <strong className="item-total">{fmtMoney(it.totalAmount)}</strong>
          </div>
        );
      })}
    </>
  );
}

/** Theo doi don (thiet ke v2, man 06) va Chi tiet don hoan tat (man 07) — chon theo trang thai don. */
export default function Tracking() {
  const { storeSlug, orderId } = useParams<{ storeSlug: string; orderId: string }>();
  const { q } = useTable();
  const brand = useBrand(storeSlug);
  const { order, error, notFound, reload } = useOrder(orderId);
  const [review, setReview] = useState<ReviewStatus | null>(null);

  const completed = order?.status === 'COMPLETED';
  useEffect(() => {
    if (!orderId || !completed) return;
    let cancelled = false;
    publicApi
      .getReviewStatus(orderId)
      .then((s) => {
        if (!cancelled) setReview(s);
      })
      .catch(() => {
        // Loi mang: khong hien nut danh gia, khong lam phien khach
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, completed]);

  // Quan vua doi ban cho khach: ghi nho ban moi + hien dai thong bao (don con dang theo doi)
  const movedCode = order?.tableMovedFrom?.code;
  const movedAt = order?.tableMovedFrom?.at;
  const tableNow = order?.table.code;
  const orderFinal = order ? FINAL_STATUSES.includes(order.status) : false;
  useEffect(() => {
    if (!storeSlug || !movedCode || !tableNow || orderFinal) return;
    noteMoveFromOrder(storeSlug, movedCode, tableNow, movedAt);
  }, [storeSlug, movedCode, movedAt, tableNow, orderFinal]);

  // Don da thanh toan: phien ban dong -> dong bo de go token (khach goi lai thi mo phien moi)
  useEffect(() => {
    if (storeSlug && completed) void syncStoreSession(storeSlug, true);
  }, [storeSlug, completed]);

  const declaredCode = getOrders().find((o) => o.orderId === orderId)?.voucherCode;
  const menuHref = `/s/${storeSlug}${q}`;
  const billHref = `/s/${storeSlug}/bill${q}${q ? '&' : '?'}o=${orderId}`;

  if (notFound) {
    return (
      <Shell title="Theo dõi đơn" nav="orders">
        <PageTitle to={menuHref}>Theo dõi đơn</PageTitle>
        <EmptyBody
          icon="receipt"
          title="Không tìm thấy đơn"
          text="Đơn này không tồn tại hoặc đường dẫn không đúng. Bạn có thể xem lại lịch sử đơn hoặc quay về thực đơn."
        >
          <div className="error-actions">
            <Link className="btn" to={`/s/${storeSlug}/orders${q}`}>
              Lịch sử đơn hàng
            </Link>
            <Link className="btn secondary" to={menuHref}>
              Về thực đơn
            </Link>
          </div>
        </EmptyBody>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell nav="orders">
        <ErrorState kind="network" onRetry={reload} />
      </Shell>
    );
  }
  if (!order) {
    return (
      <Shell title="Theo dõi đơn" nav="orders">
        <Loading text="Đang tải đơn…" />
      </Shell>
    );
  }

  const itemCount = order.items.filter((it) => it.status !== 'CANCELLED').reduce((s, it) => s + it.quantity, 0);
  const { subtotal, tax } = orderBreakdown(order);

  if (completed) {
    const canReview = Boolean(review?.enabled && !review.reviewed && review.eligible);
    return (
      <Shell title="Đơn hoàn tất" nav="orders">
        <PageTitle to={`/s/${storeSlug}/orders${q}`}>Chi tiết đơn</PageTitle>
        <div className="row between mb16">
          <span className="small muted">
            Đơn #{order.orderNumber} · Bàn {order.table.code}
          </span>
          <span className="pill green">
            <Icon name="check" size="sm" /> Đã thanh toán
          </span>
        </div>

        <div className="card status-card">
          <div className="big-status">
            <Icon name="receipt" />
          </div>
          <h2>
            Cảm ơn bạn
            <br />
            đã dùng bữa!
          </h2>
          <p className="muted small mb0">{brand?.paymentNote ?? `Hẹn gặp lại bạn tại ${order.storeName}.`}</p>
        </div>

        <div className="card">
          <div className="row between mb16">
            <h3>Các món đã dùng</h3>
            <span className="tiny muted">{fmtDate(order.createdAt)}</span>
          </div>
          <Receipt order={order} />
          {order.customerNote && <p className="small muted mt16 mb0">Ghi chú đơn của bạn: {order.customerNote}</p>}
          {declaredCode && <p className="small muted mt16 mb0">Mã ưu đãi đã khai báo: <strong>{declaredCode}</strong>. Nhân viên sẽ áp dụng khi thanh toán; số tiền cuối có thể thấp hơn tổng cộng.</p>}
          {tax > 0 && (
            <div className="row between mt16 small muted">
              <span>Tạm tính {fmtMoney(subtotal)} + thuế VAT {fmtMoney(tax)}</span>
            </div>
          )}
          <div className="row between mt16">
            <strong>Tổng thanh toán</strong>
            <span className="price">{fmtMoney(order.totalAmount)}</span>
          </div>
          <p className="tiny mt16 mb0" style={{ color: 'var(--green)' }}>
            <Icon name="check" size="sm" /> Thanh toán đã được quán xác nhận.
          </p>
        </div>

        <div className="card flush">
          <Link className="line-action" to={billHref}>
            <Icon name="wallet" />
            <strong className="small grow">Xem hóa đơn của bàn</strong>
            <Icon name="next" />
          </Link>
        </div>

        {review?.reviewed && (
          <div className="card center">
            <p className="small muted mb0">Bạn đã đánh giá đơn này</p>
            <div style={{ fontSize: 25, color: '#f0ab32' }}>
              {'★'.repeat(review.rating ?? 0)}
              {'☆'.repeat(5 - (review.rating ?? 0))}
            </div>
            {review.comment && <p className="small muted mb0">“{review.comment}”</p>}
          </div>
        )}

        {canReview && (
          <Link className="btn" to={`/s/${storeSlug}/order/${orderId}/review${q}`}>
            <Icon name="star" /> Đánh giá phục vụ
          </Link>
        )}
        <div className="mt8">
          <Link className="btn secondary" to={menuHref}>
            Về thực đơn
          </Link>
        </div>
        {canReview && <p className="micro-foot">Chia sẻ trải nghiệm để quán phục vụ bạn tốt hơn.</p>}
        <PoweredBy />
      </Shell>
    );
  }

  const cancelled = order.status === 'CANCELLED';
  const refunded = order.status === 'REFUNDED' || order.status === 'PARTIAL_REFUND';
  const final = cancelled || refunded;
  const step = STEP[order.status] ?? 0;
  const head = HEADLINE[order.status];

  return (
    <Shell title="Theo dõi đơn" nav="orders">
      <PageTitle to={menuHref}>Đơn của bạn</PageTitle>

      <div className="card">
        <div className="center">
          <div className={`big-status${final || (head && !head.green) ? ' red' : ''}`}>
            <Icon name={final ? 'alert' : (head?.icon ?? 'receipt')} />
          </div>
          <span className="pill">
            Bàn {order.table.code} · Đơn #{order.orderNumber}
          </span>
          <h2 className="mt16">
            {cancelled
              ? 'Đơn đã bị hủy'
              : refunded
                ? order.status === 'REFUNDED'
                  ? 'Đơn đã hoàn tiền'
                  : 'Đơn đã hoàn tiền một phần'
                : (head?.title ?? 'Đơn của bạn')}
          </h2>
          <p className="muted small">
            {final ? 'Vui lòng liên hệ nhân viên nếu bạn cần hỗ trợ.' : (head?.text ?? '')}
          </p>
        </div>

        {!final && (
          <>
            <div className="divider" />
            <div className="timeline">
              {STAGES.map((name, i) => (
                <div key={name} className={`stage ${i < step ? 'done' : i === step ? 'current' : ''}`}>
                  <span className="stage-dot">{i < step && <Icon name="check" size="sm" />}</span>
                  <div>
                    <strong className={`small ${i > step ? 'muted' : ''}`}>{name}</strong>
                    <small>
                      {i === 0
                        ? fmtTime(order.createdAt)
                        : i === step
                          ? STAGE_NOTE[i]
                          : i === 3
                            ? STAGE_NOTE[3]
                            : ''}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h3>Chi tiết món</h3>
          <span className="tiny muted">{itemCount} món</span>
        </div>
        <Receipt order={order} />
        {order.customerNote && <p className="small muted mt16 mb0">Ghi chú đơn của bạn: {order.customerNote}</p>}
        {declaredCode && <p className="small muted mt16 mb0">Mã ưu đãi đã khai báo: <strong>{declaredCode}</strong>. Nhân viên sẽ áp dụng khi thanh toán; số tiền cuối có thể thấp hơn tổng cộng.</p>}
        {tax > 0 && (
          <div className="row between mt16 small muted">
            <span>Tạm tính {fmtMoney(subtotal)} + thuế VAT {fmtMoney(tax)}</span>
          </div>
        )}
        <div className="row between mt16">
          <strong>Tổng cộng</strong>
          <span className="price">{fmtMoney(order.totalAmount)}</span>
        </div>
      </div>

      <div className="card flush">
        <Link className="line-action" to={billHref}>
          <Icon name="wallet" />
          <strong className="small grow">Xem hóa đơn của bàn</strong>
          <Icon name="next" />
        </Link>
      </div>

      {!final && (
        <Link className="btn" to={menuHref}>
          <Icon name="plus" /> Gọi thêm món
        </Link>
      )}
      <div className="row between mt8">
        <Link className="text-btn" to={`/s/${storeSlug}/support${q}`}>
          <Icon name="bell" size="sm" /> Cần hỗ trợ?
        </Link>
        <Link className="text-btn" to={`/s/${storeSlug}/orders${q}`}>
          Lịch sử đơn hàng
        </Link>
      </div>
    </Shell>
  );
}
