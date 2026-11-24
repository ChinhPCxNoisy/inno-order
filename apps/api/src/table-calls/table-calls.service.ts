import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../realtime/events.service';
import { assertStoreAccess } from '../common/utils/assert-store';
import { CreateTableCallDto } from './dto/create-table-call.dto';
import { JwtUser } from '../common/types/jwt-user.interface';

/** Yeu cau goi ban PENDING qua 2 gio coi nhu het han */
const CALL_EXPIRE_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class TableCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Khach bam "Goi nhan vien" tai ban (cong khai, khong can dang nhap) */
  async createPublic(storeId: string, tableCode: string, dto: CreateTableCallDto = {}) {
    const table = await this.prisma.table.findFirst({
      where: { storeId, code: tableCode.toUpperCase() },
    });
    if (!table) throw new NotFoundException('Bàn không tồn tại, vui lòng quét lại mã QR');

    const now = Date.now();
    const pending = await this.prisma.tableCallRequest.findMany({
      where: { storeId, tableId: table.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    // Yeu cau PENDING qua 2 gio coi nhu het han: tu danh dau EXPIRED de khong chan yeu cau moi
    const stale = pending.filter((c) => now - c.createdAt.getTime() > CALL_EXPIRE_MS);
    if (stale.length > 0) {
      await this.prisma.tableCallRequest.updateMany({
        where: { id: { in: stale.map((c) => c.id) }, status: 'PENDING' },
        data: { status: 'EXPIRED', resolvedAt: new Date() },
      });
      for (const c of stale) {
        this.events.tableCallResolved({
          storeId,
          tableCode: table.code,
          tableName: table.name,
          callId: c.id,
        });
      }
    }

    // Chong spam: ban dang co yeu cau con han thi KHONG tao them, nhung cap nhat
    // ly do/ghi chu moi (neu khac) de nhan vien thay dung nhu cau cua khach
    const existing = pending.find((c) => now - c.createdAt.getTime() <= CALL_EXPIRE_MS);
    if (existing) {
      const newNote = dto.note?.trim() || null;
      const reasonChanged = dto.reason !== undefined && dto.reason !== existing.reason;
      const noteChanged = newNote !== null && newNote !== existing.note;
      if (reasonChanged || noteChanged) {
        const updated = await this.prisma.tableCallRequest.update({
          where: { id: existing.id },
          data: {
            ...(reasonChanged ? { reason: dto.reason } : {}),
            ...(noteChanged ? { note: newNote } : {}),
          },
        });
        // Phat lai realtime de man hinh nhan vien cap nhat ly do moi
        this.events.tableCallCreated({
          storeId,
          tableCode: table.code,
          tableName: table.name,
          callId: updated.id,
          createdAt: updated.createdAt.toISOString(),
        });
        return { id: updated.id, status: updated.status };
      }
      return { id: existing.id, status: existing.status };
    }

    const call = await this.prisma.tableCallRequest.create({
      data: { storeId, tableId: table.id, reason: dto.reason ?? null, note: dto.note?.trim() || null },
    });

    this.events.tableCallCreated({
      storeId,
      tableCode: table.code,
      tableName: table.name,
      callId: call.id,
      createdAt: call.createdAt.toISOString(),
    });

    return { id: call.id, status: call.status };
  }

  /** Nhan vien xem danh sach ban dang cho ho tro (BRD FR-NTF) */
  async listPending(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const calls = await this.prisma.tableCallRequest.findMany({
      where: { storeId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - CALL_EXPIRE_MS) } },
      orderBy: { createdAt: 'asc' },
      include: { table: { select: { code: true, name: true } } },
    });
    return calls.map((c) => ({
      id: c.id,
      tableCode: c.table.code,
      tableName: c.table.name,
      createdAt: c.createdAt,
      reason: c.reason,
      note: c.note,
    }));
  }

  /** Nhan vien xac nhan da den ho tro ban */
  async resolve(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const call = await this.prisma.tableCallRequest.findFirst({
      where: { id, storeId },
      include: { table: { select: { code: true, name: true } } },
    });
    if (!call) throw new NotFoundException('Yêu cầu không tồn tại');
    if (call.status === 'RESOLVED') throw new BadRequestException('Yêu cầu đã được xử lý');

    await this.prisma.tableCallRequest.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: user.id },
    });

    this.events.tableCallResolved({
      storeId,
      tableCode: call.table.code,
      tableName: call.table.name,
      callId: call.id,
    });

    return { ok: true };
  }
}
