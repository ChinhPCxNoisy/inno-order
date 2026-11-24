import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BankTransaction, BankTxnStatus, BillStatus, PaymentAccount, PaymentIntent, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EventsService } from '../realtime/events.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money, round2 } from '../common/utils/money';
import { decryptSecret, encryptSecret } from '../common/utils/secret-box';
import { dayRange } from '../common/utils/vn-date';
import { BillsService } from '../bills/bills.service';
import { BILL_OPEN, ensureBillTx, lockTables, sessionTableIds } from '../bills/bill-core';
import {
  buildVietQr,
  extractCodeCandidates,
  generateIntentCode,
  normalizeContent,
} from './vietqr';
import { defaultProviders, NormalizedBankTxn, ProviderRegistry } from './providers/bank-feed-provider';
import {
  CreatePaymentAccountDto,
  ResolveBankTxnDto,
  UpdatePaymentAccountDto,
} from './dto/payment.dto';

const MANAGER_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const DEFAULT_TTL_MIN = 15;
/** Giao dich chua xu ly (chua ghi Payment het so tien) can nguoi xem */
const PENDING_TXN: BankTxnStatus[] = [
  'UNMATCHED',
  'NEEDS_REVIEW',
  'DUPLICATE_PAYMENT',
  'LATE_CLOSED',
  'OVERPAID',
  'REFUND_PENDING',
];

const conflict = (message: string, code: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ statusCode: 409, message, error: 'Conflict', code, ...extra });

export const mockEnabled = () =>
  process.env.NODE_ENV !== 'production' || process.env.PAYMENT_MOCK_ENABLED === 'true';

