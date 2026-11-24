import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillStatus, TableSessionStatus, TableStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EventsService } from '../realtime/events.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money } from '../common/utils/money';
import { OPEN_ORDER } from '../common/utils/order-status';
import { PrintService } from '../printers/print.service';
import { BillsService } from './bills.service';
import { BILL_OPEN, lockTables, recalcBill, releaseRedemptions, Tx } from './bill-core';

const conflict = (message: string, code: string) =>
  new ConflictException({ statusCode: 409, message, error: 'Conflict', code });

/** Doi ban va gop ban tren TableSession (dac ta 02 phan C). Order.tableId luon la ban vat ly. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly print: PrintService,
    private readonly bills: BillsService,
  ) {}

  /** Phuc vu chi doi ban khi quan bat settings.pos.allowWaiterMoveTable */
  private async assertCanMove(tx: Tx | PrismaService, user: JwtUser, storeId: string) {
    if (user.role !== UserRole.WAITER) return;
    const s = await tx.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    const pos = ((s?.settings ?? {}) as Record<string, any>).pos ?? {};
    if (pos.allowWaiterMoveTable !== true) {
      throw new ForbiddenException('Quán chưa cho phép phục vụ đổi bàn');
    }
  }

  // ================= DOI BAN =================

  async moveTable(
    user: JwtUser,
    storeId: string,
    sessionId: string,
    dto: { toTableId: string; fromTableId?: string; reason?: string },
  ) {
    assertStoreAccess(user, storeId);
    await this.assertCanMove(this.prisma, user, storeId);
    const s0 = await this.prisma.tableSession.findFirst({
      where: { id: sessionId, storeId },
      include: { tables: { where: { leftAt: null } } },
    });
    if (!s0) throw new NotFoundException('Phiên bàn không tồn tại');
    const fromId =
      dto.fromTableId ??
      (s0.tables.length === 1 ? s0.tables[0].tableId : undefined);
    if (!fromId) throw new BadRequestException('Phiên đã gộp nhiều bàn, vui lòng chọn bàn cần chuyển (fromTableId)');
    if (fromId === dto.toTableId) throw new BadRequestException('Bàn đích trùng bàn hiện tại');

    const r = await this.prisma.$transaction(
      async (tx) => {
        await lockTables(tx, [fromId, dto.toTableId]);
        const session = await tx.tableSession.findFirst({
          where: { id: sessionId, storeId },
          include: { tables: { where: { leftAt: null } } },
        });
        const seat = session?.tables.find((t) => t.tableId === fromId);
        if (!session || session.status !== TableSessionStatus.OPEN || !seat) {
          throw conflict('Phiên bàn đã thay đổi, vui lòng tải lại', 'SESSION_CHANGED');
        }
        const to = await tx.table.findFirst({ where: { id: dto.toTableId, storeId } });
        const from = await tx.table.findFirst({ where: { id: fromId, storeId } });
        if (!to || !from) throw new NotFoundException('Bàn không tồn tại');
        const busySeat = await tx.tableSessionTable.count({
          where: { tableId: to.id, leftAt: null, session: { status: TableSessionStatus.OPEN } },
        });
        const busyOrders = await tx.order.count({
          where: { storeId, tableId: to.id, status: { in: OPEN_ORDER } },
        });
        if (
          busySeat > 0 ||
          busyOrders > 0 ||
          !(to.status === TableStatus.AVAILABLE || to.status === TableStatus.CLEANED)
        ) {
          throw conflict(`Bàn ${to.code} đang có khách hoặc không sẵn sàng`, 'TARGET_TABLE_BUSY');
        }

        const now = new Date();
        await tx.tableSessionTable.update({
          where: { id: seat.id },
          data: { leftAt: now, role: 'MOVED_FROM' },
        });
        await tx.tableSessionTable.create({
          data: { sessionId, tableId: to.id, role: seat.role === 'MOVED_FROM' ? 'PRIMARY' : seat.role, joinedAt: now },
        });
        if (session.primaryTableId === fromId) {
          await tx.tableSession.update({ where: { id: sessionId }, data: { primaryTableId: to.id } });
        }
        const moved = await tx.order.findMany({
          where: { sessionId, tableId: fromId, status: { in: OPEN_ORDER } },
          select: { id: true },
        });
        await tx.order.updateMany({
          where: { id: { in: moved.map((o) => o.id) } },
          data: { tableId: to.id },
        });
        // Ban cu can don (de xuat Q5), ban moi co khach. Chi ha ban cu neu khong con phien/don khac giu
        await tx.table.update({ where: { id: to.id }, data: { status: TableStatus.OCCUPIED } });
        const fromBusy = await tx.order.count({
          where: { storeId, tableId: fromId, status: { in: OPEN_ORDER } },
        });
        if (fromBusy === 0) {
          await tx.table.update({ where: { id: fromId }, data: { status: TableStatus.NEED_CLEAN } });
        }
        // Yeu cau goi ban dang cho: chuyen sang ban moi
        await tx.tableCallRequest.updateMany({
          where: { storeId, tableId: fromId, status: 'PENDING' },
          data: { tableId: to.id },
        });
        return { from, to, orderIds: moved.map((o) => o.id) };
      },
      { timeout: 15000 },
    );

    await this.audit.log({
      action: 'doi_ban',
      entityType: 'TableSession',
      entityId: sessionId,
      storeId,
      userId: user.id,
      beforeData: { tableId: r.from.id, tableCode: r.from.code },
      afterData: {
        tableId: r.to.id,
        tableCode: r.to.code,
        reason: dto.reason ?? null,
        orderIds: r.orderIds,
      },
    });
    await this.afterChange(storeId, r.orderIds, 'moved', {
      sessionId,
      from: r.from.code,
      to: r.to.code,
    });
    await this.print.enqueueTableMove(storeId, sessionId, r.from.code, r.to.code, randomUUID());
    const view = await this.bills.sessionViewPublic(storeId, sessionId);
    return {
      session: view.session,
      fromTable: { id: r.from.id, code: r.from.code },
      toTable: { id: r.to.id, code: r.to.code },
      view,
    };
  }

  // ================= GOP BAN =================

  /** Gop phien NGUON vao phien DICH (id o URL). Bill nguon bi huy (neu chua thu tien), don chuyen sang bill dich. */
  async merge(
    user: JwtUser,
    storeId: string,
    targetSessionId: string,
    dto: { sourceSessionId: string; reason?: string },
  ) {
    assertStoreAccess(user, storeId);
    if (dto.sourceSessionId === targetSessionId) {
      throw new BadRequestException('Không thể gộp một phiên vào chính nó');
    }
    const both = await this.prisma.tableSession.findMany({
      where: { id: { in: [targetSessionId, dto.sourceSessionId] }, storeId },
      include: { tables: { where: { leftAt: null } } },
    });
    if (both.length !== 2) throw new NotFoundException('Phiên bàn không tồn tại');
    const allTables = both.flatMap((s) => s.tables.map((t) => t.tableId));

    const r = await this.prisma.$transaction(
      async (tx) => {
        await lockTables(tx, allTables);
        const target = await tx.tableSession.findFirst({
          where: { id: targetSessionId, storeId },
          include: { bill: true },
        });
        const source = await tx.tableSession.findFirst({
          where: { id: dto.sourceSessionId, storeId },
          include: { bill: true },
        });
        if (
          !target ||
          !source ||
          target.status !== TableSessionStatus.OPEN ||
          source.status !== TableSessionStatus.OPEN
        ) {
          throw conflict('Phiên bàn đã thay đổi, vui lòng tải lại', 'SESSION_CHANGED');
        }
        for (const [label, b] of [
          ['Bàn nguồn', source.bill],
          ['Bàn đích', target.bill],
        ] as const) {
          if (b && money(b.paidAmount) > 0) {
            throw conflict(`${label} đã thanh toán một phần, không thể gộp`, 'HAS_PAYMENT');
          }
        }
        if (source.bill && BILL_OPEN.includes(source.bill.status)) {
          await tx.bill.update({ where: { id: source.bill.id }, data: { status: BillStatus.VOID } });
          await releaseRedemptions(tx, source.bill.id);
          await tx.paymentIntent.updateMany({ where: { billId: source.bill.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        }
        const now = new Date();
        const moved = await tx.order.findMany({
          where: { sessionId: source.id, status: { in: OPEN_ORDER } },
          select: { id: true },
        });
        await tx.order.updateMany({
          where: { sessionId: source.id },
          data: { sessionId: target.id, billId: target.bill?.id ?? null },
        });
        await tx.tableSessionTable.updateMany({
          where: { sessionId: source.id, leftAt: null },
          data: { sessionId: target.id, role: 'MERGED' },
        });
        await tx.tableSession.update({
          where: { id: source.id },
          data: { status: TableSessionStatus.CLOSED, closedAt: now, mergedIntoId: target.id },
        });
        if (target.bill && BILL_OPEN.includes(target.bill.status)) await recalcBill(tx, target.bill.id);
        return { orderIds: moved.map((o) => o.id) };
      },
      { timeout: 15000 },
    );

    await this.audit.log({
      action: 'gop_ban',
      entityType: 'TableSession',
      entityId: targetSessionId,
      storeId,
      userId: user.id,
      beforeData: { sourceSessionId: dto.sourceSessionId },
      afterData: { targetSessionId, reason: dto.reason ?? null, orderIds: r.orderIds },
    });
    await this.afterChange(storeId, r.orderIds, 'merged', { sessionId: targetSessionId });
    const view = await this.bills.sessionViewPublic(storeId, targetSessionId);
    return { session: view.session, bill: view.bill, view };
  }

  /** Realtime sau doi/gop ban: moi don phat order.status (KDS/POS lam moi) + su kien table.moved */
  private async afterChange(
    storeId: string,
    orderIds: string[],
    kind: 'moved' | 'merged',
    info: Record<string, unknown>,
  ) {
    try {
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { table: { select: { code: true, name: true } } },
      });
      for (const o of orders) {
        this.events.orderStatus({
          storeId,
          orderId: o.id,
          orderNumber: o.orderNumber,
          tableCode: o.table.code,
          tableName: o.table.name,
          status: o.status,
          totalAmount: money(o.totalAmount),
          source: o.source,
          createdAt: o.createdAt.toISOString(),
        });
      }
      this.events.generic('table.moved', storeId, { kind, ...info }, { tableCode: orders[0]?.table.code });
    } catch {
      // realtime khong anh huong luong chinh
    }
  }
}
