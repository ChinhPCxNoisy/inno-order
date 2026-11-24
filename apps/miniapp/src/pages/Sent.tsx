import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Shell, { Loading, PageTitle, useTable } from '../components/Shell';
import { fmtMoney, fmtTime, orderBreakdown } from '../format';
import { useOrder } from '../useOrder';
import { getOrders } from '../session';
import ErrorState, { EmptyBody } from '../components/StateView';

/** Gui don thanh cong (thiet ke v2, man 05). */
export default function Sent() {
  const { storeSlug, orderId } = useParams<{ storeSlug: string; orderId: string }>();
  const { q } = useTable();
  const { order, error, notFound, reload } = useOrder(orderId, false);
  const menuHref = `/s/${storeSlug}${q}`;

  if (notFound) {
    return (
      <Shell title="Gửi đơn thành công">
        <EmptyBody icon="receipt" title="Không tìm thấy đơn" text="Đơn này không tồn tại hoặc đường dẫn không đúng.">
          <Link className="btn" to={menuHref}>
            Về thực đơn
          </Link>
        </EmptyBody>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <ErrorState kind="network" onRetry={reload} />
      </Shell>
    );
  }
  if (!order) {
    return (
      <Shell title="Gửi đơn thành công">
        <Loading />
      </Shell>
    );
  }

  const itemCount = order.items.reduce((s, it) => s + it.quantity, 0);
  const { subtotal, tax } = orderBreakdown(order);

  return (
    <Shell title="Gửi đơn thành công">
      <PageTitle to={menuHref}>Đã gửi đơn</PageTitle>

      <div className="card status-card">
        <div className="big-status">
          <Icon name="check" />
        </div>
        <h1>
          Đã gửi đơn
          <br />
          đến quán!
        </h1>
        <p className="muted">Quán sẽ kiểm tra và xác nhận đơn của bạn.</p>
        <span className="pill amber">
          <Icon name="clock" size="sm" /> Chờ quán xác nhận
        </span>
      </div>

      <div className="card">
        <strong>
          <Icon name="receipt" size="sm" /> &nbsp; Đơn #{order.orderNumber}
        </strong>
        <dl className="info-list">
          <div>
            <dt>
              <Icon name="table" size="sm" /> Bàn
            </dt>
            <dd>{order.table.code}</dd>
          </div>
          <div>
            <dt>
              <Icon name="menu" size="sm" /> Số món
            </dt>
            <dd>{itemCount} món</dd>
          </div>
          {tax > 0 && (
            <>
              <div>
                <dt>Tạm tính</dt>
                <dd>{fmtMoney(subtotal)}</dd>
              </div>
              <div>
                <dt>Thuế VAT</dt>
                <dd>{fmtMoney(tax)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Tổng cộng</dt>
            <dd className="price">{fmtMoney(order.totalAmount)}</dd>
          </div>
          <div>
            <dt>
              <Icon name="clock" size="sm" /> Gửi lúc
            </dt>
            <dd>{fmtTime(order.createdAt)}</dd>
          </div>
        </dl>
      </div>

      {getOrders().find((o) => o.orderId === orderId)?.voucherCode && (
        <p className="small muted">
          Ưu đãi sẽ được nhân viên áp dụng khi thanh toán; số tiền cuối có thể thấp hơn tổng cộng ở trên.
        </p>
      )}
      <Link className="btn" to={`/s/${storeSlug}/order/${orderId}${q}`}>
        Theo dõi đơn <Icon name="next" size="sm" />
      </Link>
      <div className="mt8">
        <Link className="btn secondary" to={menuHref}>
          <Icon name="plus" /> Gọi thêm món
        </Link>
      </div>
      <p className="micro-foot">
        Món gọi thêm sẽ được gửi thành đợt riêng.
        <br />
        Các món đã gửi không nằm trong giỏ mới.
      </p>
    </Shell>
  );
}
