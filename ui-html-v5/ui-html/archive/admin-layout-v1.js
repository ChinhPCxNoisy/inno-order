// Layout admin (port từ apps/admin/src/components/Layout.tsx)
const ADMIN_NAV = [
  { to: 'dashboard.html', icon: 'grid', label: 'Tổng quan' },
  { to: 'pos.html', icon: 'pos', label: 'POS / Bàn' },
  { to: 'kitchen.html', icon: 'receipt', label: 'KDS Bếp' },
  { to: 'orders.html', icon: 'receipt', label: 'Đơn hàng' },
  { to: 'tables.html', icon: 'table', label: 'Bàn' },
  { to: 'menu.html', icon: 'book', label: 'Menu' },
  { to: 'users.html', icon: 'users', label: 'Nhân viên' },
  { to: 'reports.html', icon: 'chart', label: 'Báo cáo' },
  { to: 'printers.html', icon: 'printer', label: 'Máy in' },
  { to: 'stores.html', icon: 'building', label: 'Quản lý quán' },
];

function adminLayout(opts) {
  const o = opts || {};
  const active = o.active || '';
  const store = o.store || 'Quán Bún Bò Hương';
  const user = o.user || 'Trần Thị Mai';
  const role = o.role || 'Chủ quán';

  const left =
    '<aside class="sidebar">' +
    '  <div class="brand">' +
    '    <div class="brand-logo">IO</div>' +
    '    <div><div class="brand-name">InnoOrder</div><div class="brand-sub">Quản trị</div></div>' +
    '  </div>' +
    '  <nav><div class="nav-section">KHÔNG GIAN LÀM VIỆC</div>' +
    ADMIN_NAV.map(
      (n) =>
        '<a class="nav-item' +
        (n.to === active ? ' active' : '') +
        '" href="' +
        n.to +
        '"><span data-ic="' +
        n.icon +
        '" data-size="18"></span><span>' +
        n.label +
        '</span></a>',
    ).join('') +
    '  </nav>' +
    '  <div class="sidebar-foot">' +
    '    <div class="user-chip">' +
    '      <div class="avatar">' +
    (user.charAt(0) || '?').toUpperCase() +
    '</div>' +
    '      <div class="user-meta"><div class="user-name">' +
    user +
    '</div><div class="user-role">' +
    role +
    '</div></div>' +
    '    </div>' +
    '    <div class="sidebar-actions">' +
    '      <span class="icon-btn" title="Đổi mật khẩu" data-ic="key" data-size="18"></span>' +
    '      <span class="icon-btn" title="Đăng xuất" data-ic="logout" data-size="18"></span>' +
    '    </div>' +
    '  </div>' +
    '</aside>';

  let title;
  if (o.storeSelect) {
    title =
      '<select class="store-select">' +
      '<option value="">— Tổng quan hệ thống —</option>' +
      '<option selected>Quán Bún Bò Hương</option>' +
      '<option>Trà Sữa Làn Gió (đã tạm khóa)</option>' +
      '</select>';
  } else {
    title = '<span class="store-chip">' + store + '</span>';
  }

  const right =
    '<div class="topbar-right"><span class="demo-label">Dữ liệu minh họa</span>' +
    (o.suspended ? '<span class="badge b-red">Quán đang tạm khóa</span>' : '') +
    '<span class="topbar-user">' +
    user +
    '</span></div>';

  const page = document.getElementById('page');
  document.body.className = 'layout';
  document.body.innerHTML =
    left +
    '<div class="main">' +
    '  <header class="topbar"><button class="mobile-nav" aria-label="Mở điều hướng" onclick="document.querySelector(&quot;.sidebar&quot;).classList.toggle(&quot;open&quot;)">☰</button><div class="topbar-title">' +
    title +
    '</div>' +
    right +
    '  </header>' +
    '  <main class="content">' +
    (page ? page.innerHTML : '') +
    '  </main>' +
    '</div>';

  renderIcons(document.body);
  const h=document.querySelector('.page-head h2'); if(h) h.insertAdjacentHTML('afterend','<div class="page-sub">Không gian vận hành · Quán Bún Bò Hương</div>');
}
