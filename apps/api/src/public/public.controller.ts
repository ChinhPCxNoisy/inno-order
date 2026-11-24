import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrderSource, TableStatus } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { PublicOrderThrottleGuard } from '../common/guards/public-order-throttle.guard';
import { money } from '../common/utils/money';
import { PrismaService } from '../prisma/prisma.service';
import { storeBrand, StoresService } from '../stores/stores.service';
import { MenuService } from '../menu/menu.service';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto } from '../orders/dto/order.dto';
import { ReviewsService } from '../reviews/reviews.service';
import { CreateReviewDto } from '../reviews/dto/review.dto';
import { TableCallsService } from '../table-calls/table-calls.service';
import { BillsService } from '../bills/bills.service';
import { OffersService } from '../offers/offers.service';
import { PublicOfferCheckDto, PublicQuoteDto } from '../offers/dto/offer.dto';
import { calcTotals } from '../common/utils/totals';
import { PublicReadThrottleGuard } from './public-read-throttle.guard';
import { PublicQuoteThrottleGuard } from './public-quote-throttle.guard';
import { CreateTableCallDto } from '../table-calls/dto/create-table-call.dto';

/** Id don khong phai UUID -> 404 (khong de Prisma nem 500) */
const orderIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Đơn hàng không tồn tại'),
});

