import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { useUi } from './ui';
import { ApiError, errMsg, publicApi } from '../api';
import { copyText } from '../clipboard';
import { fmtMoney, fmtTime } from '../format';
import { qrSvg } from '../qr';
import type { PublicQr, PublicQrStatus } from '../types';

const POLL_MS = 2000;

/**
 * Khach tu tra bang VietQR (chi hien khi quan bat). Man chua co thiet ke duyet: dung card, pill, info-list, btn co san.
 * He thong KHONG coi la da tra cho den khi tien ve hoac thu ngan xac nhan; man Hoa don chuyen "Da thanh toan" nho poll.
 */
export default function QrPay({ token, onSettled }: { token: string; onSettled: () => void }) {
  const { toast, message } = useUi();
  const [qr, setQr] = useState<PublicQr | null>(null);
  const [status, setStatus] = useState<PublicQrStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await publicApi.createQr(token);
      setQr(r);
      setStatus(null);
    } catch (e) {
      setErr(errMsg(e));
      // 403/409: quan khong bat nua hoac hoa don da dong; bill poll se cap nhat
      if (e instanceof ApiError && e.status === 409) onSettled();
    } finally {
      setBusy(false);
    }
  };

  // Poll trang thai 2 giay den khi ket thuc (PAID/het han/huy/hoa don doi)
  const intentId = qr?.intentId;
  const live = !status || status.status === 'PENDING' || status.status === 'PARTIALLY_PAID';
  useEffect(() => {
    if (!intentId || !live) return;
    let cancelled = false;
    let timer: number | undefined;
    let fails = 0;
    const tick = () => {
      publicApi
        .getQrStatus(intentId)
        .then((s) => {
          if (cancelled) return;
          fails = 0;
          setStatus(s);
          if (s.status === 'PAID') onSettled();
          else if (s.status === 'PENDING' || s.status === 'PARTIALLY_PAID') timer = window.setTimeout(tick, POLL_MS);
        })
        .catch(() => {
          if (cancelled) return;
          fails += 1;
          timer = window.setTimeout(tick, Math.min(15000, POLL_MS * (fails + 1)));
        });
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, live]);

  // Dem nguoc han dung moi giay (chi khi dang cho)
  useEffect(() => {
    if (!qr || !live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [qr, live]);

  const svg = useMemo(() => {
    if (!qr) return null;
    try {
      return qrSvg(qr.qrPayload, 220);
    } catch {
      return null;
    }
  }, [qr]);

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) toast(`Đã sao chép ${label}`);
    else message(label, `${text}. Bạn có thể chọn và sao chép nội dung này.`);
  };

  if (!qr) {
    return (
      <>
        <button className="btn" disabled={busy} onClick={create}>
          <Icon name="wallet" /> {busy ? 'Đang tạo mã…' : 'Thanh toán bằng mã QR'}
        </button>
        {err && (
          <p className="error-text" role="alert">
            {err}
          </p>
        )}
      </>
    );
  }

  const st = status?.status ?? 'PENDING';
  const remainingMs = new Date(qr.expiresAt).getTime() - now;
  const mm = Math.max(0, Math.floor(remainingMs / 60000));
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000));
  const shownRemaining = status ? status.remaining : qr.remaining;
  const dead = st === 'EXPIRED' || st === 'CANCELLED' || st === 'SUPERSEDED';

  return (
    <div className="card">
      <div className="row between mb16">
        <h3>Thanh toán bằng mã QR</h3>
        {st === 'PAID' ? (
          <span className="pill green">
            <Icon name="check" size="sm" /> Đã nhận
          </span>
        ) : dead ? (
          <span className="pill amber">{st === 'EXPIRED' ? 'Mã hết hạn' : 'Mã không dùng được'}</span>
        ) : (
          <span className="pill amber">
            <Icon name="clock" size="sm" /> Đang chờ
          </span>
        )}
      </div>

      {st === 'PAID' ? (
        <div className="center">
          <div className="big-status">
            <Icon name="check" />
          </div>
          <h2>Đã nhận thanh toán</h2>
          <p className="muted small mb0">Thanh toán sẽ được quán xác nhận trên hóa đơn.</p>
        </div>
      ) : (
        <>
          {!dead && (
            <div className="center">
              {svg ? (
                <div
                  className="qr-box"
                  role="img"
                  aria-label="Mã QR chuyển khoản"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <p className="small muted">Chưa hiển thị được mã QR. Bạn có thể chuyển khoản tay theo thông tin bên dưới.</p>
              )}
              <p className="tiny muted mb0">Lưu ảnh màn hình rồi quét từ thư viện ảnh trong app ngân hàng, hoặc chuyển khoản tay.</p>
            </div>
          )}

          <dl className="info-list">
            <div>
              <dt>Số tiền</dt>
              <dd className="price">{fmtMoney(qr.amount)}</dd>
            </div>
            <div>
              <dt>Ngân hàng</dt>
              <dd>{qr.bank.bankName}</dd>
            </div>
            <div>
              <dt>Chủ tài khoản</dt>
              <dd>{qr.bank.accountName}</dd>
            </div>
            <div>
              <dt>Số tài khoản</dt>
              <dd>{qr.bank.accountNumber}</dd>
            </div>
            <div>
              <dt>Nội dung</dt>
              <dd>{qr.code}</dd>
            </div>
            <div>
              <dt>
                <Icon name="clock" size="sm" /> Hạn dùng
              </dt>
              <dd>{dead ? `đến ${fmtTime(qr.expiresAt)}` : `${mm}:${String(ss).padStart(2, '0')}`}</dd>
            </div>
          </dl>

          {st === 'PARTIALLY_PAID' && (
            <div className="notice-box mt16" role="status">
              Còn thiếu {fmtMoney(shownRemaining)}, vui lòng chuyển thêm hoặc gọi nhân viên.
            </div>
          )}
          {st === 'PARTIALLY_PAID' && (
            <div className="mt16">
              <button className="btn secondary" disabled={busy} onClick={create}>
                {busy ? 'Đang tạo mã…' : `Tạo mã mới cho số còn lại ${fmtMoney(shownRemaining)}`}
              </button>
            </div>
          )}
          {st === 'EXPIRED' && (
            <div className="notice-box mt16" role="status">
              Mã đã hết hạn, vui lòng tạo mã mới.
            </div>
          )}
          {st === 'SUPERSEDED' && (
            <div className="notice-box mt16" role="status">
              Hóa đơn đã thay đổi, vui lòng tạo lại mã.
            </div>
          )}
          {st === 'CANCELLED' && (
            <div className="notice-box mt16" role="status">
              Mã đã được quán hủy, vui lòng tạo mã mới hoặc nhờ nhân viên hỗ trợ.
            </div>
          )}

          {dead ? (
            <div className="mt16">
              <button className="btn" disabled={busy} onClick={create}>
                {busy ? 'Đang tạo mã…' : 'Tạo mã mới'}
              </button>
              {err && (
                <p className="error-text" role="alert">
                  {err}
                </p>
              )}
            </div>
          ) : (
            <div className="mt16 error-actions">
              <button className="btn secondary" onClick={() => copy(qr.bank.accountNumber, 'số tài khoản')}>
                Sao chép số tài khoản
              </button>
              <button className="btn secondary" onClick={() => copy(qr.code, 'nội dung chuyển khoản')}>
                Sao chép nội dung
              </button>
            </div>
          )}
          <p className="tiny muted center mt16 mb0">Thanh toán sẽ được quán xác nhận.</p>
        </>
      )}
    </div>
  );
}
