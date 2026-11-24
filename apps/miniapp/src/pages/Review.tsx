import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Img from '../components/Img';
import Shell, { Loading, PageTitle, PoweredBy, useTable } from '../components/Shell';
import ErrorState from '../components/StateView';
import { errMsg, publicApi } from '../api';
import { getCustomer, orderThumb, saveCustomer } from '../session';
import { useBrand } from '../useBrand';
import { getZaloUserId } from '../zalo';
import type { PublicOrderTracking, ReviewStatus } from '../types';

const MAX_COMMENT = 500;
const LABELS = ['', 'Rất chưa hài lòng', 'Chưa hài lòng', 'Bình thường', 'Hài lòng', 'Rất hài lòng'];
const TAGS_LOW = ['Thời gian chờ lâu', 'Cần hỗ trợ nhanh hơn', 'Thái độ phục vụ', 'Góp ý khác'];
const TAGS_HIGH = ['Thân thiện', 'Phục vụ nhanh', 'Hỗ trợ nhiệt tình', 'Tư vấn rõ ràng'];

/** Danh gia phuc vu (thiet ke v2, man 08) va man cam on (man 09) — module staff_rating. */
export default function Review() {
  const { storeSlug, orderId } = useParams<{ storeSlug: string; orderId: string }>();
  const { q } = useTable();
  const brand = useBrand(storeSlug);

  const [order, setOrder] = useState<PublicOrderTracking | null>(null);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ rating: number; tags: string[]; staffName: string | null } | null>(null);

  const orderHref = `/s/${storeSlug}/order/${orderId}${q}`;
  const menuHref = `/s/${storeSlug}${q}`;

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoadError(null);
    Promise.all([publicApi.trackOrder(orderId), publicApi.getReviewStatus(orderId)])
      .then(([o, s]) => {
        if (cancelled) return;
        setOrder(o);
        setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, tick]);

  if (loadError) {
    return (
      <Shell>
        <ErrorState kind="network" onRetry={() => setTick((t) => t + 1)} />
      </Shell>
    );
  }
  if (!order || !status) {
    return (
      <Shell title="Đánh giá phục vụ">
        <Loading />
      </Shell>
    );
  }

  // Cam on sau khi gui, hoac don khong con danh gia duoc (tat module / da danh gia / chua thanh toan)
  const unavailable = !status.enabled || status.reviewed || !status.eligible;
  if (done || unavailable) {
    const already = !done && Boolean(status.reviewed);
    const shown = done ?? (already ? { rating: status.rating ?? 0, tags: status.tags ?? [], staffName: null } : null);
    return (
      <Shell title="Cảm ơn đánh giá">
        <PageTitle to={orderHref}>{done ? 'Đã gửi đánh giá' : 'Đánh giá phục vụ'}</PageTitle>
        <div className="empty-state">
          <div className={`big-status${done || already ? '' : ' red'}`}>
            <Icon name={done || already ? 'check' : 'alert'} />
          </div>
          <p className="eyebrow">{done ? 'Cảm ơn bạn đã chia sẻ' : already ? 'Bạn đã đánh giá đơn này' : 'Chưa thể đánh giá'}</p>
          <h1>
            {done || already ? (
              <>
                Góp ý nhỏ.
                <br />
                Trải nghiệm tốt hơn.
              </>
            ) : (
              'Đơn này chưa đánh giá được'
            )}
          </h1>
          <p>
            {done
              ? `Quán đã nhận được đánh giá của bạn${done.staffName ? ` cho ${done.staffName}` : ''} và sẽ tiếp tục cải thiện chất lượng phục vụ.`
              : already
                ? 'Cảm ơn bạn đã dành thời gian góp ý cho quán.'
                : 'Đánh giá chỉ mở sau khi đơn được thanh toán và quán bật tính năng này.'}
          </p>
          {shown && shown.rating > 0 && (
            <div className="card">
              <div style={{ fontSize: 25, color: '#f0ab32' }}>{'★'.repeat(shown.rating)}</div>
              {shown.tags.length > 0 && <p className="small mt8 mb0">{shown.tags.join(' · ')}</p>}
            </div>
          )}
          <Link className="btn" to={menuHref}>
            Về thực đơn
          </Link>
          <p className="micro-foot">Hẹn gặp lại bạn tại {order.storeName}.</p>
        </div>
      </Shell>
    );
  }

  const pickRating = (n: number) => {
    setRating(n);
    setTags([]);
  };

  const submit = async () => {
    if (!orderId || !rating || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Gan dinh danh Zalo "am tham" neu co (chong nhan vien tu danh gia)
      let zaloUserId = getCustomer().zaloUserId;
      if (!zaloUserId) {
        const fetched = await getZaloUserId();
        if (fetched) {
          zaloUserId = fetched;
          saveCustomer({ zaloUserId: fetched });
        }
      }
      const res = await publicApi.submitReview(orderId, {
        rating,
        comment: comment.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        zaloUserId,
      });
      setDone({ rating, tags, staffName: res.staffName });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const tagList = rating <= 3 ? TAGS_LOW : TAGS_HIGH;

  return (
    <Shell
      title="Đánh giá phục vụ"
      dock={
        <>
          <button className="btn" disabled={!rating || busy} onClick={submit}>
            {busy ? 'Đang gửi…' : 'Gửi đánh giá'}
          </button>
          <Link className="text-btn" to={orderHref} replace>
            Để sau
          </Link>
        </>
      }
    >
      <PageTitle to={orderHref}>Đánh giá phục vụ</PageTitle>

      <div className="review-summary">
        <Img
          src={orderThumb(orderId, brand)}
          alt=""
          fallbackChar={order.storeName.charAt(0).toUpperCase()}
          fallbackClassName="food-img"
        />
        <div>
          <strong>{order.storeName}</strong>
          <div className="tiny muted">
            Đơn #{order.orderNumber} · Bàn {order.table.code}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="center">
          <div className="big-status red">
            <Icon name="smile" />
          </div>
          <h2>
            {status.staffName ? (
              <>Bạn hài lòng với {status.staffName}?</>
            ) : (
              <>
                Bạn hài lòng với
                <br />
                phục vụ hôm nay?
              </>
            )}
          </h2>
          <p className="muted small">Đánh giá thái độ và sự hỗ trợ của nhân viên.</p>
          <div className="stars" role="group" aria-label="Chọn số sao">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`star${n <= rating ? ' selected' : ''}`}
                aria-label={`${n} sao`}
                aria-pressed={n === rating}
                onClick={() => pickRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <p className="small muted">{rating ? LABELS[rating] : 'Chạm để chọn số sao'}</p>
        </div>

        <div className="divider" />
        {rating > 0 && (
          <>
            <p className="label">Điều gì bạn muốn chia sẻ?</p>
            <div className="chips">
              {tagList.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    className={`chip${on ? ' selected' : ''}`}
                    aria-pressed={on}
                    onClick={() => setTags((cur) => (on ? cur.filter((x) => x !== t) : [...cur, t]))}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="mt24">
          <label className="label" htmlFor="review-note">
            Nhận xét thêm <span className="tiny muted">(không bắt buộc)</span>
          </label>
          <textarea
            id="review-note"
            maxLength={MAX_COMMENT}
            value={comment}
            placeholder="Ý kiến của bạn giúp quán phục vụ tốt hơn..."
            style={{ minHeight: 110 }}
            onChange={(e) => setComment(e.target.value)}
          />
          <p className="tiny muted" style={{ textAlign: 'right', margin: '5px 0 0' }}>
            {comment.length}/{MAX_COMMENT}
          </p>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
      <PoweredBy />
    </Shell>
  );
}
