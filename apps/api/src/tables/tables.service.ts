import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money } from '../common/utils/money';
import {
  CreateAreaDto,
  CreateTableDto,
  TableStatusDto,
  UpdateAreaDto,
  UpdateTableDto,
} from './dto/table.dto';

/** Cap cho phep chuyen trang thai ban (BRD 8.5) */
const TABLE_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: [TableStatus.OCCUPIED, TableStatus.LOCKED],
  OCCUPIED: [TableStatus.NEED_CLEAN, TableStatus.AVAILABLE, TableStatus.LOCKED],
  NEED_CLEAN: [TableStatus.AVAILABLE, TableStatus.OCCUPIED, TableStatus.LOCKED],
  CLEANED: [TableStatus.AVAILABLE],
  RESERVED: [TableStatus.OCCUPIED, TableStatus.AVAILABLE, TableStatus.LOCKED],
  LOCKED: [TableStatus.AVAILABLE, TableStatus.OCCUPIED],
};

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    const areas = await this.prisma.area.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            seats: true,
            status: true,
            qrCode: true,
            notes: true,
            updatedAt: true,
          },
        },
      },
    });

    const tableIds = areas.flatMap((a) => a.tables.map((t) => t.id));
    const openSums = await this.prisma.order.groupBy({
      by: ['tableId'],
      where: {
        storeId,
        tableId: { in: tableIds.length ? tableIds : ['__none__'] },
        status: {
          notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIAL_REFUND'],
        },
      },
      _sum: { totalAmount: true },
    });
    const sumMap = new Map(openSums.map((r) => [r.tableId, money(r._sum.totalAmount)]));
    const orderCounts = await this.prisma.order.groupBy({
      by: ['tableId'],
      where: {
        storeId,
        tableId: { in: tableIds.length ? tableIds : ['__none__'] },
        status: {
          notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIAL_REFUND'],
        },
      },
      _count: { _all: true },
    });
    const countMap = new Map(orderCounts.map((r) => [r.tableId, r._count._all]));

    // Phien dang mo giu ban + hoa don (neu da lap): de POS hien tong theo phien/hoa don
    const seats = await this.prisma.tableSessionTable.findMany({
      where: {
        tableId: { in: tableIds.length ? tableIds : ['00000000-0000-0000-0000-000000000000'] },
        leftAt: null,
        session: { storeId, status: 'OPEN' },
      },
      select: {
        tableId: true,
        role: true,
        session: {
          select: {
            id: true,
            primaryTableId: true,
            bill: { select: { id: true, status: true, totalAmount: true, paidAmount: true } },
          },
        },
      },
    });
    const seatMap = new Map(seats.map((x) => [x.tableId, x]));

    return {
      store: store
        ? { id: store.id, name: store.name, slug: store.slug, logoUrl: store.logoUrl }
        : null,
      areas: areas.map((a) => ({
        id: a.id,
        name: a.name,
        sortOrder: a.sortOrder,
        tables: a.tables.map((t) => {
          const seat = seatMap.get(t.id);
          const bill = seat?.session.bill ?? null;
          return {
            ...t,
            openOrders: countMap.get(t.id) ?? 0,
            openAmount: sumMap.get(t.id) ?? 0,
            // Phien ban + hoa don (null neu ban khong co phien mo / chua lap hoa don)
            sessionId: seat?.session.id ?? null,
            billId: bill?.id ?? null,
            billStatus: bill?.status ?? null,
            billTotal: bill ? money(bill.totalAmount) : null,
            billRemaining: bill ? money(bill.totalAmount) - money(bill.paidAmount) : null,
          };
        }),
      })),
    };
  }

  async getOne(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const table = await this.prisma.table.findFirst({
      where: { id, storeId },
      include: { area: { select: { id: true, name: true } } },
    });
    if (!table) throw new NotFoundException('Bàn không tồn tại');
    return table;
  }

  async createArea(user: JwtUser, storeId: string, dto: CreateAreaDto) {
    assertStoreAccess(user, storeId);
    const created = await this.prisma.area.create({
      data: { storeId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.audit.log({
      action: 'create_area',
      entityType: 'Area',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { name: created.name },
    });
    return created;
  }

  async updateArea(user: JwtUser, storeId: string, id: string, dto: UpdateAreaDto) {
    assertStoreAccess(user, storeId);
    const area = await this.prisma.area.findFirst({ where: { id, storeId } });
    if (!area) throw new NotFoundException('Khu vực không tồn tại');
    const updated = await this.prisma.area.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return updated;
  }

  async createTable(user: JwtUser, storeId: string, dto: CreateTableDto) {
    assertStoreAccess(user, storeId);
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Quán không tồn tại');
    const area = await this.prisma.area.findFirst({
      where: { id: dto.areaId, storeId },
    });
    if (!area) throw new BadRequestException('Khu vực không tồn tại');

    const code = dto.code.toUpperCase();
    const dup = await this.prisma.table.findUnique({
      where: { storeId_code: { storeId, code } },
    });
    if (dup) throw new ConflictException('Mã bàn đã tồn tại');

    const qrBase = this.config.get<string>('qrBaseUrl') ?? 'http://localhost:3000';
    const created = await this.prisma.table.create({
      data: {
        storeId,
        areaId: dto.areaId,
        code,
        name: dto.name,
        seats: dto.seats,
        notes: dto.notes,
        qrCode: `${qrBase}/s/${store.slug}/t/${code}`,
      },
    });

    await this.audit.log({
      action: 'create_table',
      entityType: 'Table',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { code: created.code, areaId: created.areaId, qrCode: created.qrCode },
    });
    return created;
  }

  async updateTable(user: JwtUser, storeId: string, id: string, dto: UpdateTableDto) {
    assertStoreAccess(user, storeId);
    const table = await this.prisma.table.findFirst({ where: { id, storeId } });
    if (!table) throw new NotFoundException('Bàn không tồn tại');
    if (dto.areaId) {
      const area = await this.prisma.area.findFirst({
        where: { id: dto.areaId, storeId },
      });
      if (!area) throw new BadRequestException('Khu vực không tồn tại');
    }
    const updated = await this.prisma.table.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.seats !== undefined ? { seats: dto.seats } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.areaId !== undefined ? { areaId: dto.areaId } : {}),
      },
    });
    await this.audit.log({
      action: 'update_table',
      entityType: 'Table',
      entityId: id,
      storeId,
      userId: user.id,
      afterData: { name: updated.name, seats: updated.seats },
    });
    return updated;
  }

  async deleteTable(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const table = await this.prisma.table.findFirst({
      where: { id, storeId },
      include: { _count: { select: { orders: true } } },
    });
    if (!table) throw new NotFoundException('Bàn không tồn tại');
    if (table._count.orders > 0) {
      throw new ConflictException('Bàn đã có đơn hàng, không thể xóa');
    }
    await this.prisma.table.delete({ where: { id } });
    await this.audit.log({
      action: 'delete_table',
      entityType: 'Table',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { code: table.code },
    });
    return { ok: true };
  }

  /**
   * Chuyen trang thai ban: da don (NEED_CLEAN -> AVAILABLE), khoa/mo ban...
   * Luu y: ban co don dang mo khong the chuyen ve AVAILABLE (tru khi thanh toan xong).
   */
  async changeStatus(user: JwtUser, storeId: string, id: string, dto: TableStatusDto) {
    assertStoreAccess(user, storeId);
    const table = await this.prisma.table.findFirst({
      where: { id, storeId },
      include: {
        _count: {
          select: {
            orders: {
              where: {
                status: {
                  notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIAL_REFUND'],
                },
              },
            },
          },
        },
      },
    });
    if (!table) throw new NotFoundException('Bàn không tồn tại');

    const allowed = TABLE_TRANSITIONS[table.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Khong the chuyen tu ${table.status} sang ${dto.status}`,
      );
    }
    if (
      (dto.status === TableStatus.AVAILABLE || dto.status === TableStatus.LOCKED) &&
      table._count.orders > 0
    ) {
      throw new ConflictException('Bàn còn đơn đang mở, vui lòng thanh toán trước');
    }

    const before = table.status;
    const updated = await this.prisma.table.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.log({
      action: 'table_status',
      entityType: 'Table',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { status: before },
      afterData: { status: dto.status, reason: dto.reason },
    });
    return updated;
  }
}
