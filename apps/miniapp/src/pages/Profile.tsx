import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import Shell, { PoweredBy, useTable } from '../components/Shell';
import { useUi } from '../components/ui';
import { clearSession, getCustomer, getOrders, saveCustomer } from '../session';
import { useStoreSession } from '../useStoreSession';
import { useBrand, useTableArea } from '../useBrand';
import { isInZaloMiniApp, zaloLogin } from '../zalo';

/** Ca nhan (thiet ke v2, man 10): dang nhap Zalo tuy chon, loi tat den uu dai/lich su/ho tro. */
export default function Profile() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { table, q } = useTable();
  const brand = useBrand(storeSlug);
  const area = useTableArea(storeSlug, table);
  const { message, toast } = useUi();

  const [customer, setCustomer] = useState(getCustomer);
  const [busy, setBusy] = useState(false);
  const session = useStoreSession(storeSlug);
  const base = `/s/${storeSlug}`;

  const loginZalo = async () => {
    if (busy) return;
    setBusy(true);
    const info = await zaloLogin();
    setBusy(false);
    if (info) {
      saveCustomer({ zaloUserId: info.zaloUserId, name: info.name });
      setCustomer(getCustomer());
      toast('Đã liên kết tài khoản Zalo');
    } else {
      message(
        'Đăng nhập bằng Zalo',
        isInZaloMiniApp()
          ? 'Không thể đăng nhập Zalo, vui lòng thử lại. Bạn vẫn có thể gọi món mà không cần đăng nhập.'
          : 'Tính năng này khả dụng khi mở trong Zalo Mini App. Bạn vẫn có thể gọi món mà không cần đăng nhập.',
      );
    }
  };

  const confirmClear = () =>
    message(
      'Xóa dữ liệu trên thiết bị?',
      'Giỏ món và lịch sử lưu trên thiết bị này sẽ bị xóa. Thao tác này không hủy đơn đã gửi đến quán.',
      [
        {
          label: 'Xóa dữ liệu',
          onClick: () => {
            clearSession();
            if (storeSlug) localStorage.removeItem(`innoorder_cart_${storeSlug}`);
            setCustomer({});
            toast('Đã xóa dữ liệu trên thiết bị');
          },
        },
        { label: 'Giữ lại', neutral: true },
      ],
    );

  // Co phien dang mo (token) hoac vua gui don trong 12 gio gan day thi moi hien loi vao hoa don ban
  const hasBill =
    Boolean(session?.token) ||
    getOrders().some((o) => o.storeSlug === storeSlug && Date.now() - new Date(o.createdAt).getTime() < 12 * 3600_000);

  const links: { to: string; icon: IconName; label: string; show: boolean }[] = [
    { to: `${base}/voucher${q}`, icon: 'gift', label: 'Ưu đãi của quán', show: brand?.showVoucherTab !== false },
    { to: `${base}/bill${q}`, icon: 'wallet', label: 'Hóa đơn của bàn', show: hasBill },
    { to: `${base}/orders${q}`, icon: 'receipt', label: 'Lịch sử đơn hàng', show: true },
    { to: `${base}/support${q}`, icon: 'bell', label: 'Hỗ trợ tại bàn', show: Boolean(table) },
  ];

  return (
    <Shell title="Cá nhân" nav="profile">
      <div className="row profile-greeting">
        <div className="avatar">{customer.name?.charAt(0).toUpperCase() ?? 'K'}</div>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{customer.name ? `Chào ${customer.name}!` : 'Chào bạn!'}</h1>
          <span className="small muted">{customer.phone ?? 'Một bữa ngon, một ngày thật vui.'}</span>
        </div>
      </div>

      {brand?.showZaloLogin !== false && !customer.zaloUserId && (
        <div className="card">
          <div className="row start mb16">
            <div className="zalo-logo">Zalo</div>
            <div>
              <h3>Lưu lại những lần ghé quán</h3>
              <p className="small muted mb0">Đăng nhập để lưu lịch sử và nhận ưu đãi.</p>
            </div>
          </div>
          <button className="btn zalo" disabled={busy} onClick={loginZalo}>
            {busy ? 'Đang liên kết…' : 'Đăng nhập bằng Zalo'}
          </button>
          <p className="tiny muted center mt8 mb0">Bạn vẫn có thể gọi món mà không cần đăng nhập.</p>
        </div>
      )}

      <div className="card flush">
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link className="line-action" key={l.to} to={l.to}>
              <Icon name={l.icon} />
              <strong className="small grow">{l.label}</strong>
              <Icon name="next" />
            </Link>
          ))}
      </div>

      <div className="card">
        <p className="eyebrow">Bạn đang dùng bữa tại</p>
        <h2>{brand?.name ?? 'Quán'}</h2>
        {brand?.welcomeText && <p className="small muted">{brand.welcomeText}</p>}
        {table && (
          <>
            <div className="divider" />
            <div className="row between">
              <span className="small muted">Bàn của bạn</span>
              <strong>
                {table}
                {area ? ` · ${area}` : ''}
              </strong>
            </div>
          </>
        )}
      </div>

      <button className="subtle-action" onClick={confirmClear}>
        <Icon name="trash" size="sm" /> Xóa dữ liệu trên thiết bị
      </button>
      <PoweredBy />
    </Shell>
  );
}
