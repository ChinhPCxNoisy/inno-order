import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    return this.prisma.user.findMany({
      where: { storeId },
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(actor: JwtUser, storeId: string, dto: CreateUserDto) {
    assertStoreAccess(actor, storeId);
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Cần có email hoặc số điện thoại');
    }
    if (dto.email) {
      const dup = await this.prisma.user.findUnique({
        where: { storeId_email: { storeId, email: dto.email.toLowerCase() } },
      });
      if (dup) throw new ConflictException('Email đã tồn tại trong quán');
    }
    if (dto.phone) {
      const dup = await this.prisma.user.findUnique({
        where: { storeId_phone: { storeId, phone: dto.phone } },
      });
      if (dup) throw new ConflictException('Số điện thoại đã tồn tại trong quán');
    }

    const created = await this.prisma.user.create({
      data: {
        storeId,
        name: dto.name,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
      },
      select: PUBLIC_USER_SELECT,
    });

    await this.audit.log({
      action: 'create_user',
      entityType: 'User',
      entityId: created.id,
      storeId,
      userId: actor.id,
      afterData: { name: created.name, role: created.role },
    });
    return created;
  }

  async update(actor: JwtUser, storeId: string, userId: string, dto: UpdateUserDto) {
    assertStoreAccess(actor, storeId);
    const target = await this.prisma.user.findFirst({
      where: { id: userId, storeId },
    });
    if (!target) throw new NotFoundException('Nhân viên không tồn tại');

    const isSelf = actor.id === userId;
    if (isSelf && (dto.status === 'DISABLED' || dto.role !== undefined)) {
      throw new BadRequestException('Không thể tự sửa vai trò / khóa tài khoản của mình');
    }
    if (target.role === UserRole.OWNER && actor.role !== UserRole.OWNER && actor.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Không đủ quyền sửa tài khoản Owner');
    }

    const before = { role: target.role, status: target.status, name: target.name };
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email ? dto.email.toLowerCase() : null;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password !== undefined) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_USER_SELECT,
    });

    await this.audit.log({
      action: dto.password ? 'reset_user_password' : 'update_user',
      entityType: 'User',
      entityId: userId,
      storeId,
      userId: actor.id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: {
        role: updated.role,
        status: updated.status,
        name: updated.name,
      } as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }
}
