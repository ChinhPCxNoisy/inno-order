import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Adaptor nha cung cap bien dong so du (tang 2). MOI tich hop nha cung cap that PHAI nam sau interface nay
 * (1 file adaptor rieng, dang ky o ProviderRegistry). Hien chi co MANUAL va MOCK; khong co nha cung cap that nao.
 */
export interface NormalizedBankTxn {
  providerTxnId: string;
  /** Tai khoan nhan (de chong payload cua tai khoan khac chui vao token nay) */
  accountNumber: string;
  /** Dong, so nguyen duong */
  amount: number;
  direction: 'IN' | 'OUT';
  content: string;
  transferredAt: Date;
  bankReference?: string;
  counterpartyName?: string;
  counterpartyAccountMasked?: string;
  raw: unknown;
}

export interface BankFeedProvider {
  readonly key: string;
  /** Co nhan webhook khong (MANUAL: khong) */
  readonly supportsWebhook: boolean;
  /** Kiem tra chu ky/token tu header + rawBody. Nem loi (401) neu sai. */
  verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | undefined>; secret: string }): void;
  /** Chuyen payload cua doi tac ve dang chuan (co the nhieu giao dich) */
  parseWebhook(body: unknown): NormalizedBankTxn[];
  /** Noi dung HTTP doi tac mong doi de ngung goi lai */
  ackResponse(): { status: number; body: unknown };
}

/** Khong co webhook: chi tao QR va thu ngan xac nhan tay */
export class ManualProvider implements BankFeedProvider {
  readonly key = 'MANUAL';
  readonly supportsWebhook = false;
  verifyWebhook(): void {
    throw new BadRequestException('Tài khoản này chỉ dùng xác nhận tay, không nhận webhook');
  }
  parseWebhook(): NormalizedBankTxn[] {
    return [];
  }
  ackResponse() {
    return { status: 200, body: { ok: true } };
  }
}

/** Cac nonce da thay (chong replay trong cua so thoi gian, 1 instance API) */
const seenNonces = new Map<string, number>();
const NONCE_TTL_MS = 10 * 60_000;
export const MAX_SKEW_MS = 5 * 60_000;

/**
 * MOCK cho test/pilot noi bo. Chu ky: header `x-signature: sha256=<hex>` = HMAC-SHA256(secret, `${ts}.${nonce}.${rawBody}`),
 * kem `x-timestamp` (epoch ms) va `x-nonce` (duy nhat moi lan gui). Body:
 * { "transactions": [ { "id","accountNumber","amount","direction":"IN|OUT","content","transferredAt"(ISO),"reference"? ,"senderName"?,"senderAccount"? } ] }
 */
export class MockProvider implements BankFeedProvider {
  readonly key = 'MOCK';
  readonly supportsWebhook = true;

  static sign(secret: string, ts: string, nonce: string, rawBody: string | Buffer): string {
    return createHmac('sha256', secret).update(`${ts}.${nonce}.`).update(rawBody).digest('hex');
  }

  verifyWebhook({ rawBody, headers, secret }: { rawBody: Buffer; headers: Record<string, string | undefined>; secret: string }): void {
    const sig = (headers['x-signature'] ?? '').replace(/^sha256=/, '');
    const ts = headers['x-timestamp'] ?? '';
    const nonce = headers['x-nonce'] ?? '';
    const fail = () => new UnauthorizedException('Chữ ký không hợp lệ');
    if (!sig || !ts || !nonce || nonce.length > 100 || !/^[0-9a-fA-F]{64}$/.test(sig)) throw fail();
    const expected = Buffer.from(MockProvider.sign(secret, ts, nonce, rawBody), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw fail();
    // Chong replay: lech gio qua 5 phut bi tu choi, nonce da dung bi tu choi
    const t = Number(ts);
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > MAX_SKEW_MS) {
      throw new UnauthorizedException('Yêu cầu quá hạn hoặc sai đồng hồ');
    }
    const now = Date.now();
    for (const [k, exp] of seenNonces) if (exp < now) seenNonces.delete(k);
    if (seenNonces.has(nonce)) throw new UnauthorizedException('Yêu cầu bị lặp lại');
    seenNonces.set(nonce, now + NONCE_TTL_MS);
  }

  parseWebhook(body: unknown): NormalizedBankTxn[] {
    const list = (body as { transactions?: unknown[] } | null)?.transactions;
    if (!Array.isArray(list)) throw new BadRequestException('Payload không hợp lệ');
    const out: NormalizedBankTxn[] = [];
    for (const t of list.slice(0, 100) as Record<string, unknown>[]) {
      const amount = Number(t.amount);
      const id = typeof t.id === 'string' ? t.id.slice(0, 100) : '';
      if (!id || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
        throw new BadRequestException('Giao dịch thiếu mã hoặc số tiền không hợp lệ');
      }
      const at = t.transferredAt ? new Date(String(t.transferredAt)) : new Date();
      out.push({
        providerTxnId: id,
        accountNumber: String(t.accountNumber ?? ''),
        amount,
        direction: t.direction === 'OUT' ? 'OUT' : 'IN',
        content: String(t.content ?? '').slice(0, 500),
        transferredAt: Number.isNaN(at.getTime()) ? new Date() : at,
        bankReference: typeof t.reference === 'string' ? t.reference.slice(0, 100) : undefined,
        counterpartyName: typeof t.senderName === 'string' ? t.senderName.slice(0, 100) : undefined,
        // Chi giu 4 so cuoi cua tai khoan nguoi chuyen
        counterpartyAccountMasked: typeof t.senderAccount === 'string' ? `****${t.senderAccount.slice(-4)}` : undefined,
        raw: t,
      });
    }
    return out;
  }

  ackResponse() {
    return { status: 200, body: { success: true } };
  }
}

export class ProviderRegistry {
  private readonly map = new Map<string, BankFeedProvider>();
  constructor(providers: BankFeedProvider[]) {
    for (const p of providers) this.map.set(p.key, p);
  }
  get(key: string): BankFeedProvider | undefined {
    return this.map.get(key.toUpperCase());
  }
  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

export const defaultProviders = () => new ProviderRegistry([new ManualProvider(), new MockProvider()]);
