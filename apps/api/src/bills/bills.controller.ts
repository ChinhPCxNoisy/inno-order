import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { RefundOrderDto } from '../orders/dto/order.dto';
import { BillsService } from './bills.service';
import { SessionsService } from './sessions.service';
import {
  AddBillDiscountDto,
  ApplyOfferDto,
  CheckOfferDto,
  BillListQueryDto,
  MergeSessionDto,
  MoveTableDto,
  PayBillDto,
  PrintBillDto,
  SplitPreviewDto,
} from './dto/bill.dto';

const CASH = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER];
const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const READ = [...CASH, UserRole.WAITER];

const uuid = (msg: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException(msg) });
const tablePipe = uuid('Bàn không tồn tại');
const sessionPipe = uuid('Phiên bàn không tồn tại');
const billPipe = uuid('Hóa đơn không tồn tại');

/** Hoa don ban cho POS/admin (thanh toan gop theo ban, chia bill, giam gia cap ban, hoan tien) */
@Controller('stores/:storeId/pos')
export class BillsController {
  constructor(
    private readonly bills: BillsService,
    private readonly sessions: SessionsService,
  ) {}

  /** Doi ban: don sang ban moi, ban cu NEED_CLEAN (phuc vu chi khi quan bat allowWaiterMoveTable) */
  @Post('sessions/:sessionId/move-table')
  @Roles(...READ)
  moveTable(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('sessionId', sessionPipe) sessionId: string,
    @Body() dto: MoveTableDto,
  ) {
    return this.sessions.moveTable(user, storeId, sessionId, dto);
  }

  /** Gop phien nguon vao phien nay (mot hoa don). Khong hoan tac */
  @Post('sessions/:sessionId/merge')
  @Roles(...CASH)
  merge(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('sessionId', sessionPipe) sessionId: string,
    @Body() dto: MergeSessionDto,
  ) {
    return this.sessions.merge(user, storeId, sessionId, dto);
  }

  /** Phien dang mo cua ban + cac dot goi + hoa don/tam tinh (WAITER chi doc) */
  @Get('tables/:tableId/session')
  @Roles(...READ)
  session(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('tableId', tablePipe) tableId: string,
  ) {
    return this.bills.tableSession(user, storeId, tableId);
  }

  /** Tao hoac lay hoa don cua phien (idempotent) */
  @Post('sessions/:sessionId/bill')
  @Roles(...CASH)
  ensureBill(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('sessionId', sessionPipe) sessionId: string,
  ) {
    return this.bills.ensureBill(user, storeId, sessionId);
  }

  /** Lich su hoa don cua quan */
  @Get('bills')
  @Roles(...CASH)
  list(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query() q: BillListQueryDto,
  ) {
    return this.bills.listBills(user, storeId, q);
  }

  @Get('bills/:billId')
  @Roles(...READ)
  get(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
  ) {
    return this.bills.getBill(user, storeId, billId);
  }

  /** Giam gia cap ban (thu ngan co han muc, vuot thi can quan ly duyet) */
  @Post('bills/:billId/discounts')
  @Roles(...CASH)
  addDiscount(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: AddBillDiscountDto,
  ) {
    return this.bills.addDiscount(user, storeId, billId, dto);
  }

  @Delete('bills/:billId/discounts/:discountId')
  @Roles(...CASH)
  removeDiscount(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Param('discountId', uuid('Khoản giảm giá không tồn tại')) discountId: string,
  ) {
    return this.bills.removeDiscount(user, storeId, billId, discountId);
  }

  /** Xem truoc so tien tung phan khi chia deu / chia theo mon */
  @Post('bills/:billId/split/preview')
  @Roles(...CASH)
  splitPreview(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: SplitPreviewDto,
  ) {
    return this.bills.splitPreview(user, storeId, billId, dto);
  }

  /** Thanh toan hoa don (du / mot phan / tung phan cua chia bill) */
  @Post('bills/:billId/payments')
  @Roles(...CASH)
  pay(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: PayBillDto,
  ) {
    return this.bills.pay(user, storeId, billId, dto);
  }

  /** Ap ma uu dai (giam gia VOUCHER) len hoa don; ngoai le/cong don can quan ly duyet */
  @Post('bills/:billId/offers')
  @Roles(...CASH)
  applyOffer(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: ApplyOfferDto,
  ) {
    return this.bills.applyOffer(user, storeId, billId, dto);
  }

  /** Kiem tra ma cho hoa don (khong tru luot) */
  @Post('bills/:billId/offers/check')
  @Roles(...CASH)
  checkOffer(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: CheckOfferDto,
  ) {
    return this.bills.checkOffer(user, storeId, billId, dto.code);
  }

  /** In tam tinh (PRE_BILL) hoac in lai bill da thanh toan (BILL) */
  @Post('bills/:billId/print')
  @Roles(...CASH)
  printBill(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: PrintBillDto,
  ) {
    return this.bills.printBill(user, storeId, billId, dto.kind);
  }

  /** Hoan tien ca hoa don (quan ly/chu quan) */
  @Post('bills/:billId/refund')
  @Roles(...MANAGE)
  refund(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('billId', billPipe) billId: string,
    @Body() dto: RefundOrderDto,
  ) {
    return this.bills.refund(user, storeId, billId, dto);
  }
}
