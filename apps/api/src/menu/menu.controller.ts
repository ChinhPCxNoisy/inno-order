import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { MenuService } from './menu.service';
import {
  CreateCategoryDto,
  CreateItemDto,
  CreateOptionDto,
  UpdateCategoryDto,
  UpdateItemDto,
  UpdateOptionDto,
} from './dto/menu.dto';

const READ = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];
const WRITE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];

@Controller('stores/:storeId/menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @Roles(...READ)
  list(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.menu.listAdmin(user, storeId);
  }

  // ---------- Danh muc ----------

  @Post('categories')
  @Roles(...WRITE)
  createCategory(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.menu.createCategory(user, storeId, dto);
  }

  @Patch('categories/:id')
  @Roles(...WRITE)
  updateCategory(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menu.updateCategory(user, storeId, id, dto);
  }

  // ---------- Mon an ----------

  @Post('items/upload-image')
  @Roles(...WRITE)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadImage(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.menu.uploadImage(user, storeId, file);
  }

  @Post('items')
  @Roles(...WRITE)
  createItem(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.menu.createItem(user, storeId, dto);
  }

  @Patch('items/:id')
  @Roles(...WRITE)
  updateItem(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menu.updateItem(user, storeId, id, dto);
  }

  // ---------- Tuy chon mon ----------

  @Post('items/:id/options')
  @Roles(...WRITE)
  createOption(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: CreateOptionDto,
  ) {
    return this.menu.createOption(user, storeId, id, dto);
  }

  @Patch('items/:itemId/options/:optionId')
  @Roles(...WRITE)
  updateOption(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('itemId') itemId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateOptionDto,
  ) {
    return this.menu.updateOption(user, storeId, itemId, optionId, dto);
  }

  @Delete('items/:itemId/options/:optionId')
  @Roles(...WRITE)
  deleteOption(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('itemId') itemId: string,
    @Param('optionId') optionId: string,
  ) {
    return this.menu.deleteOption(user, storeId, itemId, optionId);
  }
}