/**
 * API cho khach goi mon (PWA, khong can dang nhap).
 * Luong QR (BRD 7.1, 8.1): /s/{store_slug}/t/{table_code}
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly menu: MenuService,
    private readonly orders: OrdersService,
    private readonly reviews: ReviewsService,
    private readonly tableCalls: TableCallsService,
    private readonly bills: BillsService,
    private readonly offers: OffersService,
  ) {}

  /** Branding quan cho mini app (de cac trang Tracking/Profile/Voucher
   * ap theme + settings ma khong can goi menu lan nua) */
  @Get('stores/:slug/brand')
  async storeBrand(@Param('slug') slug: string) {
    const store = await this.stores.getPublicBySlug(slug);
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động, vui lòng quay lại sau');
    }
    return storeBrand(store);
  }

  /** Thong tin quan khi khach mo link QR */
  @Get('stores/:slug')
  async storeBySlug(@Param('slug') slug: string) {
    const store = await this.stores.getPublicBySlug(slug);
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động, vui lòng quay lại sau');
    }
    return store;
  }

  /** Xac nhan ban (BRD 8.1, man hinh 14.1-1) */
  @Get('stores/:slug/tables/:tableCode')
  async confirmTable(@Param('slug') slug: string, @Param('tableCode') tableCode: string) {
    const store = await this.stores.getPublicBySlug(slug);
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động, vui lòng quay lại sau');
    }
    const table = await this.prisma.table.findFirst({
      where: { storeId: store.id, code: tableCode.toUpperCase() },
      include: { area: { select: { name: true } } },
    });
    if (!table) throw new NotFoundException('Bàn không tồn tại, vui lòng quét lại mã QR');

    return {
      store: storeBrand(store),
      table: {
        code: table.code,
        name: table.name,
        areaName: table.area.name,
        status: table.status,
        locked: table.status === TableStatus.LOCKED,
      },
    };
  }

  /** Menu cho khach (BRD FR-CUST-03/04) */
  @Get('stores/:slug/menu')
  publicMenu(@Param('slug') slug: string) {
    return this.menu.getPublicMenu(slug);
  }

  /** Uu dai dang hieu luc cua quan (cong khai, chi uu dai bat "listed") */
  @Get('stores/:slug/offers')
  async offerList(@Param('slug') slug: string) {
    const store = await this.stores.getPublicBySlug(slug);
    return this.offers.publicList(store.id);
  }

  /** Chi tiet uu dai kem "Dieu kien ap dung" do may chu sinh tu du lieu */
  @Get('stores/:slug/offers/:id')
  async offerDetail(@Param('slug') slug: string, @Param('id', orderIdPipe) id: string) {
    const store = await this.stores.getPublicBySlug(slug);
    return this.offers.publicDetail(store.id, id);
  }

  /**
   * Kiem tra ma theo tam tinh: chi tra hop le/khong va so giam du kien, KHONG tru gi.
   * Kem items: may chu tu tinh tam tinh (bo qua subtotal cua client) va tra them `quote` (VAT, tong).
   */
  @Post('stores/:slug/offers/check')
  @UseGuards(PublicQuoteThrottleGuard)
  async offerCheck(@Param('slug') slug: string, @Body() dto: PublicOfferCheckDto) {
    const store = await this.stores.getPublicBySlug(slug);
    if (!dto.items) return this.offers.publicCheck(store.id, dto.code, dto.subtotal ?? 0);
    const quote = await this.buildQuote(store.id, dto.items, dto.code);
    return { ...quote.check, quote: quote.quote };
  }

  /** Bao gia gio hang: tam tinh + giam du kien + VAT + tong cong, tinh o may chu bang cung ham voi luc tao don */
  @Post('stores/:slug/quote')
  @UseGuards(PublicQuoteThrottleGuard)
  async quote(@Param('slug') slug: string, @Body() dto: PublicQuoteDto) {
    const store = await this.stores.getPublicBySlug(slug);
    const q = await this.buildQuote(store.id, dto.items, dto.code);
    return { ...q.quote, offer: q.check };
  }

  private async buildQuote(storeId: string, items: PublicQuoteDto['items'], code?: string) {
    const priced = await this.orders.quoteItems(storeId, items);
    const check = code?.trim() ? await this.offers.publicCheck(storeId, code, priced.subtotal) : null;
    const discount = check && 'valid' in check && check.valid ? (check as { discountAmount: number }).discountAmount : 0;
    const t = calcTotals(priced.subtotal, discount, priced.settings);
    const s = priced.settings;
    return {
      check: check ?? { valid: false, message: 'Chưa nhập mã ưu đãi' },
      quote: {
        subtotal: priced.subtotal,
        discountAmount: discount,
        vatEnabled: s.vatEnabled === true,
        vatPercent: s.vatEnabled === true ? (typeof s.vatRate === 'number' ? s.vatRate : 10) : 0,
        vatAmount: t.vatAmount,
        totalAmount: t.totalAmount,
        lines: priced.lines,
      },
    };
  }

  /** Khach goi mon (BRD 8.2, source = QR) */
  @Post('stores/:slug/orders')
  @UseGuards(PublicOrderThrottleGuard)
  async createOrder(@Param('slug') slug: string, @Body() dto: CreateOrderDto) {
    const store = await this.stores.getPublicBySlug(slug);
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động');
    }
    return this.orders.createOrder({
      storeId: store.id,
      tableId: dto.tableId,
      tableCode: dto.tableCode,
      items: dto.items,
      customerNote: dto.customerNote,
      source: OrderSource.QR,
      actor: null,
      customer: dto.customer,
      clientRequestId: dto.clientRequestId,
      sessionToken: dto.sessionToken,
      voucherCode: dto.voucherCode,
    });
  }

  /** Khach theo doi don cua minh (BRD FR-CUST-11) */
  @Get('orders/:id')
  order(@Param('id', orderIdPipe) id: string) {
    return this.orders.getPublicOne(id);
  }

  /**
   * Hoa don cua ban (chi doc) cho khach: cac dot goi, tong, giam gia, da tra/con lai.
   * Khoa bang orderId cua don thuoc phien (don khach da gui) - don cu chua luu token van xem duoc.
   */
  @Get('orders/:id/bill')
  @UseGuards(PublicReadThrottleGuard)
  orderBill(@Param('id', orderIdPipe) id: string) {
    return this.bills.publicByOrder(id);
  }

  /** Hoa don cua ban theo token phien (token do POST orders tra ve, 128 bit ngau nhien) */
  @Get('sessions/:token')
  @UseGuards(PublicReadThrottleGuard)
  session(@Param('token') token: string) {
    return this.bills.publicByToken(token);
  }

  /** Khach xem co can/duoc danh gia don nay khong (module staff_rating) */
  @Get('orders/:id/review')
  reviewStatus(@Param('id', orderIdPipe) id: string) {
    return this.reviews.getStatus(id);
  }

  /** Khach gui danh gia sau thanh toan (module staff_rating) */
  @Post('orders/:id/review')
  submitReview(@Param('id', orderIdPipe) id: string, @Body() dto: CreateReviewDto) {
    return this.reviews.createPublic(id, dto);
  }

  /** Khach bam "Goi nhan vien" tai ban — bao realtime cho nhan vien quan */
  @Post('stores/:slug/tables/:tableCode/call-staff')
  async callStaff(
    @Param('slug') slug: string,
    @Param('tableCode') tableCode: string,
    @Body() dto: CreateTableCallDto,
  ) {
    const store = await this.stores.getPublicBySlug(slug);
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động');
    }
    return this.tableCalls.createPublic(store.id, tableCode, dto);
  }
}
