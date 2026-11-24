import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { fmtDate, fmtDateTime, fmtMoney, localDateStr, methodRows } from '../format';
import { PAY_METHOD, TABLE_STATUS } from '../labels';
import type { DailyReport, ItemReport, PaymentReport, Review, StaffReport } from '../types';
import { useFetch } from '../useFetch';
import type { OfferReport, Reconciliation } from '../types';
import { Badge, Empty, Field, Loading } from '../ui';

type Tab = 'daily' | 'items' | 'payments' | 'staff' | 'offers';

export default function Reports() {
  const { activeStore } = useApp();
  const [tab, setTab] = useState<Tab>('daily');
  const [date, setDate] = useState(localDateStr());
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return localDateStr(d);
  });
  const [to, setTo] = useState(localDateStr());

  const daily = useFetch<DailyReport | null>(
    () => (tab === 'daily' ? api(`/stores/${activeStore!.id}/reports/daily?date=${date}`) : Promise.resolve(null)),
    [activeStore?.id, tab, date],
  );
  const items = useFetch<ItemReport[] | null>(
    () => (tab === 'items' ? api(`/stores/${activeStore!.id}/reports/items?from=${from}&to=${to}`) : Promise.resolve(null)),
    [activeStore?.id, tab, from, to],
  );
  const payments = useFetch<PaymentReport | null>(
    () => (tab === 'payments' ? api(`/stores/${activeStore!.id}/reports/payments?from=${from}&to=${to}`) : Promise.resolve(null)),
    [activeStore?.id, tab, from, to],
  );
  const staffReport = useFetch<StaffReport | null>(
    () => (tab === 'staff' ? api(`/stores/${activeStore!.id}/reports/staff?from=${from}&to=${to}`) : Promise.resolve(null)),
    [activeStore?.id, tab, from, to],
  );
  const reviews = useFetch<Review[] | null>(
    () => (tab === 'staff' ? api(`/stores/${activeStore!.id}/reviews?from=${from}&to=${to}`) : Promise.resolve(null)),
    [activeStore?.id, tab, from, to],
  );

  // so lieu thanh toan QR trong ngay (doi soat); loi/khong co quyen thi bo qua, khong anh huong bao cao chinh
  const recon = useFetch<Reconciliation | null>(
    () => (tab === 'daily' ? api<Reconciliation>(`/stores/${activeStore!.id}/reconciliation?date=${date}`).catch(() => null) : Promise.resolve(null)),
    [activeStore?.id, tab, date],
  );

  const offers = useFetch<OfferReport | null>(
    () => (tab === 'offers' ? api(`/stores/${activeStore!.id}/reports/offers?from=${from}&to=${to}`) : Promise.resolve(null)),
    [activeStore?.id, tab, from, to],
  );

  const loading = offers.loading || daily.loading || items.loading || payments.loading || staffReport.loading || reviews.loading;
  const error = offers.error || daily.error || items.error || payments.error || staffReport.error || reviews.error;
  const pay = payments.data;
  const d = daily.data;
  const sr = staffReport.data;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Báo cáo kinh doanh</h1>
          <p>Doanh thu, món bán chạy và cấu trúc thanh toán theo ngày.</p>
        </div>
      </header>
      <div className="filters">
        <div className="tabs">
          {(
            [
              ['daily', 'Báo cáo ngày'],
              ['items', 'Món bán chạy'],
              ['payments', 'Doanh thu theo phương thức'],
              ['staff', 'Theo nhân viên'],
              ['offers', 'Ưu đãi'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'daily' ? (
          <Field label="Ngày">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="Từ">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Đến">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
      </div>

      {loading && <Loading />}
      {error && <div className="alert-strip">{error}</div>}

      {!loading && !error && tab === 'daily' && d && (
        <>
          <div className="stat-grid">
            <section className="stat featured">
              <div className="stat-top">
                <span>Doanh thu ròng</span>
                <i>đ</i>
              </div>
              <div className="stat-value">{fmtMoney(d.revenue)}</div>
              <div className="stat-bottom">{d.orders.completed} đơn đã thanh toán</div>
            </section>
            <section className="stat">
              <div className="stat-top">
                <span>Doanh thu gộp</span>
                <i>đ</i>
              </div>
              <div className="stat-value">{fmtMoney(d.grossRevenue)}</div>
              <div className="stat-bottom">Trước khi trừ hoàn tiền</div>
            </section>
            <section className="stat">
              <div className="stat-top">
                <span>Hoàn tiền</span>
                <i>đ</i>
              </div>
              <div className="stat-value">{fmtMoney(d.refundAmount)}</div>
              <div className="stat-bottom">{d.orders.refunded} lượt hoàn tiền</div>
            </section>
            <section className="stat">
              <div className="stat-top">
                <span>Đơn hôm nay</span>
                <i>đơn</i>
              </div>
              <div className="stat-value">{d.orders.created}</div>
              <div className="stat-bottom">
                {d.orders.completed} TT · {d.orders.cancelled} huỷ · {d.orders.refunded} lượt hoàn
              </div>
            </section>
          </div>
          {recon.data && (recon.data.qrPaymentTotal > 0 || recon.data.qrRefundTotal > 0 || recon.data.bankInCount > 0) && (
            <section className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <h2>Thanh toán QR (VietQR)</h2>
                <span className="small muted">Một phần của “QR banking” ở bảng bên dưới</span>
              </div>
              <div className="chip-row">
                <Badge cls="green">Thu QR: {fmtMoney(recon.data.qrPaymentTotal)}</Badge>
                <Badge cls="blue">Tự động (tiền về): {fmtMoney(recon.data.qrAutoConfirmTotal)}</Badge>
                <Badge cls="amber">Thu ngân xác nhận tay: {fmtMoney(recon.data.qrManualConfirmTotal)}</Badge>
                <Badge cls="red">Hoàn QR: {fmtMoney(recon.data.qrRefundTotal)}</Badge>
                <Badge cls={recon.data.balanced ? 'green' : 'red'}>{recon.data.balanced ? 'Đối soát cân' : `Lệch: ${recon.data.unresolvedCount} giao dịch chưa xử lý`}</Badge>
              </div>
            </section>
          )}
          <div className="two-col">
            <section className="panel">
              <div className="panel-head">
                <h2>Theo phương thức thanh toán</h2>
              </div>
              {d.byMethod.length === 0 && (d.refundByMethod ?? []).length === 0 ? (
                <Empty title="Chưa có thanh toán" />
              ) : (
                <div className="metric-list">
                  {methodRows(d.byMethod, d.refundByMethod).map((m) => (
                    <div key={m.method}>
                      <div className="metric-row">
                        <span>
                          {PAY_METHOD[m.method] ?? m.method}{' '}
                          <small>
                            · thu {fmtMoney(m.gross)} ({m.count} lần)
                            {m.refund > 0 ? ` · hoàn ${fmtMoney(m.refund)} (${m.refundCount} lần)` : ''}
                          </small>
                        </span>
                        <b>{fmtMoney(m.net)}</b>
                      </div>
                    </div>
                  ))}
                  <div className="metric-row" style={{ borderTop: '1px dashed #e5eaf0', paddingTop: 10 }}>
                    <span>
                      Tổng thực thu <small>(đã trừ hoàn tiền)</small>
                    </span>
                    <b>{fmtMoney(methodRows(d.byMethod, d.refundByMethod).reduce((s, m) => s + m.net, 0))}</b>
                  </div>
                </div>
              )}
              <div className="panel-head" style={{ marginTop: 18 }}>
                <h2>Trạng thái bàn (hiện tại)</h2>
              </div>
              <div className="chip-row">
                {Object.entries(TABLE_STATUS).map(([k, v]) => (
                  <Badge key={k} cls={v.cls}>
                    {v.label}: {d.tableStatus[k] ?? 0}
                  </Badge>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Top 10 món bán chạy</h2>
              </div>
              {d.topItems.length === 0 ? (
                <Empty title="Chưa có đơn trong ngày" />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Món</th>
                        <th className="num">SL</th>
                        <th className="num">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topItems.map((it, i) => (
                        <tr key={it.menuItemId}>
                          <td className="muted">{i + 1}</td>
                          <td>
                            <strong>{it.name}</strong>
                          </td>
                          <td className="num">{it.quantity}</td>
                          <td className="num">
                            <strong>{fmtMoney(it.revenue)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {!loading && !error && tab === 'items' && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              Món bán chạy từ {fmtDate(from)} đến {fmtDate(to)}
            </h2>
          </div>
          {(items.data ?? []).length === 0 ? (
            <Empty title="Không có dữ liệu trong khoảng thời gian" />
          ) : (
            <div className="metric-list">
              {(items.data ?? []).map((it, i) => (
                <div key={it.menuItemId}>
                  <div className="metric-row">
                    <span>
                      {i + 1}. {it.name} <small>· {it.quantity} phần</small>
                    </span>
                    <b>{fmtMoney(it.revenue)}</b>
                  </div>
                  <div className="mini-bar">
                    <span style={{ width: `${(it.quantity / Math.max(1, (items.data ?? [])[0].quantity)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'offers' && offers.data && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              Ưu đãi từ {fmtDate(from)} đến {fmtDate(to)}
            </h2>
            <span className="small muted">
              {offers.data.totalConsumed} lượt dùng · giảm {fmtMoney(offers.data.totalDiscount)} (đã nằm trong doanh thu thực thu, không trừ thêm)
            </span>
          </div>
          {offers.data.byOffer.length === 0 ? (
            <Empty title="Chưa có ưu đãi nào được dùng trong khoảng thời gian" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ưu đãi</th>
                    <th className="num">Lượt dùng (hóa đơn đã đóng)</th>
                    <th className="num">Tổng giảm</th>
                    <th className="num">Đang giữ</th>
                    <th className="num">Đã trả lượt</th>
                    <th className="num">Tổng đã dùng / giới hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.data.byOffer.map((o) => (
                    <tr key={o.offerId}>
                      <td>
                        <strong>{o.code}</strong>
                        <small>
                          {o.headline}
                          {o.active ? '' : ' · đang tắt'}
                        </small>
                      </td>
                      <td className="num">{o.consumedCount}</td>
                      <td className="num">
                        <strong>{fmtMoney(o.totalDiscount)}</strong>
                      </td>
                      <td className="num">{o.reservedCount}</td>
                      <td className="num">{o.releasedCount}</td>
                      <td className="num">
                        {o.usedCount}
                        {o.totalLimit ? ` / ${o.totalLimit}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'payments' && pay && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              Doanh thu từ {fmtDate(from)} đến {fmtDate(to)}
            </h2>
            <span className="small muted">Thực thu (đã trừ hoàn tiền): {fmtMoney(pay.total)}</span>
          </div>
          {Object.keys(pay.byMethod).length > 0 && (
            <div className="chip-row" style={{ marginBottom: 16 }}>
              {Object.entries(pay.byMethod).map(([m, v]) => (
                <Badge key={m} cls="blue">
                  {PAY_METHOD[m] ?? m}: {fmtMoney(v)}
                </Badge>
              ))}
            </div>
          )}
          {pay.byDay.length === 0 ? (
            <Empty title="Không có thanh toán trong khoảng thời gian" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th className="num">Tổng</th>
                    {Object.keys(pay.byMethod).map((m) => (
                      <th key={m} className="num">
                        {PAY_METHOD[m] ?? m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pay.byDay.map((dd) => (
                    <tr key={dd.date}>
                      <td>
                        <strong>{fmtDate(dd.date)}</strong>
                      </td>
                      <td className="num">
                        <strong>{fmtMoney(dd.total)}</strong>
                      </td>
                      {Object.keys(pay.byMethod).map((m) => (
                        <td key={m} className="num">
                          {dd.byMethod[m] ? fmtMoney(dd.byMethod[m]) : <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && !error && tab === 'staff' && sr && (
        <>
          <section className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <h2>
                Hiệu suất nhân viên từ {fmtDate(from)} đến {fmtDate(to)}
              </h2>
              <span className="small muted">Số món/bàn đã phục vụ — dùng để xét thưởng</span>
            </div>
            {sr.staff.length === 0 ? (
              <Empty title="Chưa có dữ liệu" sub="Chưa ai bấm “Đã mang ra bàn” trong khoảng thời gian này." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th className="num">Món đã phục vụ</th>
                      <th className="num">Bàn đã phục vụ</th>
                      <th className="num">Rating trung bình</th>
                      <th className="num">Lượt đánh giá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sr.staff.map((s) => (
                      <tr key={s.userId}>
                        <td>
                          <strong>{s.name}</strong>
                        </td>
                        <td className="num">{s.servedItems}</td>
                        <td className="num">{s.servedTables}</td>
                        <td className="num">
                          {s.avgRating !== null ? (
                            <Badge cls={s.avgRating >= 4 ? 'green' : s.avgRating >= 3 ? 'amber' : 'red'}>
                              ★ {s.avgRating}
                            </Badge>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="num">{s.reviewCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Đánh giá gần đây</h2>
              <span className="small muted">{(reviews.data ?? []).length} lượt</span>
            </div>
            {(reviews.data ?? []).length === 0 ? (
              <Empty title="Chưa có đánh giá nào" sub="Cần bật module Đánh giá nhân viên ở trang Quán trên nền tảng." />
            ) : (
              <div className="stack">
                {(reviews.data ?? []).map((r) => (
                  <div key={r.id} className="task-row">
                    <div>
                      <strong>
                        {'★'.repeat(r.rating)}
                        {'☆'.repeat(5 - r.rating)} {r.staffName ?? 'Chưa rõ nhân viên'}
                        {r.suspicious && (
                          <span style={{ marginLeft: 8 }}>
                            <Badge cls="red">⚠ Nghi vấn</Badge>
                          </span>
                        )}
                      </strong>
                      <small>
                        Đơn #{r.orderNumber} · {fmtDateTime(r.createdAt)}
                        {r.zaloVerified ? ' · Đã xác thực Zalo' : ''}
                        {r.tags.length > 0 ? ` · ${r.tags.join(', ')}` : ''}
                        {r.comment ? ` · “${r.comment}”` : ''}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
