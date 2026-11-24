import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtDateTime, fmtMoney } from '../format';
import { BILL_STATUS, ITEM_STATUS, ORDER_SOURCE, ORDER_STATUS, PAY_METHOD, REFUND_REASONS } from '../labels';
import { billErrMsg } from '../errors';
import { useRealtimeRefresh } from '../realtime';
import type { Order, OrderListResult, SessionView } from '../types';
import { useFetch } from '../useFetch';
import { Badge, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

const FILTERS = [
  { label: 'Tất cả', value: '' },
  { label: 'Chờ xử lý', value: 'PENDING' },
  { label: 'Đã nhận', value: 'ACCEPTED' },
  { label: 'Đang chế biến', value: 'PREPARING' },
  { label: 'Sẵn sàng', value: 'READY' },
  { label: 'Đã thanh toán', value: 'COMPLETED' },
  { label: 'Đã huỷ', value: 'CANCELLED' },
  { label: 'Hoàn tiền', value: 'REFUNDED' },
];

function exportCsv(name: string, rows: (string | number)[][]) {
  const safe = (v: string | number) => {
    let x = String(v ?? '');
    if (/^[=+@\t\r]/.test(x)) x = `'${x}`;
    return `"${x.replace(/"/g, '""')}"`;
  };
  const csv = '\ufeff' + rows.map((r) => r.map(safe).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DetailModal({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const { activeStore, canWrite, me } = useApp();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<'order' | string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refundReason, setRefundReason] = useState('OTHER');
  const [err, setErr] = useState<string | null>(null);
  const [moved, setMoved] = useState<string[]>([]);

  const cancelOpen = cancelTarget !== null;

  const load = () =>
    api<Order>(`/stores/${activeStore!.id}/orders/${orderId}`)
      .then(async (o) => {
        setOrder(o);
        // dau vet doi ban: chi xem duoc khi phien con mo (lay tu hoa don ban cua ban hien tai)
        if (o.sessionId && o.tableId && ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) {
          try {
            const v = await api<SessionView>(`/stores/${activeStore!.id}/pos/tables/${o.tableId}/session`);
            setMoved(v.session?.id === o.sessionId ? v.tables.filter((x) => !x.active && x.role === 'MOVED_FROM').map((x) => x.code) : []);
          } catch {
            setMoved([]);
          }
        } else setMoved([]);
      })
      .catch((e) => toast(errMsg(e), 'err'));

  useFetch(() => load(), [orderId]);

  if (!order) return <Loading />;

  const doAction = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(okMsg);
      await load();
      onChanged();
    } catch (e) {
      setErr(billErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: string) =>
    doAction(
      () => api(`/stores/${activeStore!.id}/orders/${order.id}/status`, { method: 'PATCH', body: { status } }),
      `Đơn #${order.orderNumber} → ${ORDER_STATUS[status]?.label}`,
    );

  const doCancel = () =>
    doAction(
      () => api(`/stores/${activeStore!.id}/orders/${order.id}/cancel`, { method: 'POST', body: { reason } }),
      `Đã huỷ đơn #${order.orderNumber}`,
    );

  // don thuoc hoa don ban: hoan tien ca hoa don (API don le tra 409 cho don thuoc bill)
  const doRefund = () =>
    order.billId
      ? doAction(
          () => api(`/stores/${activeStore!.id}/pos/bills/${order.billId}/refund`, { method: 'POST', body: { reason: refundReason, note: reason || undefined } }),
          `Đã hoàn tiền cả hóa đơn ${order.bill?.billNo ?? ''}`,
        )
      : doAction(
          () => api(`/stores/${activeStore!.id}/orders/${order.id}/refund`, { method: 'POST', body: { reason: refundReason, note: reason || undefined } }),
          `Đã hoàn tiền đơn #${order.orderNumber}`,
        );

  const doReprint = async (kind: 'bill' | 'kitchen' | 'bar') => {
    const what = kind === 'bill' ? 'bill' : kind === 'bar' ? 'phiếu bar' : 'phiếu bếp';
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ jobId: string | null; status: string; failedReason: string | null }>(
        `/stores/${activeStore!.id}/orders/${order.id}/reprint`,
        { method: 'POST', body: { kind } },
      );
      if (r.status === 'FAILED') toast(`Chưa in lại được ${what}: ${r.failedReason ?? 'máy in lỗi'}`, 'err', { ttl: 9000 });
      else toast(`Đã gửi lệnh in lại ${what}, theo dõi ở Máy in & hàng đợi`);
    } catch (e) {
      setErr(billErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const doCancelItem = (itemId: string) =>
    doAction(
      () => api(`/stores/${activeStore!.id}/orders/${order.id}/items/${itemId}/cancel`, { method: 'POST', body: { reason: reason || 'Nhân viên huỷ món' } }),
      'Đã huỷ món',
    );

  const openStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'];
  const isCashier = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER'].includes(me?.role ?? '');

  return (
    <>
      <Modal
        title={`Đơn #${order.orderNumber}`}
        subtitle={`${order.table?.code ?? 'Không bàn'} · ${fmtDateTime(order.createdAt)} · ${ORDER_SOURCE[order.source] ?? order.source}`}
        onClose={onClose}
        width={680}
        footer={
          <div className="actions">
            {openStatuses.includes(order.status) && (
              <>
                {order.status === 'PENDING' && (
                  <button className="button" disabled={busy} onClick={() => setStatus('ACCEPTED')}>
                    Nhận đơn
                  </button>
                )}
                {order.status === 'ACCEPTED' && (
                  <button className="button" disabled={busy} onClick={() => setStatus('PREPARING')}>
                    Bắt đầu làm
                  </button>
                )}
                {order.status === 'PREPARING' && (
                  <button className="button" disabled={busy} onClick={() => setStatus('READY')}>
                    Sẵn sàng
                  </button>
                )}
                <button className="button danger" disabled={busy} onClick={() => { setReason(''); setCancelTarget('order'); }}>
                  Huỷ đơn
                </button>
              </>
            )}
            {(order.status === 'COMPLETED' || order.status === 'PARTIAL_REFUND') && canWrite && (
              <button className="button danger" disabled={busy} onClick={() => { setReason(''); setRefundReason('OTHER'); setRefundOpen(true); }}>
                Hoàn tiền
              </button>
            )}
            <button className="button" disabled={busy} onClick={() => doReprint('bill')}>
              <Icon name="printer" size={14} /> In bill
            </button>
            <button className="button" disabled={busy} onClick={() => doReprint('kitchen')}>
              <Icon name="printer" size={14} /> In lại phiếu bếp
            </button>
            <button className="button" disabled={busy} onClick={() => doReprint('bar')}>
              <Icon name="printer" size={14} /> In lại phiếu bar
            </button>
          </div>
        }
      >
        <div className="actions" style={{ marginBottom: 20 }}>
          <Badge cls={(ORDER_STATUS[order.status] ?? { cls: 'grey' }).cls}>{(ORDER_STATUS[order.status] ?? { label: order.status }).label}</Badge>
          <span className="small muted">
            {order.paidAt ? `Đã thu lúc ${fmtDateTime(order.paidAt)}` : 'Chưa thanh toán'}
          </span>
          {order.bill && (
            <Badge cls={(BILL_STATUS[order.bill.status] ?? { cls: 'grey' }).cls}>
              Hóa đơn {order.bill.billNo} · {(BILL_STATUS[order.bill.status] ?? { label: order.bill.status }).label}
            </Badge>
          )}
          {moved.map((c) => (
            <Badge key={c} cls="amber">
              Đổi từ bàn {c}
            </Badge>
          ))}
        </div>
        {order.items.map((it) => (
          <div key={it.id} className="bill-line" style={{ opacity: it.status === 'CANCELLED' ? 0.5 : 1 }}>
            <span className="qty">{it.quantity}×</span>
            <div className="line-name">
              {it.name}
              {it.note && <small>{it.note}</small>}
              {it.options.map((o, i) => (
                <small key={i}>
                  {o.optionGroup}: {o.optionValue}
                  {o.extraPrice > 0 ? ` (+${fmtMoney(o.extraPrice)})` : ''}
                </small>
              ))}
              <small>{(ITEM_STATUS[it.status] ?? { label: it.status }).label}</small>
            </div>
            {isCashier && openStatuses.includes(order.status) && it.status !== 'CANCELLED' && (
              <button
                className="icon-btn"
                title="Huỷ món"
                onClick={() => {
                  setReason('');
                  setCancelTarget(it.id);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            )}
            <b className="line-price">{fmtMoney(it.totalAmount)}</b>
          </div>
        ))}
        {order.customerNote && <div className="notice">Ghi chú: {order.customerNote}</div>}
        <div className="summary-line total">
          <b>Tổng đơn</b>
          <strong>{fmtMoney(order.totalAmount)}</strong>
        </div>
        {order.bill && (
          <div className="small muted">
            Đơn thuộc hóa đơn bàn {order.bill.billNo} (tổng hóa đơn {fmtMoney(order.bill.totalAmount)}, đã thu {fmtMoney(order.bill.paidAmount)}). Thanh toán và giảm giá thực hiện ở màn Bán hàng / Thu ngân.
          </div>
        )}
        {order.payments && order.payments.length > 0 && (
          <>
            <span className="option-label">Thanh toán</span>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Hóa đơn</th>
                    <th>Phương thức</th>
                    <th className="num">Số tiền</th>
                    <th>Trạng thái</th>
                    <th>Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.receiptNo ?? '—'}</td>
                      <td>
                        {PAY_METHOD[p.method] ?? p.method}
                        {p.payerLabel ? <small>{p.payerLabel}</small> : null}
                      </td>
                      <td className="num">{fmtMoney(p.amount)}</td>
                      <td>
                        <Badge cls={p.status === 'COMPLETED' ? 'green' : p.status === 'REFUNDED' ? 'red' : 'amber'}>{p.status === 'COMPLETED' ? 'Đã thu' : p.status === 'REFUNDED' ? 'Đã hoàn' : p.status}</Badge>
                      </td>
                      <td className="muted">{p.paidAt ? fmtDateTime(p.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {err && <div className="form-error">{err}</div>}
      </Modal>

      {cancelOpen && (
        <Modal
          title={cancelTarget === 'order' ? 'Huỷ đơn hàng' : 'Huỷ món'}
          subtitle="Thao tác không thể hoàn tác"
          onClose={() => setCancelTarget(null)}
          width={440}
          footer={
            <>
              <button className="button" onClick={() => setCancelTarget(null)}>
                Huỷ bỏ
              </button>
              <button
                className="button danger"
                disabled={busy || !reason}
                onClick={() => {
                  const target = cancelTarget;
                  setCancelTarget(null);
                  if (target === 'order') void doCancel();
                  else void doCancelItem(target);
                }}
              >
                {busy ? 'Đang xử lý...' : cancelTarget === 'order' ? 'Xác nhận huỷ đơn' : 'Xác nhận huỷ món'}
              </button>
            </>
          }
        >
          <Field label="Lý do huỷ" required>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="vd: Khách bỏ về" />
          </Field>
        </Modal>
      )}

      {refundOpen && (
        <Modal
          title="Hoàn tiền"
          subtitle="Ghi nhận hoàn tiền cho đơn đã thanh toán"
          onClose={() => setRefundOpen(false)}
          width={440}
          footer={
            <>
              <button className="button" onClick={() => setRefundOpen(false)}>
                Huỷ bỏ
              </button>
              <button className="button danger" disabled={busy} onClick={() => { doRefund(); setRefundOpen(false); }}>
                {busy ? 'Đang xử lý...' : 'Xác nhận hoàn tiền'}
              </button>
            </>
          }
        >
          {order.billId && (
            <div className="notice warning">Đơn thuộc hóa đơn bàn: hệ thống hoàn tiền CẢ HÓA ĐƠN {order.bill?.billNo} theo đúng phương thức đã thu.</div>
          )}
          <Field label="Lý do hoàn">
            <select value={refundReason} onChange={(e) => setRefundReason(e.target.value)}>
              {REFUND_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ghi chú (tuỳ chọn)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
}

export default function Orders() {
  const { activeStore } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const open = searchParams.get('open');
    if (open) {
      setDetailId(open);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search) qs.set('search', search);
  qs.set('page', String(page));
  qs.set('pageSize', '15');

  const { data, loading, error, reload, refresh } = useFetch<OrderListResult>(
    () => api(`/stores/${activeStore!.id}/orders?${qs.toString()}`),
    [activeStore?.id, status, search, page],
  );

  useRealtimeRefresh(activeStore?.id, ['order.created', 'order.status', 'table.moved'], refresh);

  const doExport = async () => {
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (search) q.set('search', search);
      q.set('page', '1');
      q.set('pageSize', '1000');
      const all = await api<OrderListResult>(`/stores/${activeStore!.id}/orders?${q.toString()}`);
      const rows: (string | number)[][] = [
        ['Đơn', 'Bàn', 'Nguồn', 'Trạng thái', 'Số món', 'Thành tiền', 'Thời gian'],
        ...all.data.map((o) => [
          o.orderNumber,
          o.table?.code ?? '',
          ORDER_SOURCE[o.source] ?? o.source,
          ORDER_STATUS[o.status]?.label ?? o.status,
          o.items.reduce((s, i) => s + i.quantity, 0),
          o.totalAmount,
          fmtDateTime(o.createdAt),
        ]),
      ];
      exportCsv(`InnoOrder_don_hang_trang${page}.csv`, rows);
      toast('Đã xuất tệp CSV');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  if (loading) return <Loading />;
  if (error) return <div className="alert-strip">{error}</div>;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const rows = data?.data ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Lịch sử đơn hàng</h1>
          <p>Tìm theo số đơn hoặc bàn, xem tiến độ và chi tiết thanh toán.</p>
        </div>
        <div className="actions">
          <button className="button" onClick={doExport}>
            <Icon name="download" /> Xuất CSV
          </button>
          <button className="button" onClick={reload}>
            <Icon name="refresh" /> Làm mới
          </button>
        </div>
      </header>
      <div className="filters">
        <div className="tabs">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              className={`tab${status === f.value ? ' active' : ''}`}
              onClick={() => {
                setStatus(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="search">
          <Icon name="search" size={16} />
          <input
            aria-label="Tìm số đơn hoặc mã bàn"
            placeholder="Tìm số đơn hoặc mã bàn..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(searchInput.trim());
                setPage(1);
              }
            }}
          />
          {search && (
            <button className="icon-btn" aria-label="Xoá tìm kiếm" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        {rows.length ? (
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
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>#{o.orderNumber}</strong>
                    </td>
                    <td>
                      <strong>{o.table?.code ?? '—'}</strong>
                      <small>{ORDER_SOURCE[o.source] ?? o.source}</small>
                    </td>
                    <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                    <td>
                      <Badge cls={(ORDER_STATUS[o.status] ?? { cls: 'grey' }).cls}>{(ORDER_STATUS[o.status] ?? { label: o.status }).label}</Badge>
                    </td>
                    <td>
                      {new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      <small>{new Date(o.createdAt).toLocaleDateString('vi-VN')}</small>
                    </td>
                    <td className="num">
                      <strong>{fmtMoney(o.totalAmount)}</strong>
                    </td>
                    <td className="num">
                      <button className="button tiny" onClick={() => setDetailId(o.id)}>
                        Chi tiết →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Không có đơn phù hợp" sub="Thay đổi bộ lọc hoặc từ khóa để xem thêm." />
        )}
        <div className="pagination">
          <span>
            {data?.total ?? 0} đơn phù hợp · Trang {page}/{totalPages}
          </span>
          <div className="pages">
            <button className="button tiny" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Trước
            </button>
            <button className="button tiny" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Sau →
            </button>
          </div>
        </div>
      </section>

      {detailId && <DetailModal orderId={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </>
  );
}
