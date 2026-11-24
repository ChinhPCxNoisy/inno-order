import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Request() req: { ip?: string }) {
    return this.auth.login(dto, req.ip);
  }

  @Post('logout')
  logout(@CurrentUser() user: JwtUser, @Request() req: { ip?: string }) {
    return this.auth.logout(user.id, req.ip);
  }

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}
