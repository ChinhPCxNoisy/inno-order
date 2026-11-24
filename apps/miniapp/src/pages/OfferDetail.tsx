import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Shell, { Loading, PageTitle, useTable } from '../components/Shell';
import ErrorState, { EmptyBody } from '../components/StateView';
import { useUi } from '../components/ui';
import { ApiError, errMsg, publicApi } from '../api';
import { copyText } from '../clipboard';
import { setDeclaredVoucher } from '../voucher';
import type { PublicOfferDetail } from '../types';

const STATE_LABEL: Record<string, string> = {
  PAUSED: 'Tạm dừng',
  NOT_STARTED: 'Chưa bắt đầu',
  EXPIRED: 'Đã hết hạn',
  EXHAUSTED: 'Đã hết lượt',
};

/** Chi tiet uu dai (thiet ke v2, man 13): ma coupon, dieu kien ap dung do server tra, sao chep ma. */
export default function OfferDetail() {
  const { storeSlug, offerId } = useParams<{ storeSlug: string; offerId: string }>();
  const { q } = useTable();
  const { toast, message } = useUi();
  const [offer, setOffer] = useState<PublicOfferDetail | null>(null);
  const [error, setError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => {
    setError(null);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!storeSlug || !offerId) return;
    let cancelled = false;
    publicApi
      .getOffer(storeSlug, offerId)
      .then((o) => {
        if (!cancelled) setOffer(o);
      })
      .catch((e) => {
        if (!cancelled) setError({ notFound: e instanceof ApiError && e.status === 404, text: errMsg(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, offerId, tick]);

  const listHref = `/s/${storeSlug}/voucher${q}`;

  if (error?.notFound) {
    return (
      <Shell title="Chi tiết ưu đãi" nav="profile">
        <PageTitle to={listHref}>Chi tiết ưu đãi</PageTitle>
        <EmptyBody icon="gift" title="Không tìm thấy ưu đãi" text="Ưu đãi này không còn hoặc đã được quán ẩn đi.">
          <Link className="btn" to={listHref}>
            Xem ưu đãi khác
          </Link>
        </EmptyBody>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell nav="profile">
        <ErrorState kind="network" onRetry={reload} />
      </Shell>
    );
  }
  if (!offer) {
    return (
      <Shell title="Chi tiết ưu đãi" nav="profile">
        <PageTitle to={listHref}>Chi tiết ưu đãi</PageTitle>
        <Loading text="Đang tải ưu đãi…" />
      </Shell>
    );
  }

  const usable = offer.state === 'AVAILABLE';

  const copy = async () => {
    if (await copyText(offer.code)) toast(`Đã sao chép mã ${offer.code}`);
    else message('Mã ưu đãi', `Mã ưu đãi: ${offer.code}. Bạn có thể chọn và sao chép mã này.`);
  };

  return (
    <Shell title="Chi tiết ưu đãi" nav="profile">
      <PageTitle to={listHref}>Chi tiết ưu đãi</PageTitle>

      <div className="card status-card" style={usable ? undefined : { opacity: 0.6 }}>
        <div className="big-status red">
          <Icon name="gift" />
        </div>
        {offer.tagline && <p className="eyebrow">{offer.tagline}</p>}
        <h1>{offer.headline}</h1>
        {offer.subtitle && <p className="muted">{offer.subtitle}</p>}
        {offer.description && <p className="muted small">{offer.description}</p>}
        {!usable && <span className="pill amber mb16">{STATE_LABEL[offer.state] ?? 'Không khả dụng'}</span>}
        <div className="coupon">{offer.code}</div>
      </div>

      <div className="card">
        <h3>Điều kiện áp dụng</h3>
        <ul className="terms">
          {offer.conditions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>

      <button className="btn" disabled={!usable} onClick={copy}>
        Sao chép mã ưu đãi
      </button>
      {usable && (
        <div className="mt8">
          <Link
            className="btn secondary"
            to={`/s/${storeSlug}/cart${q}`}
            onClick={() => storeSlug && setDeclaredVoucher(storeSlug, offer.code)}
          >
            Dùng mã này ở giỏ món
          </Link>
        </div>
      )}
      <p className="micro-foot">{offer.note}</p>
    </Shell>
  );
}
