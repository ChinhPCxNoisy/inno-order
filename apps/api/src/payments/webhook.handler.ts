import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PaymentsService } from './payments.service';

/**
 * Xu ly webhook ngan hang cong khai, theo dung thu tu dac ta 01 muc 5.3:
 * tra tai khoan theo token -> xac thuc chu ky (+ chong replay) -> parse -> ghi so (idempotent) -> khop -> ack.
 * Loi khi khop khong lam webhook tra 5xx sau khi da ghi so.
 */
@Injectable()
export class WebhookHandler {
  private readonly logger = new Logger(WebhookHandler.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async handle(
    providerKey: string,
    token: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    body: unknown,
    ip?: string,
  ) {
    const account = await this.payments.accountByToken(token);
    const provider = this.payments.providerOf(providerKey);
    if (!account || !provider || account.provider !== provider.key || !account.isActive || !provider.supportsWebhook) {
      this.logger.warn(`Webhook không hợp lệ từ ${ip ?? '?'} (provider=${providerKey})`);
      throw new NotFoundException();
    }
    const secret = this.payments.secretOf(account);
    if (!secret) throw new NotFoundException();
    try {
      provider.verifyWebhook({ rawBody, headers, secret });
    } catch (e) {
      await this.audit.log({
        action: 'webhook_rejected',
        entityType: 'PaymentAccount',
        entityId: account.id,
        storeId: account.storeId,
        ipAddress: ip,
        afterData: { reason: e instanceof UnauthorizedException ? String((e.getResponse() as { message?: string }).message ?? 'unauthorized') : 'error' },
      });
      throw e instanceof UnauthorizedException ? e : new UnauthorizedException('Chữ ký không hợp lệ');
    }
    const txns = provider.parseWebhook(body);
    await this.payments.ingest(account, txns);
    return provider.ackResponse().body;
  }
}
