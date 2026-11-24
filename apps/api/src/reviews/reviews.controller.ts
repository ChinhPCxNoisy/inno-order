import { Controller, Get, Param, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { ReviewsService } from './reviews.service';

/** Chu quan xem danh gia cua khach (module staff_rating) — cung quyen voi trang Bao cao */
@Controller('stores/:storeId/reviews')
@Roles(UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reviews.listForStore(user, storeId, from, to);
  }
}
