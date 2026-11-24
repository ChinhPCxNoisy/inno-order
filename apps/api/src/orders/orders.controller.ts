import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OrderSource, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { OrdersService } from './orders.service';
import {
  CancelOrderDto,
  CreateOrderDto,
  PayOrderDto,
  RefundOrderDto,
  SetItemStatusDto,
  SetOrderStatusDto,
} from './dto/order.dto';

const ALL_STAFF = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];
const CASH = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER];
const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];

@Controller('stores/:storeId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Tao don tu POS/ADMIN (BRD FR-ORD-02) */
  @Post()
  @Roles(...ALL_STAFF)
  create(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder({
      storeId,
      tableId: dto.tableId,
      tableCode: dto.tableCode,
      items: dto.items,
      customerNote: dto.customerNote,
      source: dto.source ?? OrderSource.POS,
      actor: user,
      customer: dto.customer,
    });
  }

  /** Lich su don (BRD FR-ORD-11) */
  @Get()
  @Roles(...ALL_STAFF)
  list(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('tableId') tableId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orders.list(user, storeId, {
      status,
      tableId,
      from,
      to,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  @Roles(...ALL_STAFF)
  getOne(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id') id: string) {
    return this.orders.getOne(user, storeId, id);
  }

  @Patch(':id/status')
  @Roles(...ALL_STAFF)
  setStatus(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: SetOrderStatusDto,
  ) {
    return this.orders.setOrderStatus(user, storeId, id, dto);
  }

  @Post(':id/cancel')
  @Roles(...CASH)
  cancel(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancelOrder(user, storeId, id, dto);
  }

  /** Hoan tien - can quan ly (BRD 8.7) */
  @Post(':id/refund')
  @Roles(...MANAGE)
  refund(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
  ) {
    return this.orders.refundOrder(user, storeId, id, dto);
  }

  /** Huy 1 mon trong don (BRD FR-ORD-08) */
  @Post(':id/items/:itemId/cancel')
  @Roles(...CASH)
  cancelItem(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancelItem(user, storeId, id, itemId, dto);
  }

  @Post(':id/items/:itemId/status')
  @Roles(...ALL_STAFF)
  setItemStatus(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: SetItemStatusDto,
  ) {
    return this.orders.setItemStatus(user, storeId, id, itemId, dto);
  }

  @Post(':id/reprint')
  @Roles(...CASH)
  reprint(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() body: { kind?: 'bill' | 'kitchen' | 'bar'; reason?: string },
  ) {
    return this.orders.reprint(user, storeId, id, body.kind ?? 'bill', body.reason);
  }
}
