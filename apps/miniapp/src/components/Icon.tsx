// Bo icon net don (stroke) cua thiet ke v2 — path lay tu bo HTML thiet ke.
const PATHS = {
  back: 'm15 18-6-6 6-6',
  next: 'm9 18 6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  table: 'M5 3h14l2 10H3L5 3Zm1 10-2 8m14-8 2 8M8 17h8',
  receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 5h8M8 12h8M8 16h4',
  menu: 'M5 4h14v17H5V4Zm4-2v5m6-5v5M8 11h8M8 15h6',
  user: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  gift: 'M3 8h18v5H3V8Zm2 5v8h14v-8M12 8v13M12 8C4 8 5 1 8 3l4 5Zm0 0c8 0 7-7 4-5l-4 5Z',
  bag: 'M4 7h16l1 14H3L4 7Zm4 0V5a4 4 0 0 1 8 0v2',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 21h6',
  pot: 'M4 10h16v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8Zm-3 2h3m16 0h3M8 2c-3 3 3 3 0 6m5-6c-3 3 3 3 0 6m5-6c-3 3 3 3 0 6',
  smile: 'M8 14c2 4 6 4 8 0M8 8h.01M16 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  wifi: 'm3 3 18 18M2 8c5-4 10-4 15-2M5 12c3-2 5-2 8-1M8 16c2-1 3-1 5 0M12 20h.01',
  qr: 'M3 3h6v6H3V3Zm12 0h6v6h-6V3ZM3 15h6v6H3v-6Zm12 0h2v2h4v4h-6v-6ZM12 3v5m0 4v5m-9-5h5m9 0h4',
  cup: 'M5 8h12v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8Zm12 1h2a3 3 0 0 1 0 6h-2M8 2v3m5-3v3',
  wallet: 'M3 6h18v15H3V6Zm0 0V3h15v3M16 11h5v5h-5v-5Z',
  alert: 'M12 3 2 21h20L12 3Zm0 6v5m0 3v.01',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size }: { name: IconName; size?: 'sm' | 'lg' }) {
  return (
    <svg className={`icon${size ? ` ${size}` : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
