import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { ReportsService } from './reports.service';

const CAN_REPORT = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER];

@Controller('stores/:storeId/reports')
@Roles(...CAN_REPORT)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Bao cao ngay: doanh thu, so don, mon ban chay, theo phuong thuc (BRD 9.11) */
  @Get('daily')
  daily(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('date') date?: string,
  ) {
    return this.reports.daily(user, storeId, date);
  }

  /** So luot dung + tong giam theo uu dai */
  @Get('offers')
  offers(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.offers(user, storeId, from, to);
  }

  @Get('items')
  items(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.items(user, storeId, from, to);
  }

  @Get('payments')
  payments(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.payments(user, storeId, from, to);
  }

  /** So mon/ban da phuc vu + rating trung binh theo tung nhan vien */
  @Get('staff')
  staff(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.staff(user, storeId, from, to);
  }
}
