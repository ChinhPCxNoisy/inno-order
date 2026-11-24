import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FoodSheet from '../components/FoodSheet';
import Icon from '../components/Icon';
import Img from '../components/Img';
import Shell, { Loading, PoweredBy, useTable } from '../components/Shell';
import ErrorState, { EmptyBody, errorKind, type ErrorKind } from '../components/StateView';
import { Lines, useUi } from '../components/ui';
import { ApiError, publicApi } from '../api';
import { setBrand, setTableArea } from '../brand';
import { useCart } from '../cart';
import { fmtMoney, titleLines } from '../format';
import { applyTheme } from '../theme';
import type { MenuItem, PublicMenu } from '../types';

const ALL = '__all__';

/** Bo dau + hoa thuong de tim "ca phe" ra "Cà phê" */
const norm = (s: string) =>
  s
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

/** Thuc don + popup chi tiet mon (thiet ke v2, man 02-03). */
export default function Menu() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { table, q } = useTable();
  const { count, total, add, qtyOf } = useCart();
  const { toast, message } = useUi();

  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState(ALL);
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  // Xac nhan ban (?t=): pending = dang kiem tra, ok = hop le, locked = ban tam khoa, bad = ma ban sai
  const [tableCheck, setTableCheck] = useState<'pending' | 'ok' | 'locked' | 'bad'>('pending');
  const [checkTick, setCheckTick] = useState(0);
  // Nut/anh da mo popup: dong popup hoac them vao gio xong thi tra focus ve do
  const openerRef = useRef<HTMLElement | null>(null);

  const openSheet = (it: MenuItem) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheetItem(it);
  };
  const closeSheet = () => {
    setSheetItem(null);
    const el = openerRef.current;
    window.setTimeout(() => {
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }, 0);
  };

  useEffect(() => {
    if (!storeSlug || !table) return;
    let cancelled = false;
    setTableCheck('pending');
    publicApi
      .confirmTable(storeSlug, table.toUpperCase())
      .then((c) => {
        if (cancelled) return;
        setTableArea(storeSlug, table, c.table.areaName);
        setTableCheck(c.table.locked ? 'locked' : 'ok');
      })
      .catch((e) => {
        if (cancelled) return;
        // Quan tam ngung: de man tai thuc don hien "Quan tam dung nhan don"
        if (errorKind(e) === 'closed') {
          setError('closed');
          setTableCheck('ok');
          return;
        }
        // Chi chan khi server noi ro ma ban/quan sai; loi mang thi de man tai thuc don tu bao loi
        setTableCheck(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'bad' : 'ok');
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, table, checkTick]);

  useEffect(() => {
    if (!storeSlug) return;
    let cancelled = false;
    setError(null);
    publicApi
      .getMenu(storeSlug)
      .then((d) => {
        if (cancelled) return;
        setBrand(d.store);
        applyTheme(d.store.themeColor);
        setMenu(d);
      })
      .catch((e) => {
        if (!cancelled) setError(errorKind(e));
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, tick]);

  const featured = useMemo(
    () => menu?.categories.flatMap((c) => c.items).find((it) => it.imageUrl) ?? null,
    [menu],
  );

  const rows = useMemo(() => {
    if (!menu) return [];
    const nq = norm(search.trim());
    return menu.categories
      .filter((c) => cat === ALL || c.id === cat)
      .flatMap((c) => c.items)
      .filter((it) => !nq || norm(`${it.name} ${it.description ?? ''}`).includes(nq));
  }, [menu, cat, search]);

  if (!table) {
    return (
      <Shell>
        <ErrorState kind="qr" />
      </Shell>
    );
  }
  if (tableCheck === 'bad') {
    return (
      <Shell>
        <ErrorState kind="qr" />
      </Shell>
    );
  }
  if (tableCheck === 'locked') {
    return (
      <Shell title="Thực đơn">
        <EmptyBody
          icon="alert"
          title="Bàn đang tạm khóa"
          text={`Bàn ${table} hiện chưa nhận gọi món. Vui lòng nhờ nhân viên hỗ trợ hoặc thử lại sau.`}
        >
          <button className="btn secondary" onClick={() => setCheckTick((t) => t + 1)}>
            Thử lại
          </button>
        </EmptyBody>
      </Shell>
    );
  }
  if (error || !menu || tableCheck === 'pending') {
    return (
      <Shell title={error ? undefined : 'Thực đơn'}>
        {error ? <ErrorState kind={error} onRetry={() => setTick((t) => t + 1)} /> : <Loading text="Đang tải thực đơn…" />}
      </Shell>
    );
  }

  const store = menu.store;
  const catTitle = search.trim()
    ? 'Kết quả tìm kiếm'
    : cat === ALL
      ? 'Thực đơn hôm nay'
      : (menu.categories.find((c) => c.id === cat)?.name ?? 'Thực đơn');

  const wrongTable = () =>
    message(
      `Kiểm tra bàn ${table}`,
      'Nếu đây không phải bàn của bạn, hãy quét lại mã QR trên bàn đang ngồi. Nếu quán đã chuyển bàn cho bạn, bàn mới sẽ tự cập nhật ở đây. Cần đổi chỗ, hãy nhờ nhân viên chuyển bàn để tránh nhầm món.',
    );

  return (
    <Shell
      title="Thực đơn"
      nav="menu"
      hasCartBar={count > 0}
      footer={
        count > 0 && (
          <Link className="cart-bar" to={`/s/${storeSlug}/cart${q}`}>
            <span>
              <span className="bubble">{count}</span> Xem giỏ món
            </span>
            <span>
              {fmtMoney(total)} <Icon name="next" size="sm" />
            </span>
          </Link>
        )
      }
    >
      <div className="restaurant-head">
        <div className="restaurant-avatar">
          <Img src={store.logoUrl ?? ''} alt="" fallbackChar={store.name.charAt(0).toUpperCase()} />
        </div>
        <div className="grow">
          <p className="eyebrow">Gọi món tại bàn</p>
          <h1>{store.name}</h1>
          <span className="small muted">
            <span style={{ color: 'var(--green)' }}>●</span> Đang phục vụ
          </span>
        </div>
        <span className="pill">
          <Icon name="table" size="sm" /> {table}
        </span>
      </div>

      {featured && (
        <div className="feature">
          <div className="copy">
            <p className="eyebrow">Món ngon nên thử</p>
            <h2>
              <Lines lines={titleLines(featured.name)} />
            </h2>
            <button className="text-btn" onClick={() => openSheet(featured)}>
              Khám phá · {fmtMoney(featured.price)} <Icon name="next" size="sm" />
            </button>
          </div>
          <img src={featured.imageUrl ?? ''} alt={featured.name} />
        </div>
      )}

      <label className="search">
        <Icon name="search" />
        <input
          type="search"
          value={search}
          placeholder="Tìm món bạn thích..."
          aria-label="Tìm món"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <div className="categories" role="group" aria-label="Danh mục món">
        <button className={`category${cat === ALL ? ' active' : ''}`} onClick={() => setCat(ALL)}>
          Tất cả
        </button>
        {menu.categories.map((c) => (
          <button key={c.id} className={`category${cat === c.id ? ' active' : ''}`} onClick={() => setCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 12 }}>
        <h2>{catTitle}</h2>
        <span className="menu-count">{rows.length} món</span>
      </div>

      {rows.length > 0 ? (
        rows.map((it) => (
          <article className="food-row" key={it.id}>
            <Img
              className="food-img"
              src={it.imageUrl ?? ''}
              alt={it.name}
              fallbackChar={it.name.charAt(0).toUpperCase()}
              onActivate={() => openSheet(it)}
            />
            <div className="grow">
              <button className="food-name" onClick={() => openSheet(it)}>
                {it.name}
              </button>
              {it.description && <p className="description">{it.description}</p>}
              <div className="row between gap8">
                <span className="price">{fmtMoney(it.price)}</span>
                {qtyOf(it.id) > 0 && <span className="in-cart-badge">Trong giỏ: {qtyOf(it.id)}</span>}
                <button className="plus" aria-label={`Thêm ${it.name}`} onClick={() => openSheet(it)}>
                  <Icon name="plus" />
                </button>
              </div>
            </div>
          </article>
        ))
      ) : (
        <EmptyBody icon="search" title="Chưa có món phù hợp" text="Thử tìm bằng từ khóa khác hoặc xem danh mục khác nhé.">
          <button
            className="btn secondary"
            onClick={() => {
              setSearch('');
              setCat(ALL);
            }}
          >
            Xem tất cả món
          </button>
        </EmptyBody>
      )}

      <div className="row between mt16">
        <span className="tiny muted">
          Bạn đang gọi món tại <strong>Bàn {table}</strong>
        </span>
        <button className="text-btn" onClick={wrongTable}>
          Sai bàn?
        </button>
      </div>
      <PoweredBy />

      {sheetItem && (
        <FoodSheet
          item={sheetItem}
          onClose={closeSheet}
          onConfirm={(quantity, note, options) => {
            add(sheetItem, quantity, note, options);
            closeSheet();
            toast('Đã thêm món vào giỏ');
          }}
        />
      )}
    </Shell>
  );
}
