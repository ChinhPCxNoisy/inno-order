import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Shell, { Loading, PageTitle, useTable } from '../components/Shell';
import ErrorState, { EmptyBody } from '../components/StateView';
import { publicApi } from '../api';
import { fmtMoney } from '../format';
import type { PublicOffer } from '../types';

/** Chu trong o ma ("10%", "50K") */
export function offerBadge(o: Pick<PublicOffer, 'discountType' | 'value'>): string {
  if (o.discountType === 'PERCENT') return `${o.value}%`;
  return o.value >= 1000 && o.value % 1000 === 0 ? `${o.value / 1000}K` : fmtMoney(o.value);
}

/** Uu dai cua quan (thiet ke v2, man 12): du lieu that tu GET /public/stores/:slug/offers. */
export default function Voucher() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { q } = useTable();
  const [offers, setOffers] = useState<PublicOffer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => {
    setFailed(false);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!storeSlug) return;
    let cancelled = false;
    publicApi
      .listOffers(storeSlug)
      .then((o) => {
        if (!cancelled) setOffers(o);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, tick]);

  if (failed) {
    return (
      <Shell nav="profile">
        <ErrorState kind="network" onRetry={reload} />
      </Shell>
    );
  }

  return (
    <Shell title="Ưu đãi của quán" nav="profile">
      <PageTitle to={`/s/${storeSlug}/profile${q}`}>Ưu đãi của quán</PageTitle>
      {offers === null ? (
        <Loading text="Đang tải ưu đãi…" />
      ) : offers.length === 0 ? (
        <EmptyBody
          icon="gift"
          title="Ưu đãi đang được chuẩn bị"
          text="Quán sẽ cập nhật chương trình mới tại đây. Hẹn bạn ghé lại!"
        >
          <Link className="btn" to={`/s/${storeSlug}${q}`}>
            Về thực đơn
          </Link>
        </EmptyBody>
      ) : (
        <>
          {offers.map((o) => (
            <Link className="card offer" key={o.id} to={`/s/${storeSlug}/offer/${o.id}${q}`}>
              <div className="offer-code">{offerBadge(o)}</div>
              <div className="grow">
                {o.tagline && <span className="eyebrow">{o.tagline}</span>}
                <h2>{o.headline}</h2>
                <p className="tiny muted mb0">{o.summary} Xem đầy đủ điều kiện áp dụng.</p>
              </div>
              <Icon name="next" />
            </Link>
          ))}
          <p className="micro-foot">Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ món.</p>
        </>
      )}
    </Shell>
  );
}
