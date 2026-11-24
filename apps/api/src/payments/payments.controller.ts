import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  PayloadTooLargeException,
  HttpException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { RateLimiter } from '../common/utils/rate-limiter';
import { PublicReadThrottleGuard } from '../public/public-read-throttle.guard';
import { PaymentsService } from './payments.service';
import { WebhookHandler } from './webhook.handler';
import {
  CreatePaymentAccountDto,
  CreateQrIntentDto,
  ManualConfirmDto,
  MockSimulateDto,
  ReauthDto,
  RefundCompleteDto,
  ResolveBankTxnDto,
  UpdatePaymentAccountDto,
  UpdatePaymentSettingsDto,
} from './dto/payment.dto';

const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const CASH = [...MANAGE, UserRole.CASHIER];

const uuid = (msg: string) => new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException(msg) });
const idPipe = uuid('Không tồn tại');

type Rq = { protocol: string; get: (h: string) => string | undefined };
const baseOf = (req: Rq) => `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;

/** Thanh toan QR cho POS/admin (VietQR tang 1 + khung tang 2) */
@Controller('stores/:storeId')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ---- Cong tac "khach tu tra QR" (chi cong tac nay, khong mo settings) ----
  @Get('payment-settings')
  @Roles(...MANAGE)
  getSettings(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.payments.getPaymentSettings(user, storeId);
  }

  @Patch('payment-settings')
  @Roles(...MANAGE)
  setSettings(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: UpdatePaymentSettingsDto) {
    return this.payments.setCustomerCanPayQr(user, storeId, dto.customerCanPayQr);
  }

  // ---- Tai khoan nhan tien ----
  @Get('payment-accounts')
  @Roles(...CASH)
  listAccounts(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.payments.listAccounts(user, storeId);
  }

  @Post('payment-accounts')
  @Roles(...MANAGE)
  createAccount(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: CreatePaymentAccountDto, @Req() req: Rq) {
    return this.payments.createAccount(user, storeId, dto, baseOf(req));
  }

  @Patch('payment-accounts/:id')
  @Roles(...MANAGE)
  updateAccount(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string, @Body() dto: UpdatePaymentAccountDto) {
    return this.payments.updateAccount(user, storeId, id, dto);
  }

  /** "Xoa" = tat tai khoan (can nhap lai mat khau trong body) */
  @Delete('payment-accounts/:id')
  @Roles(...MANAGE)
  deleteAccount(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string, @Body() dto: ReauthDto) {
    return this.payments.deleteAccount(user, storeId, id, dto.password);
  }

  @Post('payment-accounts/:id/rotate-secret')
  @Roles(...MANAGE)
  rotate(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string, @Body() dto: ReauthDto, @Req() req: Rq) {
    return this.payments.rotateSecret(user, storeId, id, dto.password, baseOf(req));
  }

  // ---- QR intent (POS) ----
  @Post('pos/bills/:billId/qr')
  @Roles(...CASH)
  createIntent(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', uuid('Hóa đơn không tồn tại')) billId: string,
    @Body() dto: CreateQrIntentDto,
  ) {
    return this.payments.createIntentForStaff(user, storeId, billId, dto.amount);
  }

  @Get('pos/bills/:billId/qr-intents')
  @Roles(...CASH)
  billIntents(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('billId', uuid('Hóa đơn không tồn tại')) billId: string) {
    return this.payments.listBillIntents(user, storeId, billId);
  }

  @Get('pos/qr-intents/:id')
  @Roles(...CASH)
  getIntent(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.payments.getIntent(user, storeId, id);
  }

  @Post('pos/qr-intents/:id/cancel')
  @Roles(...CASH)
  cancelIntent(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.payments.cancelIntent(user, storeId, id);
  }

  @Post('pos/qr-intents/:id/extend')
  @Roles(...CASH)
  extendIntent(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.payments.extendIntent(user, storeId, id);
  }

  @Post('pos/qr-intents/:id/manual-confirm')
  @Roles(...CASH)
  manualConfirm(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string, @Body() dto: ManualConfirmDto) {
    return this.payments.manualConfirm(user, storeId, id, dto.reason);
  }

  // ---- Giao dich ngan hang / doi soat ----
  @Get('bank-transactions')
  @Roles(...CASH)
  listTxns(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.payments.listTxns(user, storeId, {
      status,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('bank-transactions/:id/resolve')
  @Roles(...CASH)
  resolve(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string, @Body() dto: ResolveBankTxnDto) {
    return this.payments.resolveTxn(user, storeId, id, dto);
  }

  @Get('reconciliation')
  @Roles(...CASH)
  reconciliation(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Query('date') date?: string) {
    return this.payments.reconciliation(user, storeId, date);
  }

  // ---- Hoan tien QR ----
  @Get('payments/pending-refunds')
  @Roles(...MANAGE)
  pendingRefunds(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.payments.pendingRefunds(user, storeId);
  }

  @Post('payments/:paymentId/refund/complete')
  @Roles(...MANAGE)
  refundComplete(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('paymentId', uuid('Khoản hoàn tiền không tồn tại')) paymentId: string,
    @Body() dto: RefundCompleteDto,
  ) {
    return this.payments.refundComplete(user, storeId, paymentId, dto.reference);
  }

  /** Chi MOCK, chi khi khong phai production: gia lap tien ve */
  @Post('payments/mock/simulate')
  @Roles(...CASH)
  simulate(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: MockSimulateDto) {
    return this.payments.mockSimulate(user, storeId, dto);
  }
}

/** Webhook ngan hang (cong khai): token trong URL + chu ky HMAC + chong replay + idempotent */
const hookLimiter = new RateLimiter(120, 60_000);

@Public()
@Controller('webhooks/bank')
export class WebhookController {
  constructor(private readonly helper: WebhookHandler) {}

  @Post(':provider/:token')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Req() req: { rawBody?: Buffer; headers: Record<string, string | undefined>; ip?: string; body: unknown },
  ) {
    const wait = hookLimiter.hit(`hook|${req.ip ?? 'x'}|${token.slice(0, 12)}`);
    if (wait !== null) throw new HttpException('Quá nhiều yêu cầu', 429);
    const raw = req.rawBody ?? Buffer.from('');
    if (raw.length > 64 * 1024) throw new PayloadTooLargeException('Payload quá lớn');
    return this.helper.handle(provider, token, raw, req.headers, req.body, req.ip);
  }
}

const qrLimiter = new RateLimiter(5, 60_000);

/** Khach xem/tao QR cua hoa don ban minh (chi khi quan bat customerCanPayQr; mac dinh TAT) */
@Public()
@Controller('public')
export class PaymentsPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('sessions/:token/qr')
  @HttpCode(201)
  create(@Param('token') token: string, @Req() req: { ip?: string }) {
    const wait = qrLimiter.hit(`qr|${token.slice(0, 32)}`);
    if (wait !== null) {
      throw new HttpException(`Bạn thao tác quá nhanh, vui lòng thử lại sau ${wait} giây`, 429);
    }
    void req;
    return this.payments.publicCreateQr(token);
  }

  @Get('sessions/:token/qr')
  @UseGuards(PublicReadThrottleGuard)
  get(@Param('token') token: string) {
    return this.payments.publicGetQr(token);
  }

  @Get('payment-intents/:id')
  @UseGuards(PublicReadThrottleGuard)
  status(@Param('id', uuid('Mã QR không tồn tại')) id: string) {
    return this.payments.publicIntentStatus(id);
  }
}
