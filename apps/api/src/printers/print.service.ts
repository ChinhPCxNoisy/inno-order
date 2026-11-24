import { Injectable, Logger } from '@nestjs/common';
import {
  OrderItemStatus,
  OrderStatus,
  Prisma,
  Printer,
  PrinterStation,
  PrintJobType,
  TicketStation,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../realtime/events.service';
import { money } from '../common/utils/money';
import {
  billPayload,
  BillOrderInput,
  cancelTicketPayload,
  kitchenTicketPayload,
  Station,
  STATION_LABEL,
  tableMoveDocument,
} from './print-documents';

/** Job qua cu (khong in tu dong): khop maxJobAgeMinutes cua agent */
export const MAX_JOB_AGE_MS = 15 * 60_000;

const STATION_TO_PRINTER: Record<Station, PrinterStation> = {
  KITCHEN: PrinterStation.KITCHEN,
  BAR: PrinterStation.BAR,
};

type JobInput = {
  storeId: string;
  printer: Printer | null;
  jobType: PrintJobType;
  payload: unknown;
  content: string;
  orderId?: string | null;
  billId?: string | null;
  dedupeKey?: string | null;
  copies?: number;
  openDrawer?: boolean;
  /** Ly do that bai ngay khi tao (chua cau hinh may in...) */
  failReason?: string;
  stationLabel?: string;
};

/**
 * Dung tai lieu in va dua vao hang doi that (PrintJob PENDING -> Print Agent lay ve in).
 * Khong bao gio nem loi len nghiep vu goi no: loi duoc ghi nhan thanh job FAILED + phat canh bao realtime.
 */
@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ================= CHE DO IN =================

  /**
   * AGENT: tao job that. KDS_ONLY: khong tao job, khong bao loi in.
   * Mac dinh (settings.printing.mode chua dat): co Print Agent hoat dong thi AGENT, chua co thi KDS_ONLY
   * (quan chua cai agent khong bi job "that bai gia" nhu truoc).
   */
  async mode(storeId: string): Promise<'AGENT' | 'KDS_ONLY'> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    const pr = ((store?.settings ?? {}) as Record<string, any>).printing ?? {};
    if (pr.mode === 'KDS_ONLY') return 'KDS_ONLY';
    if (pr.mode === 'AGENT') return 'AGENT';
    const n = await this.prisma.printAgent.count({ where: { storeId, revokedAt: null } });
    return n > 0 ? 'AGENT' : 'KDS_ONLY';
  }

  async printingSettings(storeId: string): Promise<{ autoPrintBill: boolean; footerText?: string }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    const pr = ((store?.settings ?? {}) as Record<string, any>).printing ?? {};
    return {
      autoPrintBill: pr.autoPrintBill !== false,
      footerText: typeof pr.footerText === 'string' ? pr.footerText : 'Cảm ơn quý khách!',
    };
  }

  // ================= PHIEU BEP / BAR =================

  /** Phieu bep/bar khi co don moi hoac dot goi them: moi khu mot job toi dung may in */
  async enqueueKitchen(
    storeId: string,
    orderId: string,
    opts: { reprintCount?: number; only?: Station } = {},
  ): Promise<void> {
    try {
      if ((await this.mode(storeId)) === 'KDS_ONLY') return;
      const order = await this.loadOrderForTicket(storeId, orderId);
      if (!order) return;
      const round = await this.roundOf(order);
      const groups = this.groupByStation(order.items.filter((i) => i.status !== OrderItemStatus.CANCELLED));
      for (const [station, items] of groups) {
        if (opts.only && opts.only !== station) continue;
        const printer = await this.pickPrinter(storeId, STATION_TO_PRINTER[station]);
        const payload = kitchenTicketPayload({
          station,
          storeName: order.store.name,
          tableCode: order.table.code,
          areaName: order.table.area.name,
          orderNumber: order.orderNumber,
          round,
          createdAt: order.createdAt,
          source: order.source,
          items,
          orderNote: order.customerNote,
          reprintCount: opts.reprintCount,
        });
        await this.createJob({
          storeId,
          printer,
          jobType: opts.reprintCount ? PrintJobType.REPRINT : PrintJobType.KITCHEN_TICKET,
          payload,
          content: `Phiếu ${STATION_LABEL[station]} - Bàn ${order.table.code} - Đơn #${order.orderNumber}${round > 1 ? ` (đợt ${round})` : ''}`,
          orderId,
          dedupeKey: opts.reprintCount ? null : `ticket:${orderId}:${station}`,
          failReason: printer ? undefined : `Chưa cấu hình máy in cho khu ${STATION_LABEL[station]}`,
        });
      }
    } catch (e) {
      this.internalFailure('enqueueKitchen', storeId, e);
    }
  }

  /** Phieu huy mon toi dung khu cua mon. itemIds trong -> moi mon cua don */
  async enqueueCancel(
    storeId: string,
    orderId: string,
    itemIds: string[] | null,
    reason: string,
    staffName: string,
  ): Promise<void> {
    try {
      if ((await this.mode(storeId)) === 'KDS_ONLY') return;
      const order = await this.loadOrderForTicket(storeId, orderId);
      if (!order) return;
      const items = order.items.filter((i) => (itemIds ? itemIds.includes(i.id) : true));
      const groups = this.groupByStation(items);
      for (const [station, its] of groups) {
        const printer = await this.pickPrinter(storeId, STATION_TO_PRINTER[station]);
        const key = `cancel:${orderId}:${station}:${its.map((i) => i.id).sort().join(',')}`.slice(0, 250);
        await this.createJob({
          storeId,
          printer,
          jobType: PrintJobType.CANCEL,
          payload: cancelTicketPayload({
            station,
            tableCode: order.table.code,
            orderNumber: order.orderNumber,
            items: its,
            reason,
            staffName,
          }),
          content: `HỦY MÓN - Bàn ${order.table.code} - Đơn #${order.orderNumber}`,
          orderId,
          dedupeKey: key,
          failReason: printer ? undefined : `Chưa cấu hình máy in cho khu ${STATION_LABEL[station]}`,
        });
      }
    } catch (e) {
      this.internalFailure('enqueueCancel', storeId, e);
    }
  }

  // ================= BILL / TAM TINH =================

  /**
   * Bill gop (hoac tam tinh) tu hoa don ban. `paymentId` de chong in trung moi lan thanh toan;
   * mo ket neu thanh toan co tien mat va may in co ket.
   */
  async enqueueBill(
    storeId: string,
    billId: string,
    opts: { pre?: boolean; reprintCount?: number; cashier?: string; paymentId?: string } = {},
  ): Promise<{ queued: boolean; reason?: string }> {
    try {
      if ((await this.mode(storeId)) === 'KDS_ONLY') return { queued: false, reason: 'KDS_ONLY' };
      const bill = await this.prisma.bill.findFirst({
        where: { id: billId, storeId },
        include: {
          store: { select: { name: true, address: true, phone: true, settings: true } },
          discounts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          payments: { where: { status: 'COMPLETED' }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] },
          session: {
            include: {
              primaryTable: { select: { code: true } },
              orders: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                include: {
                  table: { select: { code: true } },
                  items: { include: { options: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
                },
              },
            },
          },
        },
      });
      if (!bill) return { queued: false, reason: 'Hóa đơn không tồn tại' };
      const pre = opts.pre === true;
      const live = bill.session.orders.filter((o) =>
        pre
          ? ([OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] as OrderStatus[]).includes(o.status)
          : o.status !== OrderStatus.CANCELLED,
      );
      const rounds = new Map(bill.session.orders.map((o, i) => [o.id, i + 1]));
      const orders: BillOrderInput[] = live.map((o) => ({
        orderNumber: o.orderNumber,
        round: rounds.get(o.id) ?? 1,
        createdAt: o.createdAt,
        items: o.items.filter((i) => i.status !== OrderItemStatus.CANCELLED),
      }));
      const settings = (bill.store.settings ?? {}) as Record<string, any>;
      const ps = await this.printingSettings(storeId);
      const printer = await this.pickPrinter(storeId, PrinterStation.CASHIER);
      // Bill in tu dong luc thanh toan khong co user trong opts: lay thu ngan cua lan thu gan nhat (giong ban in lai)
      let cashier = opts.cashier;
      if (!cashier) {
        const lastCashierId = [...bill.payments].reverse().find((p) => p.cashierId)?.cashierId;
        if (lastCashierId) {
          cashier = (await this.prisma.user.findUnique({ where: { id: lastCashierId }, select: { name: true } }))?.name;
        }
      }
      const tableCodes = Array.from(new Set(live.map((o) => o.table.code)));
      const payload = billPayload({
        preBill: pre,
        store: bill.store,
        billNo: bill.billNo,
        tableCode: bill.session.primaryTable.code,
        mergedTables: tableCodes,
        openedAt: bill.session.openedAt,
        closedAt: bill.paidAt,
        cashier,
        orders,
        subtotal: money(bill.subtotal),
        discounts: bill.discounts.map((d) => ({ label: d.reason ? `Giảm giá (${d.reason})` : 'Giảm giá', amount: money(d.amount) })),
        vatPercent: settings.vatEnabled === true ? (typeof settings.vatRate === 'number' ? settings.vatRate : 10) : undefined,
        vatAmount: money(bill.vatAmount),
        total: money(bill.totalAmount),
        payments: bill.payments.map((p) => ({
          method: p.method,
          amount: money(p.amount),
          tendered: p.cashReceived === null ? null : money(p.cashReceived),
        })),
        footerText: ps.footerText,
        reprintCount: opts.reprintCount,
      });
      const hasCash = bill.payments.some((p) => p.method === 'CASH');
      const job = await this.createJob({
        storeId,
        printer,
        jobType: opts.reprintCount ? PrintJobType.REPRINT : pre ? PrintJobType.PRE_BILL : PrintJobType.BILL,
        payload,
        content: `${pre ? 'TẠM TÍNH' : 'BILL'} ${bill.billNo} - Bàn ${bill.session.primaryTable.code}`,
        orderId: live[0]?.id ?? null,
        billId,
        dedupeKey: !pre && !opts.reprintCount && opts.paymentId ? `bill:${billId}:${opts.paymentId}` : null,
        openDrawer: !pre && hasCash && (printer?.openDrawer ?? false),
        failReason: printer ? undefined : 'Chưa cấu hình máy in quầy (thu ngân)',
      });
      return { queued: job.status !== 'FAILED', reason: job.failedReason ?? undefined };
    } catch (e) {
      this.internalFailure('enqueueBill', storeId, e);
      return { queued: false, reason: 'Lỗi hệ thống in' };
    }
  }

  /** Bill cua don cu khong thuoc phien (thanh toan duong cu) */
  async enqueueOrderBill(
    storeId: string,
    orderId: string,
    opts: { paymentId?: string; reprintCount?: number } = {},
  ): Promise<{ queued: boolean; reason?: string }> {
    try {
      if ((await this.mode(storeId)) === 'KDS_ONLY') return { queued: false, reason: 'KDS_ONLY' };
      const order = await this.prisma.order.findFirst({
        where: { id: orderId, storeId },
        include: {
          store: { select: { name: true, address: true, phone: true, settings: true } },
          table: { select: { code: true } },
          items: { include: { options: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          payments: { where: { status: 'COMPLETED' }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!order) return { queued: false, reason: 'Đơn không tồn tại' };
      const settings = (order.store.settings ?? {}) as Record<string, any>;
      const ps = await this.printingSettings(storeId);
      const printer = await this.pickPrinter(storeId, PrinterStation.CASHIER);
      const disc = money(order.discountAmount);
      const payload = billPayload({
        preBill: false,
        store: order.store,
        billNo: order.payments[0]?.receiptNo ?? undefined,
        tableCode: order.table.code,
        openedAt: order.createdAt,
        closedAt: order.paidAt,
        orders: [
          {
            orderNumber: order.orderNumber,
            round: 1,
            createdAt: order.createdAt,
            items: order.items.filter((i) => i.status !== OrderItemStatus.CANCELLED),
          },
        ],
        subtotal: money(order.subtotal),
        discounts: disc > 0 ? [{ label: 'Giảm giá', amount: disc }] : [],
        vatPercent: settings.vatEnabled === true ? (typeof settings.vatRate === 'number' ? settings.vatRate : 10) : undefined,
        vatAmount: money(order.vatAmount),
        total: money(order.totalAmount),
        payments: order.payments.map((p) => ({ method: p.method, amount: money(p.amount) })),
        footerText: ps.footerText,
        reprintCount: opts.reprintCount,
      });
      const job = await this.createJob({
        storeId,
        printer,
        jobType: opts.reprintCount ? PrintJobType.REPRINT : PrintJobType.BILL,
        payload,
        content: `BILL đơn #${order.orderNumber} - Bàn ${order.table.code}`,
        orderId,
        dedupeKey: !opts.reprintCount && opts.paymentId ? `bill:order:${orderId}:${opts.paymentId}` : null,
        openDrawer: order.payments.some((p) => p.method === 'CASH') && (printer?.openDrawer ?? false),
        failReason: printer ? undefined : 'Chưa cấu hình máy in quầy (thu ngân)',
      });
      return { queued: job.status !== 'FAILED', reason: job.failedReason ?? undefined };
    } catch (e) {
      this.internalFailure('enqueueOrderBill', storeId, e);
      return { queued: false, reason: 'Lỗi hệ thống in' };
    }
  }

  // ================= TEST / KET TIEN / DOI BAN =================

  async enqueueTest(storeId: string, printerId: string) {
    const printer = await this.prisma.printer.findFirst({ where: { id: printerId, storeId } });
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
    return this.createJob({
      storeId,
      printer,
      jobType: PrintJobType.TEST,
      payload: { kind: 'test', data: { printerName: printer?.name, storeName: store?.name } },
      content: `In thử - ${printer?.name ?? ''}`,
      failReason: printer ? undefined : 'Máy in không tồn tại',
    });
  }

  async enqueueDrawer(storeId: string, printerId: string) {
    const printer = await this.prisma.printer.findFirst({ where: { id: printerId, storeId } });
    return this.createJob({
      storeId,
      printer,
      jobType: PrintJobType.DRAWER,
      payload: { kind: 'drawer' },
      content: `Mở két - ${printer?.name ?? ''}`,
      openDrawer: true,
      failReason: printer ? undefined : 'Máy in không tồn tại',
    });
  }

  /** Phieu doi ban toi cac khu con mon chua ra (khong chan doi ban neu in loi) */
  async enqueueTableMove(
    storeId: string,
    sessionId: string,
    from: string,
    to: string,
    batch: string,
  ): Promise<void> {
    try {
      if ((await this.mode(storeId)) === 'KDS_ONLY') return;
      const orders = await this.prisma.order.findMany({
        where: {
          sessionId,
          storeId,
          status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] },
        },
        include: {
          items: {
            where: { status: { in: [OrderItemStatus.PENDING, OrderItemStatus.ACCEPTED, OrderItemStatus.PREPARING, OrderItemStatus.READY] } },
            include: { options: true, menuItem: { include: { category: { select: { station: true } } } } },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const perStation = new Map<Station, { orderNumber: string; items: { name: string; quantity: number }[] }[]>();
      for (const o of orders) {
        for (const [station, items] of this.groupByStation(o.items)) {
          const arr = perStation.get(station) ?? [];
          arr.push({ orderNumber: o.orderNumber, items: items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })) });
          perStation.set(station, arr);
        }
      }
      for (const [station, list] of perStation) {
        const printer = await this.pickPrinter(storeId, STATION_TO_PRINTER[station]);
        await this.createJob({
          storeId,
          printer,
          jobType: PrintJobType.TABLE_MOVE,
          payload: tableMoveDocument({ stationLabel: STATION_LABEL[station], from, to, orders: list, at: new Date() }),
          content: `ĐỔI BÀN ${from} → ${to} (${STATION_LABEL[station]})`,
          dedupeKey: `move:${batch}:${station}`,
          failReason: printer ? undefined : `Chưa cấu hình máy in cho khu ${STATION_LABEL[station]}`,
        });
      }
    } catch (e) {
      this.internalFailure('enqueueTableMove', storeId, e);
    }
  }

  // ================= TRUY VAN (admin) =================

  async listJobs(storeId: string, q: { status?: string; printerId?: string; orderId?: string; take?: number } = {}) {
    const where: Prisma.PrintJobWhereInput = { storeId };
    if (q.status) where.status = q.status as never;
    if (q.printerId) where.printerId = q.printerId;
    if (q.orderId) where.orderId = q.orderId;
    return this.prisma.printJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(q.take ?? 100, 300),
      select: {
        id: true,
        jobType: true,
        status: true,
        content: true,
        attemptCount: true,
        maxAttempts: true,
        createdAt: true,
        sentAt: true,
        printedAt: true,
        failedReason: true,
        lastError: true,
        errorCode: true,
        nextAttemptAt: true,
        acknowledgedAt: true,
        copies: true,
        billId: true,
        printerId: true,
        printer: { select: { id: true, name: true, station: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    });
  }

  // ================= NOI BO =================

  /** Tao job (idempotent theo dedupeKey). That bai ngay khi tao -> FAILED + canh bao realtime. */
  async createJob(i: JobInput) {
    let failReason = i.failReason;
    const printer = i.printer;
    if (!failReason && printer) {
      if (!printer.enabled) failReason = `Máy in ${printer.name} đang tắt`;
      else if (!printer.agentId) failReason = `Chưa gán Print Agent cho máy in ${printer.name}`;
    }
    const failed = !!failReason || !printer;
    try {
      const job = await this.prisma.printJob.create({
        data: {
          storeId: i.storeId,
          printerId: printer?.id,
          orderId: i.orderId ?? undefined,
          billId: i.billId ?? undefined,
          jobType: i.jobType,
          status: failed ? 'FAILED' : 'PENDING',
          content: i.content,
          payload: i.payload as Prisma.InputJsonValue,
          dedupeKey: i.dedupeKey ?? undefined,
          agentId: printer?.agentId ?? undefined,
          copies: i.copies ?? 1,
          openDrawer: i.openDrawer ?? false,
          attemptCount: 0,
          failedReason: failed ? (failReason ?? 'Chưa cấu hình máy in') : null,
          lastError: failed ? (failReason ?? 'Chưa cấu hình máy in') : null,
          errorCode: failed ? 'NOT_CONFIGURED' : null,
        },
      });
      if (failed) await this.notifyFailed(job.id);
      return job;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && i.dedupeKey) {
        // Da co job cung khoa (gui lai/dong thoi): khong tao them, khong in doi
        const dup = await this.prisma.printJob.findUnique({
          where: { storeId_dedupeKey: { storeId: i.storeId, dedupeKey: i.dedupeKey } },
        });
        if (dup) return dup;
      }
      throw e;
    }
  }

  /** Phat canh bao job that bai cho man hinh admin (khong nuot loi im lang) */
  async notifyFailed(jobId: string): Promise<void> {
    try {
      const j = await this.prisma.printJob.findUnique({
        where: { id: jobId },
        include: {
          printer: { select: { name: true, station: true } },
          order: { select: { id: true, orderNumber: true, table: { select: { code: true } } } },
        },
      });
      if (!j) return;
      this.logger.warn(`Print job ${j.id} (${j.jobType}) failed: ${j.failedReason}`);
      this.events.generic(
        'print.failed',
        j.storeId,
        {
          jobId: j.id,
          jobType: j.jobType,
          station: j.printer?.station ?? null,
          printerName: j.printer?.name ?? null,
          reason: j.failedReason,
          errorCode: j.errorCode,
        },
        { orderId: j.order?.id, orderNumber: j.order?.orderNumber, tableCode: j.order?.table.code },
      );
    } catch (e) {
      this.logger.error(`notifyFailed ${jobId}: ${(e as Error).message}`);
    }
  }

  private internalFailure(where: string, storeId: string, e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    this.logger.error(`${where} (${storeId}): ${msg}`, (e as Error)?.stack);
    this.events.generic('print.failed', storeId, {
      jobId: null,
      jobType: null,
      printerName: null,
      reason: `Lỗi hệ thống khi tạo phiếu in (${where})`,
      errorCode: 'INTERNAL',
    });
  }

  /** May in cua khu: enabled, uu tien co agent, ONLINE truoc OFFLINE truoc ERROR, roi priority */
  async pickPrinter(storeId: string, station: PrinterStation): Promise<Printer | null> {
    const list = await this.prisma.printer.findMany({ where: { storeId, station, enabled: true } });
    if (list.length === 0) return null;
    const rank = (p: Printer) => (p.agentId ? 0 : 10) + (p.status === 'ONLINE' ? 0 : p.status === 'OFFLINE' ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
    return list[0];
  }

  private async loadOrderForTicket(storeId: string, orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        store: { select: { name: true } },
        table: { select: { code: true, area: { select: { name: true } } } },
        items: {
          include: {
            options: true,
            menuItem: { select: { printStation: true, category: { select: { station: true } } } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
  }

  private async roundOf(order: { id: string; sessionId: string | null }): Promise<number> {
    if (!order.sessionId) return 1;
    const ids = await this.prisma.order.findMany({
      where: { sessionId: order.sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const idx = ids.findIndex((o) => o.id === order.id);
    return idx >= 0 ? idx + 1 : 1;
  }

  private groupByStation<T extends { menuItem?: { printStation: TicketStation | null; category: { station: TicketStation } } }>(
    items: T[],
  ): Map<Station, T[]> {
    const out = new Map<Station, T[]>();
    for (const it of items) {
      const st = it.menuItem ? (it.menuItem.printStation ?? it.menuItem.category.station) : TicketStation.KITCHEN;
      if (st === TicketStation.NONE) continue;
      const key = st as Station;
      const arr = out.get(key) ?? [];
      arr.push(it);
      out.set(key, arr);
    }
    return out;
  }
}
