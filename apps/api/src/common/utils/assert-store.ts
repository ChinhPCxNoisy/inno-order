import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtUser } from '../types/jwt-user.interface';

/**
 * Chuan doan truy cap theo tenant (BRD 10.1):
 * - SUPER_ADMIN: duoc truy cap moi quan
 * - Nhan vien quan: chi duoc truy cap quan cua minh (user.storeId)
 */
export function assertStoreAccess(user: JwtUser, storeId: string): void {
  if (user.role === UserRole.SUPER_ADMIN) return;
  if (!user.storeId) throw new ForbiddenException('Tài khoản không thuộc quán nào');
  if (user.storeId !== storeId) {
    throw new ForbiddenException('Không đủ quyền truy cập quán này');
  }
}
