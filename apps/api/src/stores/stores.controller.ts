import {
  Body,
  Controller,
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
  CreateStoreDto,
  UpdateStoreDto,
  UpdateStoreModulesDto,
  UpdateStoreStatusDto,
} from './dto/store.dto';
import { StoresService } from './stores.service';

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  /** Super Admin: danh sach moi quan */
  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  list() {
    return this.stores.listAll();
  }

  /** Super Admin: tao quan (tu onboarding, BRD 7.4) */
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateStoreDto) {
    return this.stores.create(user, dto);
  }

  /** Super Admin / Owner: cap nhat thong tin quan */
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER)
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateStoreDto) {
    return this.stores.update(user, id, dto);
  }

  /** Super Admin: kich hoat / tam khoa quan */
  @Patch(':id/status')
  @Roles(UserRole.SUPER_ADMIN)
  setStatus(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateStoreStatusDto,
  ) {
    return this.stores.setStatus(user, id, dto.status, dto.reason);
  }

  /** Super Admin: bat/tat module tra phi cho quan (vd: staff_rating) */
  @Patch(':id/modules')
  @Roles(UserRole.SUPER_ADMIN)
  setModules(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateStoreModulesDto,
  ) {
    return this.stores.setModule(user, id, dto.module, dto.enabled);
  }
}
