import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import {
  CreateAreaDto,
  CreateTableDto,
  TableStatusDto,
  UpdateAreaDto,
  UpdateTableDto,
} from './dto/table.dto';
import { TablesService } from './tables.service';

const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const READ = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];

@Controller('stores/:storeId')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  // ---------- Khu vuc ----------

  @Get('areas')
  @Roles(...READ)
  listAreas(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.tables
      .list(user, storeId)
      .then((r) => r.areas);
  }

  @Post('areas')
  @Roles(...MANAGE)
  createArea(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Body() dto: CreateAreaDto,
  ) {
    return this.tables.createArea(user, storeId, dto);
  }

  @Patch('areas/:id')
  @Roles(...MANAGE)
  updateArea(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAreaDto,
  ) {
    return this.tables.updateArea(user, storeId, id, dto);
  }

  // ---------- Ban ----------

  @Get('tables')
  @Roles(...READ)
  listTables(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.tables.list(user, storeId);
  }

  @Get('tables/:id')
  @Roles(...READ)
  getTable(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.tables.getOne(user, storeId, id);
  }

  @Post('tables')
  @Roles(...MANAGE)
  createTable(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.tables.createTable(user, storeId, dto);
  }

  @Patch('tables/:id')
  @Roles(...MANAGE)
  updateTable(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tables.updateTable(user, storeId, id, dto);
  }

  @Delete('tables/:id')
  @Roles(...MANAGE)
  deleteTable(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.tables.deleteTable(user, storeId, id);
  }

  /** Da don / khoa ban / mo ban (BRD 8.5) */
  @Post('tables/:id/status')
  @Roles(...READ)
  changeStatus(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: TableStatusDto,
  ) {
    return this.tables.changeStatus(user, storeId, id, dto);
  }
}
