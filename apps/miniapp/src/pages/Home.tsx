import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FoodSheet from '../components/FoodSheet';
import Icon from '../components/Icon';
import Img from '../components/Img';
import Shell, { Loading, PoweredBy } from '../components/Shell';
import ErrorState, { errorKind, type ErrorKind } from '../components/StateView';
import { Lines, useUi } from '../components/ui';
import { publicApi } from '../api';
import { setBrand, setTableArea } from '../brand';
import { useCart } from '../cart';
import { fmtMoney, sentenceLines, titleLines } from '../format';
import { applyTheme } from '../theme';
import type { MenuItem, PublicMenu, TableInfo } from '../types';

// Mo truc tiep "/" (khong qua QR) thi dung quan demo de xem giao dien
const DEMO_SLUG = 'launuongphoco';
const DEMO_TABLE = 'B01';

/** Man hinh chao mung sau khi quet QR /s/{slug}/t/{table} (thiet ke v2, man 01). */
export default function Home() {
  const params = useParams<{ storeSlug?: string; tableCode?: string }>();
  const slug = params.storeSlug ?? DEMO_SLUG;
  const tableCode = (params.tableCode ?? DEMO_TABLE).toUpperCase();

  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [tick, setTick] = useState(0);
  // Teaser mo popup chi tiet mon ngay tren man chao mung (nhu mau); mo truc tiep "/" (quan demo) thi chuyen sang thuc don
  const { count, total, add } = useCart();
  const { toast } = useUi();
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeSheet = () => {
    setSheetItem(null);
    const el = openerRef.current;
    window.setTimeout(() => {
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }, 0);
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Xac nhan ban truoc: QR sai ban/quan se hien man hinh loi thay vi vao thuc don
    Promise.all([publicApi.confirmTable(slug, tableCode), publicApi.getMenu(slug)])
      .then(([c, m]) => {
        if (cancelled) return;
        setBrand(c.store);
        applyTheme(c.store.themeColor);
        setTableArea(slug, tableCode, c.table.areaName);
        setTable(c.table);
        setMenu(m);
      })
      .catch((e) => {
        if (!cancelled) setError(errorKind(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, tableCode, tick]);

  const menuHref = `/s/${slug}?t=${encodeURIComponent(tableCode)}`;
  const store = menu?.store;
  const items = menu ? menu.categories.flatMap((c) => c.items) : [];
  const withImage = items.filter((it) => it.imageUrl);
  const heroSrc = store?.bannerUrl ?? withImage[0]?.imageUrl ?? '';
  const teasers = (withImage.length >= 3 ? withImage : items).slice(0, 3);

  if (error || !menu || !store || !table) {
    return (
      <Shell title={error ? undefined : 'Chào mừng'}>
        {error ? <ErrorState kind={error} onRetry={() => setTick((t) => t + 1)} /> : <Loading />}
      </Shell>
    );
  }

  const popup = Boolean(params.storeSlug);
  const cartBar =
    popup && count > 0 ? (
      <Link className="cart-bar solo" to={`/s/${slug}/cart?t=${encodeURIComponent(tableCode)}`}>
        <span>
          <span className="bubble">{count}</span> Xem giỏ món
        </span>
        <span>
          {fmtMoney(total)} <Icon name="next" size="sm" />
        </span>
      </Link>
    ) : undefined;

  return (
    <Shell title="Chào mừng" hasCartBar={count > 0 && popup} footer={cartBar}>
      <div className="welcome">
        <div className="table-strip">
          <div className="table-chip">
            <Icon name="table" size="sm" /> Bàn {table.code}
          </div>
          {table.locked ? (
            <span className="pill amber">Bàn đang tạm khóa</span>
          ) : (
            <span className="pill green">
              <i className="dot" /> Đang phục vụ
            </span>
          )}
        </div>

        <Img
          className="hero"
          src={heroSrc}
          alt={store.name}
          fallbackChar={store.name.charAt(0).toUpperCase()}
          fallbackClassName="hero-fallback"
        />
        <p className="eyebrow">Chào mừng bạn đến với</p>
        <h1>
          <Lines lines={titleLines(store.name)} />
          <span className="red">.</span>
        </h1>
        <p className="intro muted">
          <Lines lines={sentenceLines(store.welcomeText ?? 'Gọi món tại bàn, theo dõi đơn ngay trên điện thoại.')} />
        </p>
        <Link className="btn" to={menuHref}>
          Xem thực đơn &amp; gọi món <Icon name="next" />
        </Link>
        <p className="tiny muted center mt8">Gọi món tại bàn · Theo dõi đơn ngay trên Zalo</p>

        {teasers.length > 0 && (
          <>
            <div className="section-head">
              <h2>Món ngon nên thử</h2>
              <Link className="text-btn" to={menuHref}>
                Xem tất cả
              </Link>
            </div>
            <div className="food-teasers">
              {teasers.map((it) => {
                const body = (
                  <>
                    <Img
                      className="teaser-img"
                      src={it.imageUrl ?? ''}
                      alt={it.name}
                      fallbackChar={it.name.charAt(0).toUpperCase()}
                    />
                    <div className="body">
                      <h3>{it.name}</h3>
                      <span className="price">{fmtMoney(it.price)}</span>
                    </div>
                  </>
                );
                return popup ? (
                  <button
                    className="teaser"
                    key={it.id}
                    aria-label={`Xem ${it.name}`}
                    onClick={() => {
                      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                      setSheetItem(it);
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <Link className="teaser" key={it.id} to={menuHref} aria-label={`Xem ${it.name}`}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {store.showVoucherTab && (
          <Link className="benefit" to={`/s/${slug}/voucher?t=${encodeURIComponent(tableCode)}`}>
            <Icon name="gift" size="lg" />
            <div>
              <strong>Hẹn bạn một lần ghé sau</strong>
              <p>Khám phá ưu đãi và điều kiện áp dụng của quán.</p>
            </div>
          </Link>
        )}

        <PoweredBy />
      </div>

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
