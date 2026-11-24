import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Khoa tam dang nhap, trong bo nho (1 instance API), 2 tang:
 *  1) theo (IP + tai khoan): sai MAX_FAILS lan trong WINDOW_MS thi khoa LOCK_MS. Khoa KHONG bi keo dai boi cac lan
 *     thu trong luc dang khoa (lan thu luc khoa bi tu choi truoc khi cham mat khau va khong duoc dem).
 *     Nguoi la o IP khac khong the khoa chu quan (khoa gan voi IP cua ho).
 *  2) tran theo IP chung (moi tai khoan): IP_MAX_FAILS lan sai trong WINDOW_MS thi khoa IP do LOCK_MS
 *     (chan do mat khau lan tai khoan tu mot IP).
 * Danh doi: nguoi cung IP (cung wifi/NAT) voi ke tan cong van co the lam chu quan bi khoa tren IP do; dang nhap tu IP khac
 * thi khong anh huong. Tan cong phan tan nhieu IP khong bi chan o day (can fail2ban/CAPTCHA o ria mang).
 * Dang nhap dung xoa dem cua cap (IP + tai khoan) do, KHONG xoa dem tran IP.
 */
export const MAX_FAILS = 5;
export const IP_MAX_FAILS = 30;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 5 * 60 * 1000;

interface Rec {
  fails: number[];
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly pairs = new Map<string, Rec>();
  private readonly ips = new Map<string, Rec>();

  static pairKey(login: string, ip?: string): string {
    return `${ip ?? 'unknown'}|${login.trim().toLowerCase()}`;
  }

  /** Nem 429 neu cap (IP + tai khoan) hoac IP dang bi khoa. Khong ghi nhan gi them. */
  assertNotLocked(login: string, ip?: string, now = Date.now()): void {
    const until = Math.max(
      this.pairs.get(LoginThrottle.pairKey(login, ip))?.lockedUntil ?? 0,
      this.ips.get(ip ?? 'unknown')?.lockedUntil ?? 0,
    );
    if (until > now) {
      const wait = Math.ceil((until - now) / 1000);
      throw new HttpException(
        { statusCode: 429, message: `Bạn đã nhập sai quá nhiều lần, vui lòng thử lại sau ${wait} giây`, error: 'Too Many Requests', retryAfter: wait },
        HttpStatus.TOO_MANY_REQUESTS,
        { cause: { retryAfter: wait } },
      );
    }
  }

  recordFail(login: string, ip?: string, now = Date.now()): void {
    this.bump(this.pairs, LoginThrottle.pairKey(login, ip), MAX_FAILS, now);
    this.bump(this.ips, ip ?? 'unknown', IP_MAX_FAILS, now);
    if (this.pairs.size > 5000 || this.ips.size > 5000) this.sweep(now);
  }

  recordSuccess(login: string, ip?: string): void {
    this.pairs.delete(LoginThrottle.pairKey(login, ip));
  }

  private bump(map: Map<string, Rec>, key: string, max: number, now: number): void {
    const rec = map.get(key) ?? { fails: [], lockedUntil: 0 };
    // dang khoa: khong dem them, khong gia han
    if (rec.lockedUntil > now) return;
    rec.fails = rec.fails.filter((t) => now - t < WINDOW_MS);
    rec.fails.push(now);
    if (rec.fails.length >= max) {
      rec.lockedUntil = now + LOCK_MS;
      rec.fails = [];
    }
    map.set(key, rec);
  }

  private sweep(now: number): void {
    for (const m of [this.pairs, this.ips]) {
      for (const [k, r] of m) if (r.lockedUntil < now && r.fails.every((t) => now - t >= WINDOW_MS)) m.delete(k);
    }
  }
}
