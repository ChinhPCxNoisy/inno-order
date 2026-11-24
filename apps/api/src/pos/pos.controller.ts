import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { OrdersService } from '../orders/orders.service';
import { TablesService } from '../tables/tables.service';
import { PayOrderDto } from '../orders/dto/order.dto';

const CASH = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER];
const READ = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
];

@Controller('stores/:storeId/pos')
export class PosController {
  constructor(
    private readonly orders: OrdersService,
    private readonly tables: TablesService,
  ) {}

  /** Bang ban + tong tien dang mo (BRD FR-POS-01) */
  @Get('tables')
  @Roles(...READ)
  tablesList(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.tables.list(user, storeId);
  }

  /** Don dang mo cua ban (BRD FR-POS-02) */
  @Get('tables/:id/orders')
  @Roles(...READ)
  tableOrders(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.orders.openOrdersForTable(user, storeId, id);
  }

  /** Thanh toan (BRD FR-POS-03/04/08) */
  @Post('orders/:id/payment')
  @Roles(...CASH)
  pay(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
  ) {
    return this.orders.payOrder(user, storeId, id, dto);
  }

  /** In lai bill (BRD FR-POS-09) */
  @Post('orders/:id/reprint-bill')
  @Roles(...CASH)
  reprintBill(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.orders.reprint(user, storeId, id, 'bill');
  }
}
