import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { ROLE_LABEL } from '../labels';
import { DEFAULT_HELP, HELP_CONTENT, type HelpSection } from '../help';
import { Field, Icon, Modal, useToast } from '../ui';
import { api, errMsg } from '../api';
import OrderNotifier from './OrderNotifier';
import PrintAlerts from './PrintAlerts';

const ALL = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'];
const MGMT = ['SUPER_ADMIN', 'OWNER', 'MANAGER'];

interface NavItem {
  to: string;
  icon: string;
  label: string;
  group: string;
  roles: string[];
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', icon: 'grid', label: 'Tổng quan', group: 'VẬN HÀNH', roles: [...MGMT, 'CASHIER'], end: true },
  { to: '/pos', icon: 'pos', label: 'Bán hàng / Thu ngân', group: 'VẬN HÀNH', roles: ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER'] },
  { to: '/kitchen', icon: 'kitchen', label: 'Bếp / Bar', group: 'VẬN HÀNH', roles: ALL },
  { to: '/service', icon: 'serve', label: 'Phục vụ', group: 'VẬN HÀNH', roles: ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER', 'WAITER'] },
  { to: '/orders', icon: 'order', label: 'Lịch sử đơn', group: 'VẬN HÀNH', roles: ALL },
  { to: '/menu', icon: 'book', label: 'Thực đơn', group: 'THIẾT LẬP QUÁN', roles: ALL },
  { to: '/tables', icon: 'table', label: 'Khu vực & bàn', group: 'THIẾT LẬP QUÁN', roles: ALL },
  { to: '/users', icon: 'users', label: 'Nhân sự & vai trò', group: 'THIẾT LẬP QUÁN', roles: MGMT },
  { to: '/printers', icon: 'printer', label: 'Máy in & hàng đợi', group: 'THIẾT LẬP QUÁN', roles: [...MGMT, 'CASHIER'] },
  { to: '/payments', icon: 'money', label: 'Giao dịch ngân hàng', group: 'QUẢN LÝ', roles: ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER'] },
  { to: '/offers', icon: 'receipt', label: 'Ưu đãi', group: 'THIẾT LẬP QUÁN', roles: MGMT },
  { to: '/reports', icon: 'chart', label: 'Báo cáo', group: 'QUẢN LÝ', roles: ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER'] },
  { to: '/stores', icon: 'store', label: 'Quán trên nền tảng', group: 'NỀN TẢNG', roles: ['SUPER_ADMIN'] },
];

const GROUP_ORDER = ['VẬN HÀNH', 'THIẾT LẬP QUÁN', 'QUẢN LÝ', 'NỀN TẢNG'];

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!current || next.length < 8) {
      setErr('Mật khẩu mới tối thiểu 8 ký tự');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      toast('Đổi mật khẩu thành công');
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Đổi mật khẩu"
      subtitle="Tài khoản của bạn"
      onClose={onClose}
      footer={
        <>
          <span />
          <button className="button" onClick={onClose}>
            Huỷ
          </button>
          <button className="button primary" disabled={busy} onClick={submit}>
            {busy ? 'Đang xử lý...' : 'Lưu mật khẩu'}
          </button>
        </>
      }
    >
      <Field label="Mật khẩu hiện tại" required>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </Field>
      <Field label="Mật khẩu mới" required hint="Tối thiểu 8 ký tự">
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

function HelpModal({ content, onClose }: { content: HelpSection; onClose: () => void }) {
  return (
    <Modal
      title={content.title}
      subtitle={content.subtitle}
      onClose={onClose}
      footer={
        <>
          <span />
          <button className="button primary" onClick={onClose}>
            Đã hiểu
          </button>
        </>
      }
    >
      {content.rows && (
        <div className="stack">
          {content.rows.map(([t, s]) => (
            <div key={t} className="task-row">
              <div>
                <strong>{t}</strong>
                <small>{s}</small>
              </div>
            </div>
          ))}
        </div>
      )}
      {content.steps && (
        <ol className="help-steps">
          {content.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {content.tip && (
        <div className="notice" style={{ marginTop: 14 }}>
          <Icon name="info" size={14} /> {content.tip}
        </div>
      )}
    </Modal>
  );
}

export default function Layout() {
  const { me, logout, stores, activeStoreId, selectStore, activeStore, isSuper } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [pwOpen, setPwOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const helpContent = HELP_CONTENT[location.pathname] ?? DEFAULT_HELP;

  const role = me?.role ?? '';
  const roleLabel = ROLE_LABEL[role] ?? role;
  const items = NAV.filter((n) => n.roles.includes(role));
  const groups = GROUP_ORDER.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(
    ([, list]) => list.length > 0,
  );

  const storeName = isSuper ? (activeStore?.name ?? 'InnoOrder Cloud') : (activeStore?.name ?? '—');
  const suspended = isSuper && activeStore?.status === 'SUSPENDED';
  const miniPath = activeStore ? `/s/${activeStore.slug}` : null;

  const copyMini = async () => {
    if (!miniPath) return;
    try {
      await navigator.clipboard.writeText(miniPath);
      toast('Đã copy đường dẫn mini app');
    } catch {
      toast('Không thể copy đường dẫn', 'err');
    }
  };

  const doLogout = () => {
    if (isSuper) selectStore(null);
    logout();
  };

  return (
    <>
      <OrderNotifier />
      <div className={`mobile-backdrop${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <a className="brand" href="/">
          <img className="brand-mark" src="/brand-mark.png" alt="" />
          <div>
            <strong>InnoOrder</strong>
            <small>RESTAURANT WORKSPACE</small>
          </div>
        </a>
        <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
        <div className="select-placeholder">
          <span className="workspace-current">{roleLabel}</span>
        </div>
        {isSuper && (
          <select
            className="store-select"
            value={activeStoreId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              selectStore(id);
              navigate('/');
            }}
          >
            <option value="">— Tổng quan hệ thống —</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.status === 'SUSPENDED' ? '(đã tạm khóa)' : ''}
              </option>
            ))}
          </select>
        )}
        <nav>
          {groups.map(([label, list]) => (
            <div key={label}>
              <div className="nav-label">{label}</div>
              {list.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {miniPath && (
            <div className="support-box">
              <strong>Mini app khách hàng</strong>
              Khách quét QR hoặc mở
              <div className="mini-path" onClick={copyMini} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && copyMini()}>
                {miniPath}
                <Icon name="copy" size={12} />
              </div>
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{me?.name?.[0]?.toUpperCase() ?? '?'}</span>
          <span style={{ minWidth: 0 }}>
            <strong>{me?.name}</strong>
            <small>{roleLabel}</small>
          </span>
          <span className="foot-actions">
            <button className="icon-btn" title="Đổi mật khẩu" onClick={() => setPwOpen(true)}>
              <Icon name="key" />
            </button>
            <button className="icon-btn" title="Đăng xuất" onClick={doLogout}>
              <Icon name="logout" />
            </button>
          </span>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div className="location">
            <button className="mobile-toggle" aria-label="Mở điều hướng" onClick={() => setMobileOpen((v) => !v)}>
              ☰
            </button>
            <Icon name="store" />
            {storeName}
            <span className={`badge ${suspended ? 'red' : isSuper && !activeStore ? 'blue' : 'green'}`}>
              {suspended ? 'Tạm khóa' : isSuper && !activeStore ? 'Nền tảng' : 'Quán'}
            </span>
          </div>
          <div className="topbar-right">
            <span className="top-date">
              {new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
            <button className="help-link" title="Hướng dẫn sử dụng màn hình này" onClick={() => setHelpOpen(true)}>
              <Icon name="help" size={15} /> Hướng dẫn
            </button>
            <button className="help-link logout-link" onClick={doLogout} title="Đăng xuất">
              <Icon name="logout" size={14} />
              Đăng xuất
            </button>
            <span className="avatar">{me?.name?.[0]?.toUpperCase() ?? '?'}</span>
          </div>
        </header>
        <main className="content">
          <PrintAlerts />
          <Outlet />
        </main>
      </div>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
      {helpOpen && <HelpModal content={helpContent} onClose={() => setHelpOpen(false)} />}
    </>
  );
}
