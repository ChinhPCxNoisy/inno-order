import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { CreatePrinterDto, UpdatePrinterDto } from './dto/printer.dto';
import { PrintService } from './print.service';
import { AGENT_OFFLINE_MS } from './print-agent.service';

@Injectable()
export class PrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly print: PrintService,
  ) {}

  list(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    return this.prisma.printer.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { jobs: true } } },
    });
  }

  /** Agent phai thuoc dung quan */
  private async assertAgent(storeId: string, agentId: string) {
    const a = await this.prisma.printAgent.findFirst({ where: { id: agentId, storeId, revokedAt: null } });
    if (!a) throw new BadRequestException('Print Agent không tồn tại hoặc đã bị thu hồi');
  }

  async create(user: JwtUser, storeId: string, dto: CreatePrinterDto) {
    assertStoreAccess(user, storeId);
    let agentId = dto.agentId;
    if (agentId) await this.assertAgent(storeId, agentId);
    else {
      // Quan chi co 1 agent hoat dong: gan san de may in dung duoc ngay
      const agents = await this.prisma.printAgent.findMany({ where: { storeId, revokedAt: null }, select: { id: true } });
      if (agents.length === 1) agentId = agents[0].id;
    }
    const created = await this.prisma.printer.create({
      data: {
        storeId,
        name: dto.name,
        station: dto.station,
        connection: dto.connection,
        host: dto.host,
        port: dto.port ?? 9100,
        deviceName: dto.deviceName,
        paperSize: dto.paperSize ?? 'P80',
        charsPerLine: dto.charsPerLine ?? (dto.paperSize === 'P58' ? 32 : 42),
        cutAtEnd: dto.cutAtEnd ?? true,
        agentId,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
        encoding: dto.encoding ?? 'RASTER',
        codePage: dto.codePage,
        openDrawer: dto.openDrawer ?? false,
      },
    });
    await this.audit.log({
      action: 'create_printer',
      entityType: 'Printer',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { name: created.name, station: created.station },
    });
    return created;
  }

  async update(user: JwtUser, storeId: string, id: string, dto: UpdatePrinterDto) {
    assertStoreAccess(user, storeId);
    const printer = await this.prisma.printer.findFirst({ where: { id, storeId } });
    if (!printer) throw new NotFoundException('Máy in không tồn tại');
    const before = { name: printer.name, station: printer.station, status: printer.status, agentId: printer.agentId };
    const data: Prisma.PrinterUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.station !== undefined) data.station = dto.station;
    if (dto.connection !== undefined) data.connection = dto.connection;
    if (dto.host !== undefined) data.host = dto.host;
    if (dto.port !== undefined) data.port = dto.port;
    if (dto.deviceName !== undefined) data.deviceName = dto.deviceName;
    if (dto.paperSize !== undefined) data.paperSize = dto.paperSize;
    if (dto.charsPerLine !== undefined) data.charsPerLine = dto.charsPerLine;
    if (dto.cutAtEnd !== undefined) data.cutAtEnd = dto.cutAtEnd;
    if (dto.agentId !== undefined) {
      if (dto.agentId) await this.assertAgent(storeId, dto.agentId);
      data.agentId = dto.agentId;
      // Doi agent: trang thai cu khong con dung
      if (dto.agentId !== printer.agentId) {
        data.status = 'OFFLINE';
        data.statusDetail = null;
      }
    }
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.encoding !== undefined) data.encoding = dto.encoding;
    if (dto.codePage !== undefined) data.codePage = dto.codePage;
    if (dto.openDrawer !== undefined) data.openDrawer = dto.openDrawer;

    const updated = await this.prisma.printer.update({ where: { id }, data });
    await this.audit.log({
      action: 'update_printer',
      entityType: 'Printer',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: {
        name: updated.name,
        station: updated.station,
        status: updated.status,
        agentId: updated.agentId,
      } as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async testPrint(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const printer = await this.prisma.printer.findFirst({ where: { id, storeId } });
    if (!printer) throw new NotFoundException('Máy in không tồn tại');
    const job = await this.print.enqueueTest(storeId, id);
    await this.audit.log({
      action: 'test_print',
      entityType: 'Printer',
      entityId: id,
      storeId,
      userId: user.id,
      afterData: { jobId: job.id, status: job.status },
    });
    return { jobId: job.id, status: job.status, failedReason: job.failedReason };
  }

  /** Mo ket tien thu cong (co audit chong that thoat) */
  async openDrawer(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const printer = await this.prisma.printer.findFirst({ where: { id, storeId } });
    if (!printer) throw new NotFoundException('Máy in không tồn tại');
    if (!printer.openDrawer) throw new BadRequestException('Máy in này chưa bật két tiền');
    const job = await this.print.enqueueDrawer(storeId, id);
    await this.audit.log({
      action: 'mo_ket',
      entityType: 'Printer',
      entityId: id,
      storeId,
      userId: user.id,
      afterData: { jobId: job.id },
    });
    return { jobId: job.id, status: job.status, failedReason: job.failedReason };
  }

  listJobs(user: JwtUser, storeId: string, q: { status?: string; printerId?: string; orderId?: string; limit?: number }) {
    assertStoreAccess(user, storeId);
    return this.print.listJobs(storeId, { ...q, take: q.limit });
  }

  /**
   * In lai job that bai: tao job moi tu cung noi dung (job cu danh dau da xu ly).
   * IDEMPOTENT: khoa dedupe co dinh theo job cu (unique theo quan) nen bam 2 lan / 2 nhan vien cung luc
   * chi ra MOT job moi; lan sau tra lai chinh job do (alreadyRetried: true), khong in doi.
   */
  async retryJob(user: JwtUser, storeId: string, jobId: string) {
    assertStoreAccess(user, storeId);
    const old = await this.prisma.printJob.findFirst({ where: { id: jobId, storeId } });
    if (!old) throw new NotFoundException('Job không tồn tại');
    const dedupeKey = `retry:${old.id}`;
    const existing = await this.prisma.printJob.findUnique({ where: { storeId_dedupeKey: { storeId, dedupeKey } } });
    if (existing) {
      return { jobId: existing.id, status: existing.status, failedReason: existing.failedReason, alreadyRetried: true };
    }
    if (old.status !== 'FAILED' && old.status !== 'CANCELLED') {
      throw new ConflictException('Chỉ job đã lỗi hoặc đã hủy mới in lại được');
    }
    if (!old.payload) throw new ConflictException('Job cũ không có nội dung in, hãy in lại từ đơn');
    const printer = old.printerId
      ? await this.prisma.printer.findFirst({ where: { id: old.printerId, storeId } })
      : null;
    const job = await this.print.createJob({
      storeId,
      printer,
      jobType: old.jobType,
      payload: old.payload,
      content: old.content ?? '',
      orderId: old.orderId,
      billId: old.billId,
      dedupeKey,
      copies: old.copies,
      openDrawer: old.openDrawer,
      failReason: printer ? undefined : 'Máy in không còn tồn tại',
    });
    // createJob tra lai job cung khoa neu bi thua cuoc dua: chi 1 job duy nhat ton tai
    await this.prisma.printJob.updateMany({
      where: { id: old.id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: user.id },
    });
    await this.audit.log({
      action: 'in_lai',
      entityType: 'PrintJob',
      entityId: old.id,
      storeId,
      userId: user.id,
      afterData: { newJobId: job.id },
    });
    return { jobId: job.id, status: job.status, failedReason: job.failedReason };
  }

  async cancelJob(user: JwtUser, storeId: string, jobId: string) {
    assertStoreAccess(user, storeId);
    const r = await this.prisma.printJob.updateMany({
      where: { id: jobId, storeId, status: 'PENDING' },
      data: { status: 'CANCELLED', failedReason: 'Đã hủy bởi quản lý' },
    });
    if (r.count === 0) {
      const j = await this.prisma.printJob.findFirst({ where: { id: jobId, storeId } });
      if (!j) throw new NotFoundException('Job không tồn tại');
      throw new ConflictException('Job đã in hoặc đang gửi, không thể hủy');
    }
    await this.audit.log({ action: 'huy_job_in', entityType: 'PrintJob', entityId: jobId, storeId, userId: user.id });
    return { ok: true };
  }

  /** "Da bao bep bang mieng": tat canh bao */
  async acknowledge(user: JwtUser, storeId: string, jobId: string) {
    assertStoreAccess(user, storeId);
    const r = await this.prisma.printJob.updateMany({
      where: { id: jobId, storeId },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: user.id },
    });
    if (r.count === 0) throw new NotFoundException('Job không tồn tại');
    await this.audit.log({ action: 'xac_nhan_job_in', entityType: 'PrintJob', entityId: jobId, storeId, userId: user.id });
    return { ok: true };
  }

  /** Suc khoe he thong in cho banner (moi nhan vien) */
  async health(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const now = Date.now();
    const [mode, agents, printers, pending, failed] = await Promise.all([
      this.print.mode(storeId),
      this.prisma.printAgent.findMany({ where: { storeId, revokedAt: null } }),
      this.prisma.printer.findMany({ where: { storeId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.printJob.count({ where: { storeId, status: { in: ['PENDING', 'SENT'] } } }),
      this.prisma.printJob.count({
        where: {
          storeId,
          status: 'FAILED',
          acknowledgedAt: null,
          createdAt: { gt: new Date(now - 24 * 3600_000) },
        },
      }),
    ]);
    const online = new Set(
      agents.filter((a) => a.lastSeenAt && now - a.lastSeenAt.getTime() < AGENT_OFFLINE_MS).map((a) => a.id),
    );
    return {
      mode,
      agents: agents.map((a) => ({ id: a.id, name: a.name, online: online.has(a.id), lastSeenAt: a.lastSeenAt, version: a.version })),
      printers: printers.map((p) => ({
        id: p.id,
        name: p.name,
        station: p.station,
        status: p.status,
        detail: p.statusDetail,
        enabled: p.enabled,
        agentId: p.agentId,
        agentOnline: p.agentId ? online.has(p.agentId) : false,
      })),
      pendingJobs: pending,
      failedJobs: failed,
    };
  }
}
