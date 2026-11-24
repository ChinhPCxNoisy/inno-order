import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { JwtUser } from '../common/types/jwt-user.interface';
import { LoginDto } from './dto/auth.dto';
import { LoginThrottle } from './login-throttle';

/** Khoa tam dang nhap: xem login-throttle.ts (theo IP + tai khoan, kem tran theo IP) */
const throttle = new LoginThrottle();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    throttle.assertNotLocked(dto.login, ip);
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.login.toLowerCase() },
          { phone: dto.login },
        ],
      },
    });

    if (!user || !user.passwordHash) {
      throttle.recordFail(dto.login, ip);
      throw new UnauthorizedException('Sai thông tin đăng nhập');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throttle.recordFail(dto.login, ip);
      await this.audit.log({
        action: 'login_failed',
        entityType: 'User',
        entityId: user.id,
        storeId: user.storeId,
        ipAddress: ip,
      });
      throw new UnauthorizedException('Sai thông tin đăng nhập');
    }

    throttle.recordSuccess(dto.login, ip);
    await this.audit.log({
      action: 'login',
      entityType: 'User',
      entityId: user.id,
      storeId: user.storeId,
      userId: user.id,
      ipAddress: ip,
    });

    return this.buildTokenResponse(user);
  }

  async logout(userId: string, ip?: string) {
    // MVP: token do client tu bo (JWT stateless), chi ghi log
    await this.audit.log({
      action: 'logout',
      entityType: 'User',
      entityId: userId,
      userId,
      ipAddress: ip,
    });
    return { ok: true };
  }

  async me(user: JwtUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        storeId: true,
        createdAt: true,
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            status: true,
            settings: true,
          },
        },
      },
    });
    if (!dbUser) throw new UnauthorizedException('Tài khoản không tồn tại');
    if (!dbUser.store) return dbUser;
    // Chi tra WHITELIST co van hanh cho giao dien theo vai tro; khong lo thanh toan/han muc/in/khoa
    const pos = ((dbUser.store.settings ?? {}) as Record<string, any>).pos ?? {};
    return {
      ...dbUser,
      store: { ...dbUser.store, settings: { pos: { allowWaiterMoveTable: pos.allowWaiterMoveTable === true } } },
    };
  }

  async changePassword(
    user: JwtUser,
    currentPassword: string,
    newPassword: string,
  ) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) throw new UnauthorizedException('Tài khoản không tồn tại');

    const ok = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!ok) throw new UnauthorizedException('Mật khẩu hiện tại sai');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: dbUser.id },
      data: { passwordHash },
    });

    await this.audit.log({
      action: 'change_password',
      entityType: 'User',
      entityId: dbUser.id,
      storeId: dbUser.storeId,
      userId: dbUser.id,
    });
    return { ok: true };
  }

  private buildTokenResponse(user: {
    id: string;
    storeId: string | null;
    name: string;
    email: string | null;
    role: string;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      storeId: user.storeId,
      role: user.role,
      name: user.name,
      email: user.email,
    };
    const expiresInRaw = this.config.get<string>('jwt.expiresIn') ?? '7d';
    const token = this.jwt.sign(payload, {
      expiresIn: expiresInRaw as unknown as number,
    });
    return {
      accessToken: token,
      expiresIn: expiresInRaw,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      },
    };
  }
}
