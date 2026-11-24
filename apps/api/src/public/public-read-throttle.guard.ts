import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RateLimiter } from '../common/utils/rate-limiter';

/**
 * Gioi han doc cong khai. Khach trong quan dung chung WiFi (cung IP NAT) nen KHONG gioi han chung theo IP:
 *  - theo (IP + tai nguyen: token phien / id don / id QR / slug): 60 lan/phut -> moi ban/phien co "xo" rieng;
 *  - tran rong theo IP: 600 lan/phut (chong quet hang loat token/id; ~10 thiet bi mo man hinh 8 giay/lan van du dung).
 */
const perResource = new RateLimiter(60, 60_000);
const perIp = new RateLimiter(600, 60_000);

@Injectable()
export class PublicReadThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string; params?: Record<string, string> }>();
    const ip = req.ip ?? 'unknown';
    const p = req.params ?? {};
    const res = String(p.token ?? p.id ?? p.slug ?? '').slice(0, 64);
    const wait = perResource.hit(`r|${ip}|${res}`) ?? perIp.hit(`i|${ip}`);
    if (wait !== null) {
      throw new HttpException(
        `Bạn thao tác quá nhanh, vui lòng thử lại sau ${wait} giây`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