const maskAcc = (n: string) => (n.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`);

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers: ProviderRegistry = defaultProviders();
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly bills: BillsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref?.();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ================= TAI KHOAN NHAN TIEN =================

  private accountDto(a: PaymentAccount, maskNumber: boolean) {
    return {
      id: a.id,
      label: a.label,
      bankBin: a.bankBin,
      bankName: a.bankName,
      accountNumber: maskNumber ? maskAcc(a.accountNumber) : a.accountNumber,
      accountName: a.accountName,
      provider: a.provider,
      supportsWebhook: this.providers.get(a.provider)?.supportsWebhook ?? false,
      hasSecret: !!a.webhookSecretEnc,
      isActive: a.isActive,
      isDefault: a.isDefault,
      verifiedAt: a.verifiedAt,
      lastWebhookAt: a.lastWebhookAt,
      createdAt: a.createdAt,
    };
  }

  async listAccounts(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const rows = await this.prisma.paymentAccount.findMany({
      where: { storeId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const mask = !MANAGER_ROLES.includes(user.role);
    return rows.map((a) => this.accountDto(a, mask));
  }

  /** Nhap lai mat khau nguoi thao tac (chong chiem doat tai khoan nhan tien) */
  private async reauth(user: JwtUser, password?: string) {
    if (!password) throw new BadRequestException('Vui lòng nhập lại mật khẩu để xác nhận');
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
      throw new ForbiddenException('Mật khẩu xác nhận không đúng');
    }
  }

  private webhookUrl(provider: string, token: string, base: string) {
    const root = (process.env.PAYMENT_WEBHOOK_BASE_URL || base).replace(/\/+$/, '');
    return `${root}/api/v1/webhooks/bank/${provider.toLowerCase()}/${token}`;
  }

  /** Tao tai khoan: tra webhookUrl + webhookSecret MOT LAN DUY NHAT (chi luu ban ma hoa) */
  async createAccount(user: JwtUser, storeId: string, dto: CreatePaymentAccountDto, baseUrl: string) {
    assertStoreAccess(user, storeId);
    await this.reauth(user, dto.password);
    const dup = await this.prisma.paymentAccount.findUnique({
      where: { storeId_bankBin_accountNumber: { storeId, bankBin: dto.bankBin, accountNumber: dto.accountNumber } },
    });
    if (dup) throw new ConflictException('Tài khoản này đã được thêm');
    const provider = this.providers.get(dto.provider);
    if (!provider) throw new BadRequestException('Nhà cung cấp chưa được hỗ trợ');
    const secret = provider.supportsWebhook ? randomBytes(32).toString('base64url') : null;
    const token = randomBytes(32).toString('base64url');
    const count = await this.prisma.paymentAccount.count({ where: { storeId, isActive: true } });
    const makeDefault = dto.isDefault === true || count === 0;
    const created = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.paymentAccount.updateMany({ where: { storeId, isDefault: true }, data: { isDefault: false } });
      return tx.paymentAccount.create({
        data: {
          storeId,
          label: dto.label.trim(),
          bankBin: dto.bankBin,
          bankName: dto.bankName.trim(),
          accountNumber: dto.accountNumber,
          accountName: dto.accountName.trim().toUpperCase(),
          provider: dto.provider,
          providerConfigEnc: dto.providerConfig ? encryptSecret(JSON.stringify(dto.providerConfig)) : null,
          webhookToken: token,
          webhookSecretEnc: secret ? encryptSecret(secret) : null,
          isDefault: makeDefault,
          createdByUserId: user.id,
        },
      });
    });
    await this.audit.log({
      action: 'payment_account_create',
      entityType: 'PaymentAccount',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { label: created.label, bankName: created.bankName, account: maskAcc(created.accountNumber), provider: created.provider },
    });
    return {
      account: this.accountDto(created, false),
      webhookUrl: secret ? this.webhookUrl(created.provider, token, baseUrl) : null,
      webhookSecret: secret,
    };
  }

  async updateAccount(user: JwtUser, storeId: string, id: string, dto: UpdatePaymentAccountDto) {
    assertStoreAccess(user, storeId);
    const cur = await this.mustAccount(storeId, id);
    const sensitive =
      (dto.bankBin !== undefined && dto.bankBin !== cur.bankBin) ||
      (dto.accountNumber !== undefined && dto.accountNumber !== cur.accountNumber) ||
      (dto.accountName !== undefined && dto.accountName.trim().toUpperCase() !== cur.accountName) ||
      (dto.bankName !== undefined && dto.bankName !== cur.bankName);
    if (sensitive) await this.reauth(user, dto.password);
    const data: Prisma.PaymentAccountUncheckedUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (sensitive) {
      if (dto.bankBin !== undefined) data.bankBin = dto.bankBin;
      if (dto.bankName !== undefined) data.bankName = dto.bankName.trim();
      if (dto.accountNumber !== undefined) data.accountNumber = dto.accountNumber;
      if (dto.accountName !== undefined) data.accountName = dto.accountName.trim().toUpperCase();
      data.verifiedAt = null; // doi thong tin: phai xac minh lai
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.paymentAccount.updateMany({ where: { storeId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
        data.isDefault = true;
      } else if (dto.isDefault === false) data.isDefault = false;
      return tx.paymentAccount.update({ where: { id }, data });
    });
    await this.audit.log({
      action: 'payment_account_update',
      entityType: 'PaymentAccount',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { account: maskAcc(cur.accountNumber), bankBin: cur.bankBin, isActive: cur.isActive },
      afterData: { account: maskAcc(updated.accountNumber), bankBin: updated.bankBin, isActive: updated.isActive, sensitive },
    });
    return this.accountDto(updated, false);
  }

  /** "Xoa" = tat tai khoan (van giu lich su giao dich) */
  async deleteAccount(user: JwtUser, storeId: string, id: string, password?: string) {
    assertStoreAccess(user, storeId);
    const cur = await this.mustAccount(storeId, id);
    await this.reauth(user, password);
    await this.prisma.paymentAccount.update({ where: { id }, data: { isActive: false, isDefault: false } });
    await this.prisma.paymentIntent.updateMany({
      where: { accountId: id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    await this.audit.log({
      action: 'payment_account_delete',
      entityType: 'PaymentAccount',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { account: maskAcc(cur.accountNumber) },
    });
    return { ok: true };
  }

  async rotateSecret(user: JwtUser, storeId: string, id: string, password: string | undefined, baseUrl: string) {
    assertStoreAccess(user, storeId);
    const cur = await this.mustAccount(storeId, id);
    await this.reauth(user, password);
    const provider = this.providers.get(cur.provider);
    if (!provider?.supportsWebhook) throw new BadRequestException('Tài khoản này không dùng webhook');
    const secret = randomBytes(32).toString('base64url');
    const token = randomBytes(32).toString('base64url');
    await this.prisma.paymentAccount.update({
      where: { id },
      data: { webhookSecretEnc: encryptSecret(secret), webhookToken: token, verifiedAt: null },
    });
    await this.audit.log({
      action: 'payment_account_rotate_secret',
      entityType: 'PaymentAccount',
      entityId: id,
      storeId,
      userId: user.id,
    });
    return { webhookUrl: this.webhookUrl(cur.provider, token, baseUrl), webhookSecret: secret };
  }

  private async mustAccount(storeId: string, id: string) {
    const a = await this.prisma.paymentAccount.findFirst({ where: { id, storeId } });
    if (!a) throw new NotFoundException('Tài khoản nhận tiền không tồn tại');
    return a;
  }

  // ================= CAI DAT THANH TOAN QR (cong tac hep) =================

  /** Doc cai dat thanh toan QR cua quan (khong lo phan settings khac) */
  async getPaymentSettings(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const c = await this.ttlMinutes(storeId);
    const accounts = await this.prisma.paymentAccount.count({ where: { storeId, isActive: true } });
    return { customerCanPayQr: c.customerCanPayQr, qrIntentTtlMinutes: c.ttl, autoAcceptPartial: c.autoAcceptPartial, hasActiveAccount: accounts > 0 };
  }

  /** Bat/tat DUY NHAT cong tac customerCanPayQr (khong mo toan bo settings); cap nhat nguyen tu o muc JSON */
  async setCustomerCanPayQr(user: JwtUser, storeId: string, value: boolean) {
    assertStoreAccess(user, storeId);
    const before = (await this.ttlMinutes(storeId)).customerCanPayQr;
    await this.prisma.$executeRaw`
      UPDATE stores
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{payment}',
        COALESCE(settings->'payment', '{}'::jsonb) || jsonb_build_object('customerCanPayQr', ${value}::boolean)
      ), "updatedAt" = now()
      WHERE id = ${storeId}::uuid
    `;
    await this.audit.log({
      action: 'payment_setting_customer_qr',
      entityType: 'Store',
      entityId: storeId,
      storeId,
      userId: user.id,
      beforeData: { customerCanPayQr: before },
      afterData: { customerCanPayQr: value },
    });
    return this.getPaymentSettings(user, storeId);
  }

  // ================= QR INTENT =================

  private async ttlMinutes(storeId: string): Promise<{ ttl: number; customerCanPayQr: boolean; autoAcceptPartial: boolean }> {
    const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    const p = ((s?.settings ?? {}) as Record<string, any>).payment ?? {};
    return {
      ttl: typeof p.qrIntentTtlMinutes === 'number' && p.qrIntentTtlMinutes >= 1 ? Math.min(p.qrIntentTtlMinutes, 24 * 60) : DEFAULT_TTL_MIN,
      customerCanPayQr: p.customerCanPayQr === true,
      autoAcceptPartial: p.autoAcceptPartial !== false,
    };
  }

  private intentDto(i: PaymentIntent, a: PaymentAccount, opts: { autoConfirm?: boolean } = {}) {
    return {
      intentId: i.id,
      code: i.code,
      status: i.status,
      amount: money(i.amount),
      paidAmount: money(i.paidAmount),
      remaining: ['PENDING', 'PARTIALLY_PAID', 'EXPIRED', 'SUPERSEDED'].includes(i.status)
        ? Math.max(0, round2(money(i.amount) - money(i.paidAmount)))
        : 0,
      expiresAt: i.expiresAt,
      paidAt: i.paidAt,
      qrPayload: i.qrPayload,
      bank: { bankName: a.bankName, accountNumber: a.accountNumber, accountName: a.accountName },
      ...(opts.autoConfirm !== undefined ? { autoConfirm: opts.autoConfirm } : {}),
      createdAt: i.createdAt,
      billId: i.billId,
    };
  }

  private autoConfirm(a: PaymentAccount) {
    return !!this.providers.get(a.provider)?.supportsWebhook && !!a.verifiedAt;
  }

  /** Tai khoan mac dinh dang hoat dong cua quan */
  private async defaultAccount(storeId: string) {
    const acc =
      (await this.prisma.paymentAccount.findFirst({ where: { storeId, isActive: true, isDefault: true } })) ??
      (await this.prisma.paymentAccount.findFirst({ where: { storeId, isActive: true }, orderBy: { createdAt: 'asc' } }));
    if (!acc) throw new BadRequestException('Quán chưa cấu hình tài khoản nhận tiền');
    return acc;
  }

  /** Tao intent (QR) cho hoa don: so tien mac dinh = con phai thu */
  async createIntent(
    storeId: string,
    billId: string,
    amountReq: number | undefined,
    by: { userId?: string; customer?: boolean },
  ) {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, storeId } });
    if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
    if (!BILL_OPEN.includes(bill.status)) {
      throw conflict(bill.status === BillStatus.PAID ? 'Hóa đơn này đã được thanh toán' : 'Hóa đơn đã đóng', 'BILL_CLOSED');
    }
    const acc = await this.defaultAccount(storeId);
    const { ttl } = await this.ttlMinutes(storeId);
    const remaining = round2(money(bill.totalAmount) - money(bill.paidAmount));
    const amount = amountReq ?? remaining;
    if (amount <= 0 || remaining <= 0) throw new BadRequestException('Hóa đơn không còn số tiền cần thu');
    if (amount > remaining) {
      throw new BadRequestException(`Số tiền QR (${amount.toLocaleString('vi-VN')}đ) vượt quá số còn phải thu (${remaining.toLocaleString('vi-VN')}đ)`);
    }
    if (!Number.isInteger(amount)) throw new BadRequestException('Số tiền QR phải là số nguyên đồng');

    // Ma doi soat duy nhat toan nen tang (thu lai neu trung)
    for (let tries = 0; tries < 5; tries++) {
      const code = generateIntentCode();
      try {
        const qr = buildVietQr({ bin: acc.bankBin, accountNumber: acc.accountNumber, amount, content: code });
        const intent = await this.prisma.paymentIntent.create({
          data: {
            storeId,
            accountId: acc.id,
            billId,
            code,
            amount,
            qrPayload: qr,
            expiresAt: new Date(Date.now() + ttl * 60_000),
            createdByUserId: by.userId ?? null,
            createdByCustomer: by.customer === true,
          },
        });
        await this.audit.log({
          action: 'qr_intent_create',
          entityType: 'PaymentIntent',
          entityId: intent.id,
          storeId,
          userId: by.userId,
          afterData: { billId, amount, code, customer: by.customer === true },
        });
        return { intent, acc };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new ConflictException('Không tạo được mã QR, vui lòng thử lại');
  }

  async createIntentForStaff(user: JwtUser, storeId: string, billId: string, amount?: number) {
    assertStoreAccess(user, storeId);
    const { intent, acc } = await this.createIntent(storeId, billId, amount, { userId: user.id });
    return this.intentDto(intent, acc, { autoConfirm: this.autoConfirm(acc) });
  }

  async getIntent(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const i = await this.prisma.paymentIntent.findFirst({ where: { id, storeId }, include: { account: true } });
    if (!i) throw new NotFoundException('Mã QR không tồn tại');
    return this.intentDto(i, i.account, { autoConfirm: this.autoConfirm(i.account) });
  }

  async listBillIntents(user: JwtUser, storeId: string, billId: string) {
    assertStoreAccess(user, storeId);
    const rows = await this.prisma.paymentIntent.findMany({
      where: { storeId, billId },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((i) => this.intentDto(i, i.account, { autoConfirm: this.autoConfirm(i.account) }));
  }

  async cancelIntent(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const r = await this.prisma.paymentIntent.updateMany({
      where: { id, storeId, status: { in: ['PENDING', 'EXPIRED', 'SUPERSEDED'] } },
      data: { status: 'CANCELLED' },
    });
    if (r.count === 0) {
      const i = await this.prisma.paymentIntent.findFirst({ where: { id, storeId } });
      if (!i) throw new NotFoundException('Mã QR không tồn tại');
      throw conflict(`Mã QR đang ở trạng thái ${i.status}, không hủy được`, 'INTENT_STATE');
    }
    await this.audit.log({ action: 'qr_intent_cancel', entityType: 'PaymentIntent', entityId: id, storeId, userId: user.id });
    return this.getIntent(user, storeId, id);
  }

  /** Gia han: dat lai han tu bay gio (chi khi hoa don con mo) */
  async extendIntent(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const i = await this.prisma.paymentIntent.findFirst({ where: { id, storeId }, include: { bill: true } });
    if (!i) throw new NotFoundException('Mã QR không tồn tại');
    if (!BILL_OPEN.includes(i.bill.status)) throw conflict('Hóa đơn đã đóng', 'BILL_CLOSED');
    if (i.status === 'SUPERSEDED') throw conflict('Hóa đơn đã thay đổi, vui lòng tạo mã QR mới', 'INTENT_STATE');
    const { ttl } = await this.ttlMinutes(storeId);
    const r = await this.prisma.paymentIntent.updateMany({
      where: { id, status: { in: ['PENDING', 'EXPIRED'] } },
      data: { status: 'PENDING', expiresAt: new Date(Date.now() + ttl * 60_000) },
    });
    if (r.count === 0) throw conflict(`Mã QR đang ở trạng thái ${i.status}, không gia hạn được`, 'INTENT_STATE');
    return this.getIntent(user, storeId, id);
  }

  /** Thu ngan xac nhan da thay tien ve (tang 1) -> Payment QR_BANK qua dung duong thanh toan hoa don */
  async manualConfirm(user: JwtUser, storeId: string, id: string, reason?: string) {
    assertStoreAccess(user, storeId);
    const i = await this.prisma.paymentIntent.findFirst({ where: { id, storeId }, include: { account: true } });
    if (!i) throw new NotFoundException('Mã QR không tồn tại');
    if (i.status === 'PAID' || i.status === 'CANCELLED') {
      throw conflict(i.status === 'PAID' ? 'Mã QR này đã được thanh toán' : 'Mã QR đã bị hủy', 'INTENT_STATE');
    }
    const remaining = round2(money(i.amount) - money(i.paidAmount));
    if (remaining <= 0) throw conflict('Mã QR này đã được thanh toán', 'INTENT_STATE');
    const r = await this.bills.confirmQrPayment({
      storeId,
      billId: i.billId,
      amount: remaining,
      confirmedBy: 'CASHIER',
      actorId: user.id,
      // Moi lan bam tren cung muc da thu = 1 khoa: nhap dup khong tao Payment thu hai
      idempotencyKey: `qr-manual:${i.id}:${Math.round(money(i.paidAmount))}`,
      intentId: i.id,
    });
    if (r.kind === 'BILL_PAID') throw conflict('Hóa đơn này đã được thanh toán', 'BILL_CLOSED');
    if (r.kind === 'BILL_CLOSED' || r.kind === 'BILL_NOT_FOUND') throw conflict('Hóa đơn đã đóng, không ghi nhận được', 'BILL_CLOSED');
    if (r.kind !== 'APPLIED') throw conflict('Không ghi nhận được thanh toán', 'INTENT_STATE');
    if (reason) {
      await this.audit.log({
        action: 'qr_manual_confirm_note',
        entityType: 'PaymentIntent',
        entityId: id,
        storeId,
        userId: user.id,
        afterData: { reason },
      });
    }
    this.emitPayment(storeId, r.settled ? 'payment.confirmed' : 'payment.partial', {
      intentId: i.id,
      billId: i.billId,
      amount: r.applied,
      confirmedBy: 'CASHIER',
      settled: r.settled,
    });
    const bill = await this.prisma.bill.findUniqueOrThrow({ where: { id: i.billId } });
    const view = await this.bills.sessionViewPublic(storeId, bill.sessionId);
    const cur = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: i.id }, include: { account: true } });
    return {
      replayed: r.replayed,
      intent: this.intentDto(cur, cur.account),
      payment: { id: r.payment.id, amount: money(r.payment.amount), method: r.payment.method, confirmedBy: r.payment.confirmedBy },
      bill: view.bill,
      tables: view.tables,
    };
  }

  private emitPayment(
    storeId: string,
    type: 'payment.confirmed' | 'payment.partial' | 'payment.needs_review' | 'payment.expired',
    data: Record<string, unknown>,
  ) {
    try {
      this.events.generic(type, storeId, data);
    } catch {
      /* realtime khong anh huong luong chinh */
    }
  }

  // ================= WEBHOOK / GHI SO / KHOP =================

  providerOf(key: string) {
    return this.providers.get(key);
  }

  async accountByToken(token: string) {
    return this.prisma.paymentAccount.findUnique({ where: { webhookToken: token } });
  }

  secretOf(a: PaymentAccount): string | null {
    return a.webhookSecretEnc ? decryptSecret(a.webhookSecretEnc) : null;
  }

  /**
   * Ghi so TRUOC, khop SAU. Idempotent theo (accountId, providerTxnId): trung thi bo qua.
   * Tra ve cac giao dich da ghi moi (khong gom trung).
   */
  async ingest(account: PaymentAccount, txns: NormalizedBankTxn[]): Promise<{ created: string[]; duplicates: number }> {
    const created: string[] = [];
    let duplicates = 0;
    for (const t of txns) {
      let status: BankTxnStatus = 'RECEIVED';
      let note: string | null = null;
      if (t.direction === 'OUT') {
        status = 'IGNORED';
        note = 'Giao dịch chuyển ra (không khớp thanh toán)';
      } else if (t.accountNumber && t.accountNumber !== account.accountNumber) {
        status = 'NEEDS_REVIEW';
        note = 'Số tài khoản nhận trong giao dịch khác tài khoản đã cấu hình';
      }
      try {
        const row = await this.prisma.bankTransaction.create({
          data: {
            storeId: account.storeId,
            accountId: account.id,
            provider: account.provider,
            providerTxnId: t.providerTxnId,
            direction: t.direction,
            amount: t.amount,
            content: t.content,
            contentNormalized: normalizeContent(t.content),
            bankReference: t.bankReference,
            counterpartyName: t.counterpartyName,
            counterpartyAccountMasked: t.counterpartyAccountMasked,
            transferredAt: t.transferredAt,
            rawPayload: t.raw as Prisma.InputJsonValue,
            status,
            resolutionNote: note,
          },
        });
        created.push(row.id);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          duplicates++;
          continue;
        }
        throw e;
      }
    }
    // Giao dich da duoc ghi an toan trong so; loi khi khop khong lam hong ket qua ghi so
    for (const id of created) {
      try {
        await this.match(id);
      } catch (e) {
        this.logger.error(`match ${id}: ${(e as Error).message}`);
      }
    }
    await this.prisma.paymentAccount.update({
      where: { id: account.id },
      data: { lastWebhookAt: new Date(), ...(account.verifiedAt ? {} : { verifiedAt: new Date() }) },
    });
    return { created, duplicates };
  }

  /** Khop 1 giao dich theo ma doi soat trong noi dung va so tien (bang quyet dinh o dac ta 01 muc 5.4) */
  async match(txnId: string): Promise<BankTxnStatus> {
    const txn = await this.prisma.bankTransaction.findUnique({ where: { id: txnId } });
    if (!txn || txn.status !== 'RECEIVED') return txn?.status ?? 'IGNORED';

    const set = (status: BankTxnStatus, data: Prisma.BankTransactionUncheckedUpdateInput = {}) =>
      this.prisma.bankTransaction
        .updateMany({ where: { id: txnId, status: 'RECEIVED' }, data: { status, ...data } })
        .then(() => status);
    const review = (reason: string, data: Prisma.BankTransactionUncheckedUpdateInput = {}) => {
      this.emitPayment(txn.storeId, 'payment.needs_review', { txnId, amount: money(txn.amount), reason });
      return set('NEEDS_REVIEW', { resolutionNote: reason, ...data });
    };

    const candidates = extractCodeCandidates(txn.contentNormalized);
    if (candidates.length === 0) {
      this.emitPayment(txn.storeId, 'payment.needs_review', { txnId, amount: money(txn.amount), reason: 'Không có mã đối soát' });
      return set('UNMATCHED', { resolutionNote: 'Nội dung không có mã đối soát' });
    }
    const intents = await this.prisma.paymentIntent.findMany({ where: { code: { in: candidates } } });
    if (intents.length === 0) {
      this.emitPayment(txn.storeId, 'payment.needs_review', { txnId, amount: money(txn.amount), reason: 'Mã đối soát không tồn tại' });
      return set('UNMATCHED', { resolutionNote: 'Mã đối soát không tồn tại' });
    }
    if (intents.length > 1) return review('Nội dung chứa nhiều mã đối soát khác nhau');
    const intent = intents[0];
    // Chot chan da quan: khong bao gio ghi nhan cheo quan / cheo tai khoan
    if (intent.storeId !== txn.storeId || intent.accountId !== txn.accountId) {
      this.logger.warn(`Giao dịch ${txnId} khớp mã của quán/tài khoản khác`);
      return review('Mã đối soát thuộc quán hoặc tài khoản khác (nghi giả mạo hoặc lẫn token)');
    }
    const { autoAcceptPartial } = await this.ttlMinutes(txn.storeId);
    const r = await this.bills.confirmQrPayment({
      storeId: txn.storeId,
      billId: intent.billId,
      amount: money(txn.amount),
      confirmedBy: 'BANK_FEED',
      actorId: null,
      idempotencyKey: `bank:${txn.id}`,
      intentId: intent.id,
      bankTransactionId: txn.id,
      rejectPartial: !autoAcceptPartial,
    });
    switch (r.kind) {
      case 'APPLIED': {
        this.emitPayment(txn.storeId, r.settled ? 'payment.confirmed' : 'payment.partial', {
          intentId: intent.id,
          billId: intent.billId,
          txnId,
          amount: r.applied,
          excess: r.excess,
          remainingBefore: r.remainingBefore,
          confirmedBy: 'BANK_FEED',
          settled: r.settled,
        });
        const cur = await this.prisma.bankTransaction.findUnique({ where: { id: txnId } });
        return cur?.status ?? 'MATCHED';
      }
      case 'BILL_PAID':
        this.emitPayment(txn.storeId, 'payment.needs_review', { txnId, amount: money(txn.amount), reason: 'Hóa đơn đã được thanh toán bằng cách khác' });
        return set('DUPLICATE_PAYMENT', { intentId: intent.id, billId: intent.billId, resolutionNote: 'Hóa đơn đã được thanh toán đủ, cần hoàn tiền' });
      case 'BILL_CLOSED':
      case 'BILL_NOT_FOUND':
        this.emitPayment(txn.storeId, 'payment.needs_review', { txnId, amount: money(txn.amount), reason: 'Tiền về muộn, hóa đơn đã đóng/hủy/hoàn' });
        return set('LATE_CLOSED', { intentId: intent.id, billId: intent.billId, resolutionNote: 'Tiền về khi hóa đơn đã đóng, cần hoàn tiền' });
      case 'PARTIAL_REJECTED':
        return review(`Chuyển thiếu tiền (còn thiếu ${r.remaining - money(txn.amount)}đ), quán tắt tự nhận thanh toán một phần`, {
          intentId: intent.id,
          billId: intent.billId,
        });
    }
  }

  /** Chi cho MOCK: gia lap tien ve (di qua CUNG duong ghi so + khop nhu webhook that) */
  async mockSimulate(user: JwtUser, storeId: string, dto: { accountId: string; amount: number; content: string; providerTxnId?: string; direction?: 'IN' | 'OUT' }) {
    assertStoreAccess(user, storeId);
    if (!mockEnabled()) throw new ForbiddenException('Giả lập tiền về bị tắt ở môi trường production');
    const acc = await this.mustAccount(storeId, dto.accountId);
    if (acc.provider !== 'MOCK') throw new BadRequestException('Chỉ tài khoản nhà cung cấp MOCK mới giả lập được');
    if (!acc.isActive) throw new BadRequestException('Tài khoản đang tắt');
    const txn: NormalizedBankTxn = {
      providerTxnId: dto.providerTxnId ?? `MOCK-${randomUUID()}`,
      accountNumber: acc.accountNumber,
      amount: dto.amount,
      direction: dto.direction ?? 'IN',
      content: dto.content,
      transferredAt: new Date(),
      counterpartyName: 'KHACH GIA LAP',
      raw: { simulated: true, by: user.id },
    };
    const r = await this.ingest(acc, [txn]);
    const row = await this.prisma.bankTransaction.findUnique({
      where: { accountId_providerTxnId: { accountId: acc.id, providerTxnId: txn.providerTxnId } },
    });
    return { duplicate: r.duplicates > 0, transaction: row ? this.txnDto(row, true) : null };
  }

  // ================= GIAO DICH NGAN HANG =================

  private txnDto(t: BankTransaction, full: boolean) {
    return {
      id: t.id,
      accountId: t.accountId,
      providerTxnId: t.providerTxnId,
      direction: t.direction,
      amount: money(t.amount),
      content: t.content,
      status: t.status,
      bankReference: t.bankReference,
      counterpartyName: full ? t.counterpartyName : null,
      counterpartyAccountMasked: t.counterpartyAccountMasked,
      transferredAt: t.transferredAt,
      receivedAt: t.receivedAt,
      intentId: t.intentId,
      billId: t.billId,
      appliedAmount: money(t.appliedAmount),
      excessAmount: money(t.excessAmount),
      resolvedByUserId: t.resolvedByUserId,
      resolvedAt: t.resolvedAt,
      resolutionNote: t.resolutionNote,
    };
  }

  async listTxns(
    user: JwtUser,
    storeId: string,
    q: { status?: string; from?: string; to?: string; page?: number; pageSize?: number },
  ) {
    assertStoreAccess(user, storeId);
    const page = q.page && q.page > 0 ? q.page : 1;
    const pageSize = Math.min(q.pageSize ?? 30, 100);
    const where: Prisma.BankTransactionWhereInput = { storeId };
    if (q.status === 'PENDING') where.status = { in: PENDING_TXN };
    else if (q.status) where.status = q.status as BankTxnStatus;
    if (q.from || q.to) {
      where.transferredAt = {};
      if (q.from) where.transferredAt.gte = dayRange(q.from).start;
      if (q.to) where.transferredAt.lt = dayRange(q.to).end;
    }
    const full = MANAGER_ROLES.includes(user.role);
    const [total, rows, pending] = await this.prisma.$transaction([
      this.prisma.bankTransaction.count({ where }),
      this.prisma.bankTransaction.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.bankTransaction.count({ where: { storeId, status: { in: PENDING_TXN } } }),
    ]);
    return { total, page, pageSize, pendingCount: pending, data: rows.map((t) => this.txnDto(t, full)) };
  }

  /** Xu ly giao dich cho: gan vao hoa don / danh dau hoan / bo qua */
  async resolveTxn(user: JwtUser, storeId: string, id: string, dto: ResolveBankTxnDto) {
    assertStoreAccess(user, storeId);
    const t = await this.prisma.bankTransaction.findFirst({ where: { id, storeId } });
    if (!t) throw new NotFoundException('Giao dịch không tồn tại');
    if (dto.action !== 'ATTACH_TO_BILL' && !MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Chỉ quản lý hoặc chủ quán được thao tác này');
    }
    const note = dto.note?.trim();
    const allow: Record<string, BankTxnStatus[]> = {
      ATTACH_TO_BILL: ['UNMATCHED', 'NEEDS_REVIEW', 'DUPLICATE_PAYMENT', 'LATE_CLOSED'],
      MARK_REFUND_PENDING: ['UNMATCHED', 'NEEDS_REVIEW', 'DUPLICATE_PAYMENT', 'LATE_CLOSED', 'OVERPAID'],
      MARK_REFUNDED: ['UNMATCHED', 'NEEDS_REVIEW', 'DUPLICATE_PAYMENT', 'LATE_CLOSED', 'OVERPAID', 'REFUND_PENDING'],
      IGNORE: ['UNMATCHED', 'NEEDS_REVIEW', 'DUPLICATE_PAYMENT', 'LATE_CLOSED'],
    };
    if (!allow[dto.action].includes(t.status)) {
      throw conflict(`Giao dịch đang ở trạng thái ${t.status}, không thực hiện được thao tác này`, 'TXN_STATE');
    }
    if ((dto.action === 'IGNORE' || dto.action === 'MARK_REFUNDED') && !note) {
      throw new BadRequestException('Vui lòng nhập ghi chú/lý do');
    }

    let result: unknown = null;
    if (dto.action === 'ATTACH_TO_BILL') {
      if (!dto.billId) throw new BadRequestException('Vui lòng chọn hóa đơn để gán');
      const bill = await this.prisma.bill.findFirst({ where: { id: dto.billId, storeId } });
      if (!bill) throw new NotFoundException('Hóa đơn không tồn tại');
      // Dat lai RECEIVED-like: ghi nhan bang cung duong thanh toan (idempotent theo giao dich)
      const r = await this.bills.confirmQrPayment({
        storeId,
        billId: dto.billId,
        amount: money(t.amount),
        confirmedBy: 'CASHIER',
        actorId: user.id,
        idempotencyKey: `bank:${t.id}`,
        bankTransactionId: t.id,
      });
      if (r.kind === 'BILL_PAID') throw conflict('Hóa đơn này đã được thanh toán', 'BILL_CLOSED');
      if (r.kind !== 'APPLIED') throw conflict('Hóa đơn đã đóng, không gán được', 'BILL_CLOSED');
      result = { applied: r.applied, excess: r.excess, settled: r.settled };
      this.emitPayment(storeId, r.settled ? 'payment.confirmed' : 'payment.partial', { txnId: id, billId: dto.billId, amount: r.applied, confirmedBy: 'CASHIER' });
    } else {
      const status: BankTxnStatus =
        dto.action === 'MARK_REFUND_PENDING' ? 'REFUND_PENDING' : dto.action === 'MARK_REFUNDED' ? 'REFUNDED' : 'IGNORED';
      const upd = await this.prisma.bankTransaction.updateMany({
        where: { id, status: t.status },
        data: { status, resolvedByUserId: user.id, resolvedAt: new Date(), resolutionNote: note ?? t.resolutionNote },
      });
      if (upd.count !== 1) throw conflict('Giao dịch vừa được xử lý bởi người khác', 'TXN_STATE');
    }
    await this.audit.log({
      action: 'bank_txn_resolve',
      entityType: 'BankTransaction',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { status: t.status },
      afterData: { action: dto.action, billId: dto.billId ?? null, note: note ?? null },
    });
    const cur = await this.prisma.bankTransaction.findUniqueOrThrow({ where: { id } });
    return { transaction: this.txnDto(cur, MANAGER_ROLES.includes(user.role)), result };
  }

  // ================= DOI SOAT =================

  /** Doi soat trong ngay (gio VN): tien ve ngan hang so voi Payment QR, giao dich ton, lech */
  async reconciliation(user: JwtUser, storeId: string, date?: string) {
    assertStoreAccess(user, storeId);
    const { start, end, label } = dayRange(date);
    const txns = await this.prisma.bankTransaction.findMany({
      where: { storeId, direction: 'IN', transferredAt: { gte: start, lt: end } },
    });
    const pays = await this.prisma.payment.findMany({
      where: { storeId, method: 'QR_BANK', paidAt: { gte: start, lt: end } },
    });
    const sum = (arr: { amount: unknown }[]) => round2(arr.reduce((s, x) => s + money(x.amount), 0));
    const completed = pays.filter((p) => p.status === 'COMPLETED');
    const feed = completed.filter((p) => p.confirmedBy === 'BANK_FEED');
    const manual = completed.filter((p) => p.confirmedBy !== 'BANK_FEED');
    const refunded = pays.filter((p) => p.status === 'REFUNDED');
    const matchedTxns = txns.filter((t) => ['MATCHED', 'PARTIAL', 'OVERPAID'].includes(t.status));
    const pending = txns.filter((t) => PENDING_TXN.includes(t.status));

    // Lech tien: giao dich da khop nhung khong co Payment tuong ung / so tien khac
    const payByTxn = new Map(pays.filter((p) => p.bankTransactionId).map((p) => [p.bankTransactionId as string, p]));
    const mismatches: { type: string; txnId?: string; paymentId?: string; expected?: number; actual?: number }[] = [];
    for (const t of matchedTxns) {
      const p = payByTxn.get(t.id);
      if (!p) mismatches.push({ type: 'TXN_WITHOUT_PAYMENT', txnId: t.id, expected: money(t.appliedAmount) });
      else if (money(p.amount) !== money(t.appliedAmount)) {
        mismatches.push({ type: 'AMOUNT_DIFF', txnId: t.id, paymentId: p.id, expected: money(t.appliedAmount), actual: money(p.amount) });
      }
    }
    for (const p of feed) {
      if (!p.bankTransactionId) mismatches.push({ type: 'FEED_PAYMENT_WITHOUT_TXN', paymentId: p.id, actual: money(p.amount) });
    }
    return {
      date: label,
      bankInTotal: sum(txns),
      bankInCount: txns.length,
      matchedAppliedTotal: round2(matchedTxns.reduce((s, t) => s + money(t.appliedAmount), 0)),
      pendingTotal: round2(pending.reduce((s, t) => s + money(t.amount) - money(t.appliedAmount), 0)),
      ignoredTotal: sum(txns.filter((t) => t.status === 'IGNORED')),
      refundedTotal: sum(txns.filter((t) => t.status === 'REFUNDED')),
      qrPaymentTotal: sum(completed),
      qrAutoConfirmTotal: sum(feed),
      qrManualConfirmTotal: sum(manual),
      qrRefundTotal: sum(refunded),
      unresolvedCount: pending.length,
      unresolved: pending.map((t) => ({ id: t.id, status: t.status, amount: money(t.amount), content: t.content, receivedAt: t.receivedAt })),
      mismatches,
      balanced: mismatches.length === 0 && pending.length === 0,
    };
  }

  // ================= HOAN TIEN QR =================

  /** Quan ly da chuyen tra tien cho khach: danh dau Payment hoan la DONE kem so tham chieu */
  async refundComplete(user: JwtUser, storeId: string, paymentId: string, reference: string) {
    assertStoreAccess(user, storeId);
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, storeId, status: 'REFUNDED' } });
    if (!p) throw new NotFoundException('Khoản hoàn tiền không tồn tại');
    if (p.refundStatus !== 'PENDING_TRANSFER') {
      throw conflict('Khoản hoàn này không ở trạng thái chờ chuyển trả', 'REFUND_STATE');
    }
    const r = await this.prisma.payment.updateMany({
      where: { id: paymentId, refundStatus: 'PENDING_TRANSFER' },
      data: { refundStatus: 'DONE', refundNote: `Đã chuyển trả, tham chiếu ${reference.trim()}` },
    });
    if (r.count !== 1) throw conflict('Khoản hoàn vừa được xử lý bởi người khác', 'REFUND_STATE');
    await this.audit.log({
      action: 'payment_refund_complete',
      entityType: 'Payment',
      entityId: paymentId,
      storeId,
      userId: user.id,
      afterData: { reference: reference.trim(), amount: money(p.amount), method: p.method },
    });
    return { ok: true };
  }

  async pendingRefunds(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const rows = await this.prisma.payment.findMany({
      where: { storeId, status: 'REFUNDED', refundStatus: 'PENDING_TRANSFER' },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => ({
      paymentId: p.id,
      billId: p.billId,
      amount: money(p.amount),
      method: p.method,
      refundOfPaymentId: p.refundOfPaymentId,
      note: p.refundNote,
      createdAt: p.paidAt,
    }));
  }

  // ================= KHACH (cong khai, theo token phien) =================

  private async sessionByToken(token: string) {
    if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundException('Phiên không tồn tại');
    let s = await this.prisma.tableSession.findUnique({ where: { publicToken: token } });
    for (let i = 0; s?.mergedIntoId && i < 5; i++) {
      s = await this.prisma.tableSession.findUnique({ where: { id: s.mergedIntoId } });
    }
    if (!s) throw new NotFoundException('Phiên không tồn tại');
    return s;
  }

  /** Khach xem/tao QR cua hoa don ban minh. Mac dinh TAT; chi hien thi QR, KHONG tu coi la da tra */
  async publicCreateQr(token: string) {
    const s = await this.sessionByToken(token);
    if (s.status !== 'OPEN') throw conflict('Phiên bàn đã kết thúc', 'SESSION_CLOSED');
    const { customerCanPayQr } = await this.ttlMinutes(s.storeId);
    if (!customerCanPayQr) throw new ForbiddenException('Quán chưa bật thanh toán QR cho khách');
    const bill = await this.prisma.$transaction(async (tx) => {
      await lockTables(tx, await sessionTableIds(tx, s.id));
      return ensureBillTx(tx, s.storeId, s.id);
    });
    if (!BILL_OPEN.includes(bill.status)) throw conflict('Hóa đơn này đã được thanh toán', 'BILL_CLOSED');
    const remaining = round2(money(bill.totalAmount) - money(bill.paidAmount));
    // Dung lai ma khach vua tao con han, dung so tien con lai
    const existing = await this.prisma.paymentIntent.findFirst({
      where: { billId: bill.id, createdByCustomer: true, status: 'PENDING', expiresAt: { gt: new Date() }, amount: remaining },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.publicIntentDto(existing, existing.account);
    const { intent, acc } = await this.createIntent(s.storeId, bill.id, undefined, { customer: true });
    return this.publicIntentDto(intent, acc);
  }

  async publicGetQr(token: string) {
    const s = await this.sessionByToken(token);
    const bill = await this.prisma.bill.findUnique({ where: { sessionId: s.id } });
    if (!bill) throw new NotFoundException('Chưa có mã QR');
    const i = await this.prisma.paymentIntent.findFirst({
      where: { billId: bill.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!i) throw new NotFoundException('Chưa có mã QR còn hạn');
    return this.publicIntentDto(i, i.account);
  }

  /** Khong tra autoConfirm (khach khong can biet) */
  private publicIntentDto(i: PaymentIntent, a: PaymentAccount) {
    const d = this.intentDto(i, a);
    const { billId: _b, ...rest } = d;
    void _b;
    return rest;
  }

  async publicIntentStatus(id: string) {
    const i = await this.prisma.paymentIntent.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Mã QR không tồn tại');
    // EXPIRED van tra 200 kem status (khach co the chuyen khoan tre; client hien "Mã đã hết hạn, tạo mã mới")
    return {
      status: i.status,
      amount: money(i.amount),
      paidAmount: money(i.paidAmount),
      remaining: Math.max(0, round2(money(i.amount) - money(i.paidAmount))),
      expiresAt: i.expiresAt,
      paidAt: i.paidAt,
    };
  }

  // ================= BO QUET =================

  /** Het han intent + quet lai giao dich RECEIVED bi ket (moi 30 giay) */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = new Date();
      const exp = await this.prisma.paymentIntent.findMany({
        where: { status: 'PENDING', expiresAt: { lt: now } },
        select: { id: true, storeId: true, billId: true },
        take: 200,
      });
      for (const i of exp) {
        const r = await this.prisma.paymentIntent.updateMany({ where: { id: i.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
        if (r.count === 1) this.emitPayment(i.storeId, 'payment.expired', { intentId: i.id, billId: i.billId });
      }
      const stuck = await this.prisma.bankTransaction.findMany({
        where: { status: 'RECEIVED', receivedAt: { lt: new Date(now.getTime() - 60_000) } },
        select: { id: true },
        take: 50,
      });
      for (const t of stuck) await this.match(t.id).catch((e) => this.logger.error(`rematch ${t.id}: ${(e as Error).message}`));
    } catch (e) {
      this.logger.error(`sweep: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
