import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const idPipe = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('Ưu đãi không tồn tại') });

/** Quan ly uu dai cua quan (chu quan / quan ly) */
@Controller('stores/:storeId/offers')
@Roles(...MANAGE)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.offers.list(user, storeId);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: CreateOfferDto) {
    return this.offers.create(user, storeId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id', idPipe) id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offers.update(user, storeId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.offers.remove(user, storeId, id);
  }

  /** Luot dung + thong ke co ban */
  @Get(':id/redemptions')
  redemptions(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.offers.redemptions(user, storeId, id);
  }
}
