import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import { activeNotice, dismissNotice, effectiveTable, getOrders, sessionMatchesTable } from '../session';
import { useSessionSync, useStoreSession } from '../useStoreSession';
import { useBrand } from '../useBrand';
import { isInZaloMiniApp } from '../zalo';

/**
 * Ma ban hien tai (?t=B01) va chuoi query de noi tiep vao cac lien ket noi bo.
 * Neu quan da doi ban cho khach (?t= la ma ban cu) thi tra ve ma ban moi de khong gui nham vao ban cu.
 */
export function useTable(): { table: string | null; q: string } {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const [params] = useSearchParams();
  const session = useStoreSession(storeSlug);
  const table = effectiveTable(session, params.get('t'));
  return { table, q: table ? `?t=${encodeURIComponent(table)}` : '' };
}

const LOGO = (
  <svg className="brand" viewBox="0 0 48 40" aria-hidden="true">
    <path fill="var(--red)" d="M5 30a17 17 0 0 1 34 0H5Zm-3 3h40v4H2Z" />
    <circle fill="var(--red)" cx="22" cy="10" r="3" />
    <path fill="var(--red)" d="m40 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
    <path fill="#fff" d="M9 28c1-8 5-12 11-14-5 4-7 8-7 14Z" />
  </svg>
);

export function AppBar({ name }: { name: string }) {
  return (
    <header className="appbar">
      {LOGO}
      <span className="brand-name">{name}</span>
      {/* Thanh cong cu Zalo chi la minh hoa khi mo bang trinh duyet; trong Zalo that da co khung native */}
      {!isInZaloMiniApp() && (
        <div className="zalo-controls" aria-hidden="true">
          <span className="dots">•••</span>
          <i />
          <svg width="16" height="16" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="10" r="2.5" fill="currentColor" />
          </svg>
        </div>
      )}
    </header>
  );
}

/** Dai thong bao quan doi/gop ban (bam dong duoc; nho da dong de khong hien lai) */
function TableNotice({ slug }: { slug: string }) {
  const session = useStoreSession(slug);
  const [params] = useSearchParams();
  // chi hien cho dung ban/phien: khach quet QR ban khac thi khong thay thong bao doi ban cua phien cu
  const notice = sessionMatchesTable(session, params.get('t')) ? activeNotice(session) : null;
  if (!notice) return null;
  return (
    <div className="table-notice" role="status">
      <Icon name="table" />
      <p className="small grow">{notice.text}</p>
      <button className="remove" type="button" aria-label="Đóng thông báo" onClick={() => dismissNotice(slug)}>
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

type NavKey = 'menu' | 'orders' | 'profile';

function BottomNav({ active }: { active: NavKey }) {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { q } = useTable();
  const base = `/s/${storeSlug}`;
  // "Don cua ban": mo thang don moi nhat hom nay, chua co thi vao lich su
  const todayStr = new Date().toDateString();
  const latest = getOrders().find(
    (o) => o.storeSlug === storeSlug && new Date(o.createdAt).toDateString() === todayStr,
  );
  const items: { key: NavKey; icon: IconName; label: string; to: string }[] = [
    { key: 'menu', icon: 'menu', label: 'Thực đơn', to: `${base}${q}` },
    {
      key: 'orders',
      icon: 'receipt',
      label: 'Đơn của bạn',
      to: latest ? `${base}/order/${latest.orderId}${q}` : `${base}/orders${q}`,
    },
    { key: 'profile', icon: 'user', label: 'Cá nhân', to: `${base}/profile${q}` },
  ];
  return (
    <nav className="bottom-nav" aria-label="Điều hướng chính">
      {items.map((it) => (
        <Link
          key={it.key}
          to={it.to}
          className={active === it.key ? 'active' : ''}
          aria-current={active === it.key ? 'page' : undefined}
        >
          <Icon name={it.icon} />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Khung man hinh chung: thanh tren, noi dung, thanh dieu huong hoac dock co dinh (thiet ke v2). */
export default function Shell({
  children,
  nav,
  footer,
  dock,
  hasCartBar,
  title,
}: {
  children: React.ReactNode;
  /** Hien thanh tab duoi va tab dang chon */
  nav?: NavKey;
  /** Dock co dinh cuoi man hinh (nut chinh) */
  dock?: React.ReactNode;
  footer?: React.ReactNode;
  hasCartBar?: boolean;
  /** Ten man hinh cho <title> cua trang ("<Ten man> · InnoOrder") */
  title?: string;
}) {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const brand = useBrand(storeSlug);
  useSessionSync(storeSlug);
  useEffect(() => {
    if (title) document.title = `${title} · InnoOrder`;
  }, [title]);
  const cls = ['app', nav ? 'has-nav' : '', dock ? 'has-dock' : '', hasCartBar ? 'has-cart' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <AppBar name={brand?.name ?? 'InnoOrder'} />
      <main>
        {storeSlug && <TableNotice slug={storeSlug} />}
        {children}
      </main>
      {nav && <BottomNav active={nav} />}
      {dock && <div className="dock">{dock}</div>}
      {footer}
    </div>
  );
}

/** Tieu de trang co nut quay lai */
export function PageTitle({ to, onBack, children }: { to: string; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="page-title">
      {onBack ? (
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Quay lại">
          <Icon name="back" />
        </button>
      ) : (
        <Link className="icon-btn" to={to} aria-label="Quay lại">
          <Icon name="back" />
        </Link>
      )}
      <h1>{children}</h1>
    </div>
  );
}

export function PoweredBy() {
  return (
    <p className="micro-foot">
      Được hỗ trợ bởi <strong>InnoOrder</strong>
    </p>
  );
}

export function Loading({ text = 'Đang tải…' }: { text?: string }) {
  return (
    <div className="loading-box">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
