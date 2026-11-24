import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import Shell from './Shell';
import ErrorState from './StateView';
import { lastStoreSlug } from '../session';

const SUBPATHS = ['/cart', '/bill', '/orders', '/voucher', '/profile', '/support'];

/**
 * Duong dan khong co /s/{slug} (vd link cu "/cart?t=R11"): co ma ban thi dung quan gan nhat tren thiet bi,
 * khong co thi bao "chua xac dinh duoc ban" (khong nhay sang quan demo). Khong co ma ban thi ve man chao nhu cu.
 */
export default function NoStoreRedirect() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const t = params.get('t');
  if (!t) return <Navigate to="/" replace />;
  const slug = lastStoreSlug();
  if (!slug) {
    return (
      <Shell>
        <ErrorState kind="qr" />
      </Shell>
    );
  }
  const sub = SUBPATHS.includes(pathname.replace(/\/$/, '')) ? pathname.replace(/\/$/, '') : '';
  return <Navigate to={`/s/${slug}${sub}?t=${encodeURIComponent(t)}`} replace />;
}
