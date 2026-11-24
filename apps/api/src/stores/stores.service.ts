import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma, Store, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { isValidModuleKey } from '../common/modules';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { mergeStoreSettings } from './settings-merge';
import { BILL_OPEN, recalcBill } from '../bills/bill-core';

/** Cau hinh branding + mini app cua quan (BRD FR-STORE-08, section 16) */
export interface StoreBrand {
  name: string;
  slug: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  themeColor: string | null;
  welcomeText: string | null;
  paymentNote: string | null;
  showVoucherTab: boolean;
  showZaloLogin: boolean;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asBool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

/** Trich tuong branding cho mini app tu settings jsonb (chu dao: themeColor mac dinh xanh) */
export function storeBrand(store: {
  name: string;
  slug: string;
  logoUrl: string | null;
  settings: Prisma.JsonValue | null;
}): StoreBrand {
  const s = (store.settings ?? {}) as Record<string, unknown>;
  return {
    name: store.name,
    slug: store.slug,
    logoUrl: store.logoUrl,
    bannerUrl: asStr(s.bannerUrl),
    themeColor: asStr(s.themeColor),
    welcomeText: asStr(s.welcomeText),
    paymentNote: asStr(s.paymentNote),
    showVoucherTab: asBool(s.showVoucherTab, true),
    showZaloLogin: asBool(s.showZaloLogin, true),
  };
}

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lay quan theo id, kiem tra ton tai + hoat dong */
  async getActiveOrThrow(storeId: string): Promise<Store> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Quán không tồn tại');
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động');
    }
    return store;
  }

  async getPublicBySlug(slug: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store) throw new NotFoundException('Quán không tồn tại, vui lòng kiểm tra lại mã QR');
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      logoUrl: store.logoUrl,
      phone: store.phone,
      address: store.address,
      status: store.status,
      settings: store.settings,
    };
  }

  async listAll() {
    const stores = await this.prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tables: true, users: true, orders: true } },
      },
    });
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      logoUrl: s.logoUrl,
      phone: s.phone,
      address: s.address,
      status: s.status,
      settings: s.settings,
      enabledModules: s.enabledModules,
      createdAt: s.createdAt,
      tables: s._count.tables,
      users: s._count.users,
      orders: s._count.orders,
    }));
  }

  async create(user: JwtUser, dto: CreateStoreDto) {
    const exists = await this.prisma.store.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException('Slug đã tồn tại');

    const store = await this.prisma.$transaction(async (tx) => {
      const s = await tx.store.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          logoUrl: dto.logoUrl,
          phone: dto.phone,
          address: dto.address,
          settings: mergeStoreSettings({}, dto.settings, { canEditOwnerOnly: true }) as Prisma.InputJsonValue,
        },
      });
      if (dto.owner) {
        await tx.user.create({
          data: {
            storeId: s.id,
            name: dto.owner.name,
            email: dto.owner.email?.toLowerCase(),
            phone: dto.owner.phone,
            passwordHash: await bcrypt.hash(dto.owner.password, 10),
            role: UserRole.OWNER,
          },
        });
      }
      return s;
    });

    await this.audit.log({
      action: 'create_store',
      entityType: 'Store',
      entityId: store.id,
      storeId: store.id,
      userId: user.id,
      afterData: { name: store.name, slug: store.slug },
    });
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      status: store.status,
      createdAt: store.createdAt,
    };
  }

  async update(user: JwtUser, storeId: string, dto: UpdateStoreDto) {
    assertStoreAccess(user, storeId);
    const isSuper = user.role === UserRole.SUPER_ADMIN;
    // Doc-sua-ghi trong 1 transaction co khoa dong quan: settings duoc GOP theo khoa (khong thay ca khoi),
    // tuan tu voi cac endpoint hep (payment-settings...) cung ghi vao settings.
    const { store, updated } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR UPDATE`;
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new NotFoundException('Quán không tồn tại');
      const data: Prisma.StoreUpdateInput = {};
      // Owner chi duoc doi thong tin cau hinh, khong doi ten quan (Super Admin moi duoc)
      if (dto.name !== undefined && isSuper) data.name = dto.name;
      if (dto.phone !== undefined) data.phone = dto.phone;
      if (dto.address !== undefined) data.address = dto.address;
      if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
      if (dto.settings !== undefined) {
        data.settings = mergeStoreSettings(store.settings, dto.settings, {
          canEditOwnerOnly: isSuper || user.role === UserRole.OWNER,
        }) as Prisma.InputJsonValue;
      }
      const updated = await tx.store.update({ where: { id: storeId }, data });
      // Doi VAT/lam tron: hoa don dang mo tinh lai ngay de so hien thi = so phai thu (hoa don da thanh toan khong dong toi)
      const pick = (x: unknown) => { const o = (x ?? {}) as Record<string, unknown>; return JSON.stringify([o.vatEnabled === true, o.vatRate ?? null, o.rounding ?? null]); };
      if (pick(store.settings) !== pick(updated.settings)) {
        const open = await tx.bill.findMany({ where: { storeId, status: { in: BILL_OPEN } }, select: { id: true } });
        for (const b of open) await recalcBill(tx, b.id);
      }
      return { store, updated };
    });
    const before = {
      name: store.name,
      phone: store.phone,
      address: store.address,
      logoUrl: store.logoUrl,
      settings: store.settings,
    };

    await this.audit.log({
      action: 'update_store',
      entityType: 'Store',
      entityId: storeId,
      storeId,
      userId: user.id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: {
        name: updated.name,
        phone: updated.phone,
        address: updated.address,
        logoUrl: updated.logoUrl,
        settings: updated.settings,
      } as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async setStatus(user: JwtUser, storeId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Chỉ Super Admin mới được khóa/mở quán');
    }
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Quán không tồn tại');

    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: { status },
    });
    await this.audit.log({
      action: status === 'SUSPENDED' ? 'suspend_store' : 'activate_store',
      entityType: 'Store',
      entityId: storeId,
      storeId,
      userId: user.id,
      afterData: { status, reason },
    });
    return updated;
  }

  /** Super Admin: bat/tat 1 module tra phi cho quan (BRD module staff_rating) */
  async setModule(user: JwtUser, storeId: string, moduleKey: string, enabled: boolean) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Chỉ Super Admin mới được bật/tắt module');
    }
    if (!isValidModuleKey(moduleKey)) {
      throw new BadRequestException('Module không hợp lệ');
    }
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Quán không tồn tại');

    const set = new Set(store.enabledModules);
    if (enabled) set.add(moduleKey);
    else set.delete(moduleKey);

    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: { enabledModules: Array.from(set) },
    });
    await this.audit.log({
      action: enabled ? 'enable_module' : 'disable_module',
      entityType: 'Store',
      entityId: storeId,
      storeId,
      userId: user.id,
      afterData: { module: moduleKey, enabled },
    });
    return { id: updated.id, enabledModules: updated.enabledModules };
  }
}
