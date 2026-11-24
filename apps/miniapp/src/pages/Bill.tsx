import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Shell, { Loading, PageTitle, PoweredBy, useTable } from '../components/Shell';
import { EmptyBody } from '../components/StateView';
import { useUi } from '../components/ui';
import { errMsg, publicApi } from '../api';
import { fmtMoney, fmtTime } from '../format';
import QrPay from '../components/QrPay';
import { getOrders, getStoreSession } from '../session';
import { useBill } from '../useBill';
import { useBrand } from '../useBrand';
import type { PublicBill } from '../types';

/** Nhan + mau pill theo trang thai hoa don/phien */
function billState(b: PublicBill): { label: string; pill: 'green' | 'amber' | ''; paid: boolean; open: boolean } {
  const st = b.summary.billStatus;
  if (b.status === 'CANCELLED' || st === 'VOID') return { label: 'Đã hủy', pill: 'amber', paid: false, open: false };
  if (st === 'REFUNDED') return { label: 'Đã hoàn tiền', pill: '', paid: false, open: false };
  if (st === 'PAID' || b.status === 'CLOSED') return { label: 'Đã thanh toán', pill: 'green', paid: true, open: false };
  if (st === 'PARTIALLY_PAID') return { label: 'Đã thanh toán một phần', pill: 'amber', paid: false, open: true };
  return { label: 'Chưa thanh toán', pill: 'amber', paid: false, open: true };
}

/**
 * Hoa don cua ban (chi doc): cac dot goi, tam tinh, giam gia, tong, da tra, con lai.
 * Man nay CHUA co trong bo thiet ke v2: dung lai card, receipt-row, pill, big-status, page-title.
 */
