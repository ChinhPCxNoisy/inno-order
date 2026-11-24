// TabBar khách (port từ apps/zalo-mini-app/src/components/TabBar.tsx)
const TAB_ICONS = {
  order:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v19l-3-2-3 2-3-2-3 2V3a1 1 0 0 1 1-1z"/><path d="M9 7h6M9 11h6"/></svg>',
  voucher:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M13 7v2m0 6v2m0-7v2"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
};

// active: 'order' | 'voucher' | 'user' | null
function customerTabbar(active, links) {
  const L = links || {};
  const tabs = [
    { key: 'order', label: 'Gọi món', href: L.menu || 'menu.html' },
    { key: 'voucher', label: 'Voucher', href: L.voucher || 'voucher.html' },
    { key: 'user', label: 'Cá nhân', href: L.profile || 'profile.html' },
  ];
  return (
    '<nav class="tabbar">' +
    tabs
      .map(
        (t) =>
          '<a class="tab' +
          (t.key === active ? ' active' : '') +
          '" href="' +
          t.href +
    '"><span class="tab-icon">' +
          TAB_ICONS[t.key] +
          '</span><span>' +
          t.label +
          '</span></a>',
      )
      .join('') +
    '</nav>'
  );
}
