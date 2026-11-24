/**
 * Gioi han tan suat don gian trong bo nho (cua so truot), khong can thu vien.
 * Chi dung duoc voi 1 instance API (giong realtime bus hien tai).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Ghi nhan 1 lan goi; tra ve so giay phai cho neu vuot gioi han, null neu duoc phep */
  hit(key: string, now = Date.now()): number | null {
    this.sweep(now);
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000));
    }
    arr.push(now);
    this.hits.set(key, arr);
    return null;
  }

  /** Don khoa het han de Map khong phinh to */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, arr] of this.hits) {
      if (arr.length === 0 || now - arr[arr.length - 1] >= this.windowMs) this.hits.delete(k);
    }
  }
}
