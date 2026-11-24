import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RateLimiter } from '../common/utils/rate-limiter';

/**
 * Gioi han rieng cho bao gia / kiem tra ma (khach bam +/- lien tuc, nhieu ban chung WiFi nen khong dung xo doc chung 60/phut):
 *  - theo (IP + quan): 300 lan/phut khi KHONG co ma uu dai (chi doc thuc don, khong dung de do ma);
 *  - request CO ma uu dai: them xo 180 lan/phut theo (IP + quan) de van han che do ma;
 *  - tran rong theo IP: 1500 lan/phut.
 * Vuot gioi han -> 429 kem Retry-After (RetryAfterFilter).
 */
const perStore = new RateLimiter(300, 60_000);
const perStoreCode = new RateLimiter(180, 60_000);
const perIp = new RateLimiter(1500, 60_000);

@Injectable()
export class PublicQuoteThrottleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string; params?: Record<string, string>; body?: { code?: unknown } }>();
    const ip = req.ip ?? 'unknown';
    const slug = String(req.params?.slug ?? '').slice(0, 64);
    const hasCode = typeof req.body?.code === 'string' && req.body.code.trim() !== '';
    const wait =
      perStore.hit(`q|${ip}|${slug}`) ?? (hasCode ? perStoreCode.hit(`c|${ip}|${slug}`) : null) ?? perIp.hit(`i|${ip}`);
    if (wait !== null) {
      throw new HttpException(`Bạn thao tác quá nhanh, vui lòng thử lại sau ${wait} giây`, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
