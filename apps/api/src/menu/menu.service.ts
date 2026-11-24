import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { storeBrand } from '../stores/stores.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money } from '../common/utils/money';
import {
  CreateCategoryDto,
  CreateItemDto,
  CreateOptionDto,
  UpdateCategoryDto,
  UpdateItemDto,
  UpdateOptionDto,
} from './dto/menu.dto';

// Anh mon upload tu dien thoai: nen + resize ve toi da 1000px, luu local (xem main.ts)
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'menu');
const MAX_IMAGE_WIDTH = 1000;
// Safari tren iPhone tu chuyen HEIC -> JPEG khi upload qua web nen chi can nhan 3 dinh dang pho bien
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const CATEGORY_WITH_ITEMS = {
  items: {
    include: { options: { orderBy: { sortOrder: 'asc' as const } } },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.MenuCategoryInclude;

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Menu cho khach (public theo slug): chi mon + danh muc dang bat */
  async getPublicMenu(slug: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store) throw new NotFoundException('Quán không tồn tại, vui lòng kiểm tra lại mã QR');
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('Quán đang tạm ngừng hoạt động');
    }
    const categories = await this.prisma.menuCategory.findMany({
      where: { storeId: store.id, active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: { options: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    return {
      store: storeBrand(store),
      categories: categories
        .filter((c) => c.items.length > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          items: c.items.map((it) => ({
            id: it.id,
            name: it.name,
            description: it.description,
            imageUrl: it.imageUrl,
            price: money(it.price),
            prepTimeMinutes: it.prepTimeMinutes,
            tags: it.tags,
            options: it.options.map((o) => ({
              id: o.id,
              groupName: o.groupName,
              optionName: o.optionName,
              extraPrice: money(o.extraPrice),
              isRequired: o.isRequired,
              sortOrder: o.sortOrder,
            })),
          })),
        })),
    };
  }

  /** Menu admin: bao gom ca mon/tanh dang tat */
  async listAdmin(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const categories = await this.prisma.menuCategory.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
      include: CATEGORY_WITH_ITEMS,
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      active: c.active,
      station: c.station,
      items: c.items.map((it) => ({
        id: it.id,
        printStation: it.printStation,
        name: it.name,
        description: it.description,
        imageUrl: it.imageUrl,
        price: money(it.price),
        active: it.active,
        prepTimeMinutes: it.prepTimeMinutes,
        sortOrder: it.sortOrder,
        tags: it.tags,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
        options: it.options.map((o) => ({
          id: o.id,
          groupName: o.groupName,
          optionName: o.optionName,
          extraPrice: money(o.extraPrice),
          isRequired: o.isRequired,
          sortOrder: o.sortOrder,
        })),
      })),
    }));
  }

  async createCategory(user: JwtUser, storeId: string, dto: CreateCategoryDto) {
    assertStoreAccess(user, storeId);
    const dup = await this.prisma.menuCategory.findFirst({
      where: { storeId, name: dto.name },
    });
    if (dup) throw new ConflictException('Danh mục đã tồn tại');
    const created = await this.prisma.menuCategory.create({
      data: {
        storeId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        station: dto.station ?? 'KITCHEN',
      },
    });
    await this.audit.log({
      action: 'create_category',
      entityType: 'MenuCategory',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { name: created.name },
    });
    return created;
  }

  async updateCategory(user: JwtUser, storeId: string, id: string, dto: UpdateCategoryDto) {
    assertStoreAccess(user, storeId);
    const cat = await this.prisma.menuCategory.findFirst({ where: { id, storeId } });
    if (!cat) throw new NotFoundException('Danh mục không tồn tại');
    const updated = await this.prisma.menuCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.station !== undefined ? { station: dto.station } : {}),
      },
    });
    return updated;
  }

  /** Upload anh mon tu dien thoai/may tinh: nen + resize, luu local, tra ve URL de gan vao imageUrl */
  async uploadImage(user: JwtUser, storeId: string, file?: Express.Multer.File) {
    assertStoreAccess(user, storeId);
    if (!file) throw new BadRequestException('Chưa chọn ảnh để tải lên');
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Chỉ nhận ảnh JPG, PNG hoặc WEBP');
    }

    const dir = join(UPLOAD_DIR, storeId);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.webp`;

    try {
      await sharp(file.buffer)
        .rotate() // xoay anh dung chieu theo EXIF (anh chup ngang/doc tu dien thoai)
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(join(dir, filename));
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ hoặc bị lỗi, vui lòng chọn ảnh khác');
    }

    return { url: `/api/v1/uploads/menu/${storeId}/${filename}` };
  }

  async createItem(user: JwtUser, storeId: string, dto: CreateItemDto) {
    assertStoreAccess(user, storeId);
    const cat = await this.prisma.menuCategory.findFirst({
      where: { id: dto.categoryId, storeId },
    });
    if (!cat) throw new BadRequestException('Danh mục không tồn tại');

    const created = await this.prisma.menuItem.create({
      data: {
        storeId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl,
        price: dto.price,
        prepTimeMinutes: dto.prepTimeMinutes,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        printStation: dto.printStation ?? null,
        tags: (dto.tags ?? '[]') as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      action: 'create_item',
      entityType: 'MenuItem',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { name: created.name, price: created.price.toString() },
    });
    return created;
  }

  async updateItem(user: JwtUser, storeId: string, id: string, dto: UpdateItemDto) {
    assertStoreAccess(user, storeId);
    const item = await this.prisma.menuItem.findFirst({ where: { id, storeId } });
    if (!item) throw new NotFoundException('Món không tồn tại');

    if (dto.categoryId) {
      const cat = await this.prisma.menuCategory.findFirst({
        where: { id: dto.categoryId, storeId },
      });
      if (!cat) throw new BadRequestException('Danh mục không tồn tại');
    }

    const priceChanged =
      dto.price !== undefined && Math.abs(money(item.price) - dto.price) > 0.001;
    const activeChanged =
      dto.active !== undefined && dto.active !== item.active;

    const updated = await this.prisma.menuItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.prepTimeMinutes !== undefined
          ? { prepTimeMinutes: dto.prepTimeMinutes }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.printStation !== undefined ? { printStation: dto.printStation } : {}),
        ...(dto.tags !== undefined
          ? { tags: dto.tags as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    if (priceChanged) {
      await this.audit.log({
        action: 'price_change',
        entityType: 'MenuItem',
        entityId: id,
        storeId,
        userId: user.id,
        beforeData: { price: money(item.price) },
        afterData: { price: dto.price },
      });
    }
    if (activeChanged) {
      await this.audit.log({
        action: dto.active ? 'enable_item' : 'disable_item',
        entityType: 'MenuItem',
        entityId: id,
        storeId,
        userId: user.id,
        afterData: { active: updated.active },
      });
    }
    if (!priceChanged && !activeChanged) {
      await this.audit.log({
        action: 'update_item',
        entityType: 'MenuItem',
        entityId: id,
        storeId,
        userId: user.id,
      });
    }
    return updated;
  }

  async createOption(user: JwtUser, storeId: string, itemId: string, dto: CreateOptionDto) {
    assertStoreAccess(user, storeId);
    const item = await this.prisma.menuItem.findFirst({ where: { id: itemId, storeId } });
    if (!item) throw new NotFoundException('Món không tồn tại');
    const created = await this.prisma.menuOption.create({
      data: {
        storeId,
        menuItemId: itemId,
        groupName: dto.groupName,
        optionName: dto.optionName,
        extraPrice: dto.extraPrice ?? 0,
        isRequired: dto.isRequired ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return created;
  }

  async updateOption(user: JwtUser, storeId: string, itemId: string, optionId: string, dto: UpdateOptionDto) {
    assertStoreAccess(user, storeId);
    const opt = await this.prisma.menuOption.findFirst({
      where: { id: optionId, menuItemId: itemId, storeId },
    });
    if (!opt) throw new NotFoundException('Tùy chọn không tồn tại');
    const updated = await this.prisma.menuOption.update({
      where: { id: optionId },
      data: {
        ...(dto.groupName !== undefined ? { groupName: dto.groupName } : {}),
        ...(dto.optionName !== undefined ? { optionName: dto.optionName } : {}),
        ...(dto.extraPrice !== undefined ? { extraPrice: dto.extraPrice } : {}),
        ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return updated;
  }

  async deleteOption(user: JwtUser, storeId: string, itemId: string, optionId: string) {
    assertStoreAccess(user, storeId);
    const opt = await this.prisma.menuOption.findFirst({
      where: { id: optionId, menuItemId: itemId, storeId },
    });
    if (!opt) throw new NotFoundException('Tùy chọn không tồn tại');
    await this.prisma.menuOption.delete({ where: { id: optionId } });
    return { ok: true };
  }
}
