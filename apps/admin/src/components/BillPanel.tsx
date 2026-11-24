import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { billErrMsg } from '../errors';
import { fmtMoney } from '../format';
import { BILL_STATUS, ITEM_STATUS, ORDER_SOURCE, ORDER_STATUS, TABLE_STATUS } from '../labels';
import type { Order, SessionView, TableInfo, TablesData } from '../types';
import { Badge, ConfirmModal, Empty, Icon, Loading, useToast } from '../ui';
import { CheckoutModal, DiscountModal } from './BillModals';
import OfferApplyModal from './OfferApplyModal';
import QrModal from './QrModal';
import { MergeTableModal, MergedBadges, MoveTableModal } from './TableMoveModals';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/**
 * Panel hoa don cua ban (POS): cac dot goi mon cua phien, tam tinh/giam gia/VAT/tong/da thu/con lai,
 * thanh toan gop, giam gia cap ban, in tam tinh, doi ban / gop ban.
 */
export default function BillPanel({
  table,
  areaName,
  view,
  loading,
  tables,
  legacyOrders,
  onCreateOrder,
  onChanged,
  onSelectTable,
  onLegacyPay,
  onLegacyReprint,
  onSetStatus,
}: {
  table: TableInfo;
  areaName: string;
  view: SessionView | null;
  loading: boolean;
  tables: TablesData;
  legacyOrders: Order[];
  onCreateOrder: () => void;
  /** Lam moi ngam ban + hoa don; tra ve khi xong */
  onChanged: () => void;
  onSelectTable: (id: string) => void;
  onLegacyPay: (o: Order) => void;
  onLegacyReprint: (o: Order) => void;
  onSetStatus: (t: TableInfo, status: string, msg: string) => void;
}) {
  const { activeStore, me } = useApp();
  const toast = useToast();
  const sid = activeStore!.id;
  const role = me?.role ?? '';
  const canCash = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER'].includes(role);
  // Phuc vu chi doi ban khi quan bat pos.allowWaiterMoveTable. /auth/me chua tra settings -> chi an khi biet chac la tat
  const waiterMoveOff = role === 'WAITER' && me?.store?.settings && me.store.settings.pos?.allowWaiterMoveTable !== true;
  const [modal, setModal] = useState<null | 'pay' | 'discount' | 'move' | 'merge' | 'qr' | 'offer'>(null);
  const [work, setWork] = useState<SessionView | null>(null); // ban sao view co bill (sau khi ensureBill)
  const [busy, setBusy] = useState<string | null>(null);
  const [rmDiscount, setRmDiscount] = useState<string | null>(null);

  const st = TABLE_STATUS[table.status] ?? { label: table.status, cls: 'grey' };
  const session = view?.session ?? null;
  const bill = view?.bill ?? null;
  const orders = view?.orders ?? [];
  const sum = bill ?? view?.preview ?? null;

  /** Tao/lay hoa don cua phien (idempotent); can truoc khi giam gia / thanh toan / in tam tinh */
  const ensureBill = async (): Promise<SessionView | null> => {
    if (view?.bill) return view;
    if (!session) return null;
    try {
      return await api<SessionView>(`/stores/${sid}/pos/sessions/${session.id}/bill`, { method: 'POST' });
    } catch (e) {
      toast(billErrMsg(e), 'err');
      return null;
    }
  };

  const openWith = async (m: 'pay' | 'discount' | 'qr' | 'offer') => {
    if (busy) return;
    setBusy(m);
    const v = await ensureBill();
    setBusy(null);
    if (!v) return;
    setWork(v);
    setModal(m);
  };

  const printPre = async () => {
    if (busy) return;
    setBusy('print');
    try {
      const v = await ensureBill();
      if (!v?.bill) return;
      const r = await api<{ queued: boolean; mode: string; status?: string; failedReason?: string | null }>(
        `/stores/${sid}/pos/bills/${v.bill.id}/print`,
        { method: 'POST', body: { kind: 'PRE_BILL' } },
      );
      if (!r.queued) toast('Quán đang ở chế độ chỉ dùng màn hình bếp, không in giấy.', 'info');
      else if (r.status === 'FAILED') toast(`Chưa in được tạm tính: ${r.failedReason ?? 'máy in lỗi'}`, 'err');
      else toast('Đã gửi lệnh in tạm tính');
      onChanged();
    } catch (e) {
      toast(billErrMsg(e), 'err');
    } finally {
      setBusy(null);
    }
  };

  const removeDiscount = async (id: string) => {
    if (!bill) return;
    try {
      await api(`/stores/${sid}/pos/bills/${bill.id}/discounts/${id}`, { method: 'DELETE' });
      toast('Đã huỷ giảm giá');
      setRmDiscount(null);
      onChanged();
    } catch (e) {
      toast(billErrMsg(e), 'err');
      setRmDiscount(null);
      onChanged();
    }
  };

  const roundOf = (o: { round: number }) => o.round;
  const itemQty = orders.reduce((s, o) => s + o.items.filter((i) => i.status !== 'CANCELLED').reduce((n, i) => n + i.quantity, 0), 0);

  return (
    <>
      <aside className="bill-panel">
        <header className="bill-head">
          <div>
            <h2>Bàn {table.code}</h2>
            <p>
              {areaName} · {table.seats ?? '—'} chỗ
              {bill ? ` · ${bill.billNo}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {bill && bill.status !== 'OPEN' && (
              <Badge cls={(BILL_STATUS[bill.status] ?? { cls: 'grey' }).cls}>{(BILL_STATUS[bill.status] ?? { label: bill.status }).label}</Badge>
            )}
            <Badge cls={st.cls}>{st.label}</Badge>
          </div>
        </header>
        <div className="bill-body">
          {view && <MergedBadges view={view} currentTableId={table.id} />}
          {loading && !view ? (
            <Loading />
          ) : orders.length ? (
            orders.map((o) => (
              <section key={o.id} className="bill-order">
                <div className="bill-order-title">
                  <b>
                    Đợt {roundOf(o)} · #{o.orderNumber} <span className="muted">· {hhmm(o.createdAt)}</span>
                  </b>
                  <Badge cls={ORDER_STATUS[o.status]?.cls ?? 'grey'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                </div>
                <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
                  {ORDER_SOURCE[o.source] ?? o.source}
                  {view && view.tables.filter((t) => t.active).length > 1 ? ` · Mang tới bàn ${o.tableCode}` : ''}
                </div>
                {o.items.map((it) => (
                  <div key={it.id} className="bill-line" style={{ opacity: it.status === 'CANCELLED' ? 0.45 : 1 }}>
                    <span className="qty">{it.quantity}×</span>
                    <div className="line-name">
                      <span style={it.status === 'CANCELLED' ? { textDecoration: 'line-through' } : undefined}>{it.name}</span>
                      {it.options?.map((op, i) => (
                        <small key={i}>
                          {op.optionGroup}: {op.optionValue}
                        </small>
                      ))}
                      {it.note ? <small>Ghi chú: {it.note}</small> : null}
                      <small>{(ITEM_STATUS[it.status] ?? { label: it.status }).label}</small>
                    </div>
                    <span className="line-price">{fmtMoney(it.totalAmount)}</span>
                  </div>
                ))}
                {o.customerNote && <p className="small muted">Ghi chú đơn: {o.customerNote}</p>}
              </section>
            ))
          ) : legacyOrders.length ? (
            <>
              <div className="notice warning">Đơn lẻ không thuộc phiên bàn (dữ liệu cũ): thanh toán theo từng đơn.</div>
              {legacyOrders.map((o) => (
                <section key={o.id} className="bill-order">
                  <div className="bill-order-title">
                    <b>
                      #{o.orderNumber} <span className="muted">· {hhmm(o.createdAt)}</span>
                    </b>
                    <Badge cls={ORDER_STATUS[o.status]?.cls ?? 'grey'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                  </div>
                  {o.items.map((it) => (
                    <div key={it.id} className="bill-line">
                      <span className="qty">{it.quantity}×</span>
                      <div className="line-name">
                        {it.name}
                        {it.note ? <small>{it.note}</small> : null}
                        <small>{(ITEM_STATUS[it.status] ?? { label: it.status }).label}</small>
                      </div>
                      <span className="line-price">{fmtMoney(it.totalAmount)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                    <button className="button tiny" onClick={() => onLegacyReprint(o)}>
                      <Icon name="printer" size={13} /> In bill
                    </button>
                    {canCash && (
                      <button className="button tiny primary" onClick={() => onLegacyPay(o)}>
                        Thanh toán {fmtMoney(o.totalAmount)}
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </>
          ) : (
            <Empty
              title={table.status === 'NEED_CLEAN' ? 'Bàn cần dọn' : table.status === 'LOCKED' ? 'Bàn đang tạm khóa' : 'Bàn đang trống'}
              sub={table.status === 'AVAILABLE' ? 'Chọn “Tạo đơn tại bàn” để bắt đầu phục vụ.' : undefined}
            />
          )}
          {(orders.length > 0 || legacyOrders.length > 0) && (
            <button className="button full" style={{ marginTop: 12 }} onClick={onCreateOrder}>
              <Icon name="plus" /> Gọi thêm món
            </button>
          )}
        </div>
        <footer className="bill-foot">
          {orders.length > 0 && sum && (
            <>
              <div className="summary-line">
                <span>Số lượng</span>
                <span>
                  {itemQty} món · {orders.length} đợt
                </span>
              </div>
              <div className="summary-line">
                <span>Tạm tính</span>
                <span>{fmtMoney(sum.subtotal)}</span>
              </div>
              {bill?.discounts.map((d) => (
                <div key={d.id} className="summary-line discount-line">
                  <span>
                    {d.kind === 'VOUCHER' ? 'Ưu đãi' : 'Giảm giá'}
                    {d.type === 'PERCENT' && d.percent ? ` ${d.percent}%` : ''}
                    <small>
                      {d.reason}
                      {d.approvedByUserId ? ' · quản lý duyệt' : ''}
                    </small>
                  </span>
                  <span>
                    − {fmtMoney(d.amount)}
                    {canCash && bill.paidAmount === 0 && (
                      <button className="icon-btn" title="Huỷ giảm giá này" aria-label="Huỷ giảm giá" onClick={() => setRmDiscount(d.id)}>
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {!bill && sum.discountAmount > 0 && (
                <div className="summary-line">
                  <span>Giảm giá</span>
                  <span>− {fmtMoney(sum.discountAmount)}</span>
                </div>
              )}
              {sum.vatAmount > 0 && (
                <div className="summary-line">
                  <span>VAT</span>
                  <span>{fmtMoney(sum.vatAmount)}</span>
                </div>
              )}
              <div className="summary-line total">
                <span>Tổng cộng</span>
                <strong>{fmtMoney(sum.totalAmount)}</strong>
              </div>
              {bill && bill.paidAmount > 0 && (
                <>
                  <div className="summary-line">
                    <span>Đã thu ({bill.payments.filter((p) => p.status === 'COMPLETED').length} lần)</span>
                    <b>{fmtMoney(bill.paidAmount)}</b>
                  </div>
                  <div className="summary-line">
                    <span>Còn phải thu</span>
                    <b style={{ color: 'var(--green)', fontSize: 15 }}>{fmtMoney(bill.remaining)}</b>
                  </div>
                </>
              )}
              {view && view.unservedItems > 0 && <p className="small" style={{ color: '#a28442', margin: '6px 0 0' }}>Còn {view.unservedItems} món chưa ra.</p>}
              <div className="bill-actions">
                {canCash && (
                  <>
                    <button className="button" disabled={!!busy} onClick={() => openWith('discount')}>
                      Giảm giá
                    </button>
                    <button className="button" disabled={!!busy} onClick={() => openWith('offer')}>
                      Mã ưu đãi
                    </button>
                    <button className="button" disabled={!!busy} onClick={printPre}>
                      <Icon name="printer" size={14} /> {busy === 'print' ? 'Đang gửi...' : 'In tạm tính'}
                    </button>
                  </>
                )}
                {!waiterMoveOff && (
                  <button className="button" disabled={!!busy || !session} onClick={() => setModal('move')}>
                    Đổi bàn
                  </button>
                )}
                {canCash && (
                  <button className="button" disabled={!!busy || !session} onClick={() => setModal('merge')}>
                    Gộp bàn
                  </button>
                )}
              </div>
              {canCash && (
                <button className="button full" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => openWith('qr')}>
                  {busy === 'qr' ? 'Đang mở...' : 'Thanh toán QR'}
                </button>
              )}
              {canCash ? (
                <button className="button primary full" disabled={!!busy} onClick={() => openWith('pay')}>
                  {busy === 'pay' ? 'Đang mở...' : `Thanh toán bàn · ${fmtMoney(bill ? bill.remaining : sum.totalAmount)}`}
                </button>
              ) : (
                <p className="small muted" style={{ marginTop: 10 }}>Chỉ thu ngân / quản lý được thanh toán và giảm giá.</p>
              )}
            </>
          )}
          {table.status === 'NEED_CLEAN' && orders.length === 0 && legacyOrders.length === 0 && (
            <button className="button primary full" onClick={() => onSetStatus(table, 'AVAILABLE', `Bàn ${table.code} sẵn sàng đón khách.`)}>
              <Icon name="check" /> Đã dọn · Mở bàn
            </button>
          )}
          {table.status === 'LOCKED' && orders.length === 0 && legacyOrders.length === 0 && (
            <button className="button full" onClick={() => onSetStatus(table, 'AVAILABLE', `Đã mở lại bàn ${table.code}`)}>
              Mở lại bàn
            </button>
          )}
        </footer>
      </aside>

        {modal === 'qr' && work?.bill && (
          <QrModal bill={work.bill} tableCode={table.code} onClose={() => { setModal(null); onChanged(); }} onChanged={onChanged} />
        )}
        {modal === 'offer' && work?.bill && (
          <OfferApplyModal bill={work.bill} requested={view?.requestedVoucherCodes ?? []} onClose={() => setModal(null)} onDone={() => onChanged()} />
        )}
        {modal === 'pay' && work?.bill && (
          <CheckoutModal
            tableCode={table.code}
            initial={work}
            canPrint={canCash}
            onClose={() => {
              setModal(null);
              onChanged();
            }}
            onChanged={onChanged}
          />
        )}
        {modal === 'discount' && work?.bill && (
          <DiscountModal bill={work.bill} onClose={() => setModal(null)} onDone={() => onChanged()} />
        )}
        {modal === 'move' && view && (
          <MoveTableModal
            view={view}
            tables={tables}
            currentTableId={table.id}
            onClose={() => setModal(null)}
            onDone={(toId) => {
              if (toId) onSelectTable(toId);
              onChanged();
            }}
          />
        )}
        {modal === 'merge' && view && (
          <MergeTableModal view={view} tables={tables} onClose={() => setModal(null)} onDone={onChanged} />
        )}
        {rmDiscount && (
          <ConfirmModal
            title="Huỷ giảm giá"
            message="Gỡ khoản giảm giá này khỏi hóa đơn? Tổng tiền sẽ tăng lại."
            confirmLabel="Huỷ giảm giá"
            danger
            onClose={() => setRmDiscount(null)}
            onConfirm={() => removeDiscount(rmDiscount)}
          />
        )}
    </>
  );
}
