import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import { PageTitle, useTable } from './Shell';
import { useUi } from './ui';
import { ApiError } from '../api';

/** Khoi trang thai trong (thiet ke v2: gio trong, chua co don, chua co uu dai...) */
export function EmptyBody({
  icon,
  title,
  text,
  children,
}: {
  icon: IconName;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="big-status red">
        <Icon name={icon} />
      </div>
      <h1>{title}</h1>
      <p>{text}</p>
      {children}
    </div>
  );
}

export type ErrorKind = 'qr' | 'network' | 'closed';

/** Bo dau + hoa thuong de so khop thong bao cua backend ("Quán đang tạm ngừng hoạt động") */
const plain = (s: string) =>
  s
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

/** Suy ra loai loi tu phan hoi API: ban khong ton tai, quan tam dung, mat ket noi */
export function errorKind(e: unknown): ErrorKind {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'network';
    if (e.status === 404) return 'qr';
    if (e.status === 400 && /tam ngung|tam dung/.test(plain(e.message))) return 'closed';
  }
  return 'network';
}

/** Man hinh loi (thiet ke v2, man 16): ma QR khong hop le, mat ket noi, quan tam dung nhan don */
export default function ErrorState({ kind, onRetry }: { kind: ErrorKind; onRetry?: () => void }) {
  const { storeSlug, tableCode } = useParams<{ storeSlug: string; tableCode?: string }>();
  const navigate = useNavigate();
  const { table: queryTable, q } = useTable();
  const { message } = useUi();
  // Ma ban lay tu ?t= hoac tu duong dan QR /s/{slug}/t/{ban}
  const table = queryTable ?? tableCode ?? null;
  const tableQ = table ? `?t=${encodeURIComponent(table)}` : q;
  const menuHref = storeSlug ? `/s/${storeSlug}${tableQ}` : '/';
  const supportHref = storeSlug && table ? `/s/${storeSlug}/support${tableQ}` : null;

  useEffect(() => {
    document.title = 'Trạng thái lỗi · InnoOrder';
  }, []);

  // Ma QR/ban sai thi quay lai thuc don se loi lai: ve trang truoc, khong co thi ve trang chu
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;
  const back =
    kind === 'qr' ? (
      <PageTitle to="/" onBack={canGoBack ? () => navigate(-1) : undefined}>
        Cần kiểm tra lại
      </PageTitle>
    ) : (
      <PageTitle to={menuHref}>Cần kiểm tra lại</PageTitle>
    );

  const askStaff = () =>
    message('Nhờ nhân viên hỗ trợ', 'Vui lòng vẫy nhân viên của quán, họ sẽ giúp bạn vào đúng bàn.');

  if (kind === 'qr') {
    return (
      <>
        {back}
        <EmptyBody
          icon="qr"
          title="Chưa xác định được bàn"
          text="Mã QR có thể không hợp lệ hoặc đã thay đổi. Vui lòng quét lại mã trên bàn hoặc nhờ nhân viên hỗ trợ."
        >
          <button
            className="btn"
            onClick={() =>
              message(
                'Quét lại mã tại bàn',
                'Hãy thoát khỏi trang này và dùng Zalo quét lại mã QR dán trên bàn của bạn.',
              )
            }
          >
            Quét lại mã tại bàn
          </button>
          {supportHref ? (
            <Link className="btn secondary" to={supportHref}>
              Nhờ nhân viên hỗ trợ
            </Link>
          ) : (
            <button className="btn secondary" onClick={askStaff}>
              Nhờ nhân viên hỗ trợ
            </button>
          )}
        </EmptyBody>
      </>
    );
  }

  if (kind === 'closed') {
    return (
      <>
        {back}
        <EmptyBody
          icon="clock"
          title="Quán tạm dừng nhận đơn"
          text="Bạn vẫn có thể xem thực đơn. Vui lòng liên hệ nhân viên để biết khi nào quán nhận món trở lại."
        >
          {/* Dang o man tai du lieu thi "Xem thực đơn" = tai lai (quan mo lai thi vao thuc don) */}
          {onRetry ? (
            <button className="btn secondary" onClick={onRetry}>
              Xem thực đơn
            </button>
          ) : (
            <Link className="btn secondary" to={menuHref}>
              Xem thực đơn
            </Link>
          )}
          {supportHref ? (
            <Link className="text-btn" to={supportHref}>
              Liên hệ nhân viên
            </Link>
          ) : (
            <button
              className="text-btn"
              onClick={() => message('Liên hệ nhân viên', 'Vui lòng vẫy nhân viên của quán để được hỗ trợ.')}
            >
              Liên hệ nhân viên
            </button>
          )}
        </EmptyBody>
      </>
    );
  }

  return (
    <>
      {back}
      <EmptyBody
        icon="wifi"
        title="Chưa tải được dữ liệu"
        text="Kết nối bị gián đoạn. Giỏ món vẫn được giữ lại, bạn có thể thử lại mà không lo gửi trùng đơn."
      >
        <div className="error-actions">
          {onRetry && (
            <button className="btn" onClick={onRetry}>
              Thử lại
            </button>
          )}
          <Link className="btn secondary" to={menuHref}>
            Về thực đơn
          </Link>
        </div>
      </EmptyBody>
    </>
  );
}
