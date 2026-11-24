import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RateLimiter } from '../utils/rate-limiter';

/**
 * Chong spam don QR cong khai: toi da 10 don / phut (nhieu thiet bi cung ban dung chung 1 xo) theo (IP + slug quan + ma ban).
 * Chay truoc validation nen doc thang req.body (da duoc parse JSON).
 */
const limiter = new RateLimiter(10, 60_000);
/** Tran rieng theo IP + quan (nhieu ban cung WiFi): chong spam tao don hang loat ma khong chan khach that */
const storeLimiter = new RateLimiter(120, 60_000);

@Injectable()
export class PublicOrderThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      params?: Record<string, string>;
      body?: { tableCode?: unknown; tableId?: unknown };
    }>();
    const table = String(req.body?.tableCode ?? req.body?.tableId ?? '')
      .slice(0, 40)
      .toUpperCase();
    const key = `${req.ip ?? 'unknown'}|${req.params?.slug ?? ''}|${table}`;
    const wait = limiter.hit(key) ?? storeLimiter.hit(`${req.ip ?? 'unknown'}|${req.params?.slug ?? ''}`);
    if (wait !== null) {
      throw new HttpException(
        `Bạn gửi đơn quá nhanh, vui lòng thử lại sau ${wait} giây hoặc gọi nhân viên`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
