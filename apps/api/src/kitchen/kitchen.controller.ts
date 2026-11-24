import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { OrdersService } from '../orders/orders.service';
import { SetItemStatusDto } from '../orders/dto/order.dto';

const KDS = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];

@Controller('stores/:storeId/kitchen')
export class KitchenController {
  constructor(private readonly orders: OrdersService) {}

  /** Don dang cho / dang lam / ready (BRD FR-KDS-01) */
  @Get('orders')
  @Roles(...KDS)
  listOrders(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.orders.kitchenOrders(user, storeId);
  }

  /** Nhap don (BRD FR-KDS-03) */
  @Post('orders/:id/accept')
  @Roles(...KDS)
  accept(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id') id: string) {
    return this.orders.acceptOrder(user, storeId, id);
  }

  /** Toan bo don sang READY (BRD FR-KDS-05) */
  @Post('orders/:id/ready')
  @Roles(...KDS)
  ready(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id') id: string) {
    return this.orders.readyOrder(user, storeId, id);
  }

  /** Doi trang thai 1 mon (BRD FR-KDS-04/05) */
  @Post('orders/:id/items/:itemId/status')
  @Roles(...KDS)
  setItemStatus(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: SetItemStatusDto,
  ) {
    return this.orders.setItemStatus(user, storeId, id, itemId, dto);
  }
}