export default function Bill() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const [params] = useSearchParams();
  const orderId = params.get('o');
  const { table, q } = useTable();
  const brand = useBrand(storeSlug);
  const { message } = useUi();
  const { bill, error, noSource, viaToken, reload } = useBill(storeSlug, orderId, table);
  const [calling, setCalling] = useState(false);

  const menuHref = `/s/${storeSlug}${q}`;
  const backHref = orderId ? `/s/${storeSlug}/order/${orderId}${q}` : menuHref;

  if (error && !bill) {
    return (
      <Shell title="Hóa đơn của bàn" nav="orders">
        <PageTitle to={backHref}>Hóa đơn của bàn</PageTitle>
        <EmptyBody icon="receipt" title="Chưa xem được hóa đơn" text={error}>
          <div className="error-actions">
            <button className="btn" onClick={reload}>
              Thử lại
            </button>
            <Link className="btn secondary" to={backHref}>
              Quay lại
            </Link>
          </div>
        </EmptyBody>
      </Shell>
    );
  }
  if (noSource && !bill) {
    return (
      <Shell title="Hóa đơn của bàn" nav="orders">
        <PageTitle to={backHref}>Hóa đơn của bàn</PageTitle>
        <EmptyBody
          icon="receipt"
          title="Chưa có hóa đơn"
          text="Hóa đơn của bàn sẽ hiện ở đây sau khi bạn gửi đơn gọi món đầu tiên."
        >
          <Link className="btn" to={menuHref}>
            Xem thực đơn
          </Link>
        </EmptyBody>
      </Shell>
    );
  }
  if (!bill) {
    return (
      <Shell title="Hóa đơn của bàn" nav="orders">
        <PageTitle to={backHref}>Hóa đơn của bàn</PageTitle>
        <Loading text="Đang tải hóa đơn…" />
      </Shell>
    );
  }

  const st = billState(bill);
  const s = bill.summary;
  const rounds = bill.orders.filter((o) => o.items.length > 0);
  const codes = bill.tables.length > 0 ? bill.tables.map((t) => t.code) : [bill.table.code];
  const itemCount = rounds.reduce((n, o) => n + o.items.reduce((m, it) => m + it.quantity, 0), 0);

  // Ma uu dai khach da khai bao tren thiet bi cho cac don cua hoa don nay (chi la khai bao)
  const orderIds = new Set(bill.orders.map((o) => o.id));
  const discountLines = bill.discounts ?? [];
  const appliedCodes = new Set(discountLines.map((d) => d.code).filter(Boolean));
  // chi hien nhac "nhan vien se ap dung" cho ma chua duoc ap vao hoa don
  const declared = Array.from(
    new Set(getOrders().filter((o) => orderIds.has(o.orderId) && o.voucherCode).map((o) => o.voucherCode as string)),
  ).filter((c) => !appliedCodes.has(c));
  // Khach tu tra QR: chi khi API bao quan bat, hoa don con no va co token phien cua thiet bi
  const qrToken = getStoreSession(storeSlug)?.token;
  const canQr = bill.customerCanPayQr === true && st.open && s.remaining > 0 && viaToken && Boolean(qrToken);

  const callBill = async () => {
    if (!storeSlug || calling) return;
    const code = table ?? bill.table.code;
    setCalling(true);
    try {
      await publicApi.callStaff(storeSlug, code, { reason: 'BILL' });
      message('Đã gửi yêu cầu', `Nhân viên đã nhận yêu cầu tính tiền của bàn ${code} và sẽ đến ngay.`);
    } catch (e) {
      message('Chưa gửi được yêu cầu', `${errMsg(e)} Bạn có thể vẫy nhân viên để được hỗ trợ.`);
    } finally {
      setCalling(false);
    }
  };

  return (
    <Shell title="Hóa đơn của bàn" nav="orders">
      <PageTitle to={backHref}>Hóa đơn của bàn</PageTitle>

      <div className="row between mb16 bill-head">
        <span className="small muted">
          {bill.storeName} · Bàn {codes.join(' + ')}
          {bill.table.areaName && codes.length === 1 ? ` · ${bill.table.areaName}` : ''}
        </span>
        <span className={`pill ${st.pill}`}>
          {st.paid && <Icon name="check" size="sm" />} {st.label}
        </span>
      </div>

      {st.paid && (
        <div className="card status-card">
          <div className="big-status">
            <Icon name="receipt" />
          </div>
          <h2>Đã thanh toán</h2>
          <p className="muted small mb0">{brand?.paymentNote ?? `Cảm ơn bạn đã dùng bữa tại ${bill.storeName}.`}</p>
        </div>
      )}

      {rounds.length === 0 ? (
        <EmptyBody icon="receipt" title="Chưa có món nào" text="Các món bàn đã gọi sẽ hiện ở đây.">
          <Link className="btn" to={menuHref}>
            Xem thực đơn
          </Link>
        </EmptyBody>
      ) : (
        rounds.map((o) => (
          <div className="card" key={o.id}>
            <div className="row between mb16">
              <h3>Đợt {o.round}</h3>
              <span className="tiny muted">
                {fmtTime(o.createdAt)} · Đơn #{o.orderNumber}
              </span>
            </div>
            {o.items.map((it, i) => {
              const optionText = it.options.map((x) => `${x.group}: ${x.value}`).join(' · ');
              return (
                <div className="receipt-row" key={i}>
                  <span className="grow">
                    <span className="item-name">
                      {it.quantity} × {it.name}
                    </span>
                    {optionText && (
                      <small className="muted" style={{ display: 'block' }}>
                        {optionText}
                      </small>
                    )}
                  </span>
                  <strong className="item-total">{fmtMoney(it.totalAmount)}</strong>
                </div>
              );
            })}
          </div>
        ))
      )}

      {rounds.length > 0 && (
        <div className="card">
          <div className="row between mb16">
            <h3>Tổng kết</h3>
            <span className="tiny muted">
              {rounds.length} đợt · {itemCount} món
            </span>
          </div>
          <div className="bill-line">
            <span className="muted">Tạm tính</span>
            <span>{fmtMoney(s.subtotal)}</span>
          </div>
          {discountLines.length > 0
            ? discountLines.map((d, i) => (
                <div className="bill-line" key={i}>
                  <span className="muted">{d.label}</span>
                  <span className="discount">-{fmtMoney(d.amount)}</span>
                </div>
              ))
            : s.discountAmount > 0 && (
                <div className="bill-line">
                  <span className="muted">Giảm giá</span>
                  <span className="discount">-{fmtMoney(s.discountAmount)}</span>
                </div>
              )}
          {s.vatAmount > 0 && (
            <div className="bill-line">
              <span className="muted">Thuế VAT</span>
              <span>{fmtMoney(s.vatAmount)}</span>
            </div>
          )}
          <div className="divider" style={{ margin: '6px 0' }} />
          <div className="bill-line total">
            <span>Tổng cộng</span>
            <span className="price">{fmtMoney(s.totalAmount)}</span>
          </div>
          {s.paidAmount > 0 && (
            <div className="bill-line">
              <span className="muted">Đã thanh toán</span>
              <span>{fmtMoney(s.paidAmount)}</span>
            </div>
          )}
          {st.open && (
            <div className="bill-line">
              <span className="muted">Còn lại</span>
              <span className="remaining">{fmtMoney(s.remaining)}</span>
            </div>
          )}
          {declared.length > 0 && (
            <p className="tiny muted mt8 mb0">
              Mã ưu đãi đã khai báo: <strong>{declared.join(', ')}</strong>. Nhân viên sẽ áp dụng khi thanh toán.
            </p>
          )}
          {s.billStatus === null && st.open && (
            <p className="tiny muted mt8 mb0">Đây là số tạm tính theo các món đang gọi. Nhân viên sẽ chốt khi thanh toán.</p>
          )}
        </div>
      )}

      {st.open && (
        <>
          {canQr && qrToken && (
            <div className="mb16">
              <QrPay token={qrToken} onSettled={reload} />
            </div>
          )}
          <button className={`btn${canQr ? ' secondary' : ''}`} disabled={calling} onClick={callBill}>
            <Icon name="wallet" /> {calling ? 'Đang gửi…' : 'Yêu cầu tính tiền'}
          </button>
          <div className="mt8">
            <Link className="btn secondary" to={menuHref}>
              <Icon name="plus" /> Gọi thêm món
            </Link>
          </div>
          <p className="tiny muted center mt16">Hóa đơn này chỉ để xem. Thanh toán tại quầy, nhân viên sẽ hỗ trợ.</p>
        </>
      )}
      {!st.open && (
        <div className="mt8">
          <Link className="btn secondary" to={menuHref}>
            Về thực đơn
          </Link>
        </div>
      )}
      <PoweredBy />
    </Shell>
  );
}
