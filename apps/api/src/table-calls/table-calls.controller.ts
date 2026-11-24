import { Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { TableCallsService } from './table-calls.service';

const ALL_STAFF = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];

/** Nhan vien quan xem/xu ly yeu cau "Goi nhan vien" tu khach tai ban */
@Controller('stores/:storeId/table-calls')
export class TableCallsController {
  constructor(private readonly calls: TableCallsService) {}

  @Get()
  @Roles(...ALL_STAFF)
  list(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.calls.listPending(user, storeId);
  }

  @Patch(':id/resolve')
  @Roles(...ALL_STAFF)
  resolve(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id') id: string) {
    return this.calls.resolve(user, storeId, id);
  }
}
