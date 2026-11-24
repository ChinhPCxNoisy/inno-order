import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrintAgent, PrinterStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EventsService } from '../realtime/events.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { MAX_JOB_AGE_MS, PrintService } from './print.service';

const LEASE_MS = 60_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
/** Agent khong heartbeat qua khoang nay -> coi la mat ket noi */
export const AGENT_OFFLINE_MS = 45_000;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface AgentJobDto {
  id: string;
  jobType: string;
  printerId: string;
  attemptCount: number;
  maxAttempts: number;
  leaseUntil: string;
  createdAt: string;
  copies: number;
  openDrawer: boolean;
  dedupeKey: string | null;
  payload: unknown;
}

const PRINTER_STATUS_TEXT = {
  PAPER_OUT: 'Hết giấy',
  COVER_OPEN: 'Nắp máy in đang mở',
  ERROR: 'Máy in báo lỗi',
} as const;

@Injectable()
export class PrintAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrintAgentService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Agent da bao offline (chi phat canh bao mot lan cho moi dot mat ket noi) */
  private readonly offlineAgents = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly print: PrintService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), 5000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ================= QUAN LY AGENT (admin) =================

  async listAgents(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const agents = await this.prisma.printAgent.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      include: { printers: { select: { id: true, name: true } } },
    });
    const now = Date.now();
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      lastSeenAt: a.lastSeenAt,
      revokedAt: a.revokedAt,
      createdAt: a.createdAt,
      online: !a.revokedAt && !!a.lastSeenAt && now - a.lastSeenAt.getTime() < AGENT_OFFLINE_MS,
      printers: a.printers,
    }));
  }

  /** Tao agent: tra token MOT LAN (chi luu bam SHA-256) kem tep cau hinh agent da dien san */
  async createAgent(user: JwtUser, storeId: string, name: string, serverUrl: string) {
    assertStoreAccess(user, storeId);
    const token = this.newToken();
    const agent = await this.prisma.printAgent.create({
      data: { storeId, name: name.trim(), tokenHash: hashToken(token) },
    });
    // Quan chi co dung 1 agent: gan san cac may in chua co agent vao agent nay
    const n = await this.prisma.printAgent.count({ where: { storeId, revokedAt: null } });
    if (n === 1) {
      await this.prisma.printer.updateMany({ where: { storeId, agentId: null }, data: { agentId: agent.id } });
    }
    await this.audit.log({
      action: 'create_print_agent',
      entityType: 'PrintAgent',
      entityId: agent.id,
      storeId,
      userId: user.id,
      afterData: { name: agent.name },
    });
    return {
      agent: { id: agent.id, name: agent.name, createdAt: agent.createdAt },
      token,
      config: await this.buildConfig(storeId, agent.id, token, serverUrl),
    };
  }

  /** Cap lai token (token cu het hieu luc ngay). Hien token moi mot lan + tep cau hinh */
  async rotateToken(user: JwtUser, storeId: string, agentId: string, serverUrl: string) {
    assertStoreAccess(user, storeId);
    const agent = await this.mustAgent(storeId, agentId);
    if (agent.revokedAt) throw new ForbiddenException('Print Agent đã bị thu hồi');
    const token = this.newToken();
    await this.prisma.printAgent.update({ where: { id: agentId }, data: { tokenHash: hashToken(token) } });
    this.offlineAgents.delete(agentId);
    await this.audit.log({
      action: 'rotate_print_agent_token',
      entityType: 'PrintAgent',
      entityId: agentId,
      storeId,
      userId: user.id,
    });
    return { token, config: await this.buildConfig(storeId, agentId, token, serverUrl) };
  }

  /** Tep cau hinh (token KHONG co vi chi luu bam; dan token da luu hoac dung rotate-token) */
  async getConfig(user: JwtUser, storeId: string, agentId: string, serverUrl: string) {
    assertStoreAccess(user, storeId);
    await this.mustAgent(storeId, agentId);
    return this.buildConfig(storeId, agentId, 'DAN-TOKEN-DA-LUU-VAO-DAY', serverUrl);
  }

  async revokeAgent(user: JwtUser, storeId: string, agentId: string) {
    assertStoreAccess(user, storeId);
    await this.mustAgent(storeId, agentId);
    await this.prisma.$transaction([
      this.prisma.printAgent.update({ where: { id: agentId }, data: { revokedAt: new Date() } }),
      // Job dang giao cho agent nay tra ve hang doi (may in gan agent khac se lay)
      this.prisma.printJob.updateMany({
        where: { agentId, status: 'SENT' },
        data: { status: 'PENDING', leaseUntil: null, nextAttemptAt: new Date() },
      }),
    ]);
    this.offlineAgents.delete(agentId);
    await this.audit.log({
      action: 'revoke_print_agent',
      entityType: 'PrintAgent',
      entityId: agentId,
      storeId,
      userId: user.id,
    });
    return { ok: true };
  }

  private newToken() {
    return `ioagent_${randomBytes(32).toString('base64url')}`;
  }

  private async mustAgent(storeId: string, id: string) {
    const a = await this.prisma.printAgent.findFirst({ where: { id, storeId } });
    if (!a) throw new NotFoundException('Print Agent không tồn tại');
    return a;
  }

  private async buildConfig(storeId: string, agentId: string, token: string, serverUrl: string) {
    const printers = await this.prisma.printer.findMany({
      where: { storeId, agentId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      serverUrl,
      agentToken: token,
      pollWaitSeconds: 20,
      heartbeatSeconds: 15,
      maxJobAgeMinutes: 15,
      dataDir: './data',
      logDir: './logs',
      printers: printers.map((p) => ({
        id: p.id,
        name: p.name,
        station: p.station,
        host: p.host ?? '',
        port: p.port ?? 9100,
        width: p.paperSize === 'P58' ? 58 : 80,
        encoding: p.encoding.toLowerCase(),
        ...(p.codePage ? { codePage: p.codePage } : {}),
        cutMode: p.cutAtEnd ? 'partial' : 'none',
        drawer: p.openDrawer,
      })),
    };
  }

  // ================= XAC THUC AGENT =================

  async authenticate(token: string): Promise<PrintAgent | null> {
    if (!token) return null;
    return this.prisma.printAgent.findFirst({ where: { tokenHash: hashToken(token), revokedAt: null } });
  }

  // ================= HEARTBEAT =================

  async heartbeat(
    agent: PrintAgent,
    body: { version?: string; printers?: { printerId: string; reachable: boolean; status?: string; detail?: string }[] },
  ) {
    const now = new Date();
    await this.prisma.printAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: now, ...(body.version ? { version: body.version.slice(0, 40) } : {}) },
    });
    if (this.offlineAgents.delete(agent.id)) {
      this.events.generic('print.recovered', agent.storeId, { agentName: agent.name, scope: 'agent' });
    }
    for (const rp of body.printers ?? []) {
      const printer = await this.prisma.printer.findFirst({
        where: { id: rp.printerId, agentId: agent.id },
      });
      if (!printer) continue;
      let status: PrinterStatus;
      let detail: string | null = null;
      if (!rp.reachable) {
        status = 'OFFLINE';
        detail = rp.detail || 'Không kết nối được máy in';
      } else if (rp.status === 'PAPER_OUT' || rp.status === 'COVER_OPEN' || rp.status === 'ERROR') {
        status = 'ERROR';
        detail = rp.detail || PRINTER_STATUS_TEXT[rp.status];
      } else {
        status = 'ONLINE';
      }
      await this.prisma.printer.update({
        where: { id: printer.id },
        data: { status, statusDetail: detail, lastSeenAt: now },
      });
      if (printer.status !== status) {
        if (status === 'ONLINE') {
          this.events.generic('print.recovered', agent.storeId, {
            printerId: printer.id,
            printerName: printer.name,
            station: printer.station,
            scope: 'printer',
          });
        } else {
          this.events.generic('print.printer_error', agent.storeId, {
            printerId: printer.id,
            printerName: printer.name,
            station: printer.station,
            status,
            detail,
          });
        }
      }
    }
    return { serverTime: now.toISOString() };
  }

  // ================= POLL DAI =================

  async poll(agent: PrintAgent, wait: number, max: number, isClosed: () => boolean) {
    await this.prisma.printAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    const deadline = Date.now() + Math.max(0, Math.min(wait, 30)) * 1000;
    for (;;) {
      const jobs = await this.claim(agent, Math.max(1, Math.min(max, 20)));
      if (jobs.length > 0) {
        if (isClosed()) {
          // Agent da ngat ket noi: tra job ve hang doi, khong de mat/ket
          await this.prisma.printJob.updateMany({
            where: { id: { in: jobs.map((j) => j.id) }, status: 'SENT' },
            data: { status: 'PENDING', leaseUntil: null, attemptCount: { decrement: 1 } },
          });
          return { jobs: [], serverTime: new Date().toISOString() };
        }
        return { jobs, serverTime: new Date().toISOString() };
      }
      if (Date.now() >= deadline || isClosed()) return { jobs: [], serverTime: new Date().toISOString() };
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  private async claim(agent: PrintAgent, max: number): Promise<AgentJobDto[]> {
    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE print_jobs SET status = 'SENT', "agentId" = ${agent.id}::uuid, "sentAt" = ${now},
             "leaseUntil" = ${lease}, "attemptCount" = "attemptCount" + 1
      WHERE id IN (
        SELECT j.id FROM print_jobs j
        JOIN printers p ON p.id = j."printerId"
        WHERE j.status = 'PENDING' AND p."agentId" = ${agent.id}::uuid AND j."storeId" = ${agent.storeId}::uuid
          AND (j."nextAttemptAt" IS NULL OR j."nextAttemptAt" <= ${now})
        ORDER BY j."createdAt" ASC, j.id ASC
        LIMIT ${max}
        FOR UPDATE OF j SKIP LOCKED
      )
      RETURNING id
    `);
    if (rows.length === 0) return [];
    const jobs = await this.prisma.printJob.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const out: AgentJobDto[] = [];
    for (const j of jobs) {
      if (!j.payload || !j.printerId) {
        // Khong co tai lieu in hop le: that bai ngay (khong gui agent)
        await this.finalFail(j.id, 'Job không có nội dung in hợp lệ', 'INVALID_PAYLOAD');
        continue;
      }
      out.push({
        id: j.id,
        jobType: j.jobType,
        printerId: j.printerId,
        attemptCount: j.attemptCount,
        maxAttempts: j.maxAttempts,
        leaseUntil: lease.toISOString(),
        createdAt: j.createdAt.toISOString(),
        copies: j.copies,
        openDrawer: j.openDrawer,
        dedupeKey: j.dedupeKey,
        payload: j.payload,
      });
    }
    return out;
  }

  // ================= KET QUA =================

  async result(
    agent: PrintAgent,
    jobId: string,
    body: {
      ok: boolean;
      error?: string;
      errorCode?: string;
      retryable?: boolean;
      printerStatus?: string;
      durationMs?: number;
      note?: string;
    },
  ) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, storeId: agent.storeId, OR: [{ agentId: agent.id }, { printer: { agentId: agent.id } }] },
    });
    if (!job) throw new NotFoundException('Job không tồn tại');
    // Idempotent: da co ket qua cuoi thi giu nguyen
    if (job.status === 'PRINTED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return { status: job.status };
    }
    const now = new Date();

    if (body.ok) {
      await this.prisma.printJob.updateMany({
        where: { id: jobId, status: { in: ['PENDING', 'SENT'] } },
        data: { status: 'PRINTED', printedAt: now, leaseUntil: null, agentId: agent.id, lastError: null, failedReason: null },
      });
    } else {
      const msg = (body.error ?? 'Máy in báo lỗi').slice(0, 500);
      const retryable = body.retryable !== false;
      if (retryable && job.attemptCount < job.maxAttempts) {
        const delay = RETRY_DELAYS_MS[Math.min(job.attemptCount, RETRY_DELAYS_MS.length) - 1] ?? 45_000;
        await this.prisma.printJob.updateMany({
          where: { id: jobId, status: { in: ['PENDING', 'SENT'] } },
          data: {
            status: 'PENDING',
            leaseUntil: null,
            nextAttemptAt: new Date(now.getTime() + delay),
            lastError: msg,
            errorCode: body.errorCode ?? null,
          },
        });
      } else {
        await this.finalFail(jobId, msg, body.errorCode ?? null);
      }
      // Agent bao printerStatus=ERROR ca khi chi khong ket noi duoc (khong co gia tri "offline" trong giao thuc).
      // Loi ket noi nghia la may in OFFLINE (khong thay/tu choi/qua han), khong phai loi phan cung (het giay/nap mo).
      const connErr = ['PRINTER_UNREACHABLE', 'PRINTER_REFUSED', 'PRINTER_TIMEOUT'].includes(body.errorCode ?? '');
      if (connErr && job.printerId) {
        await this.prisma.printer.update({
          where: { id: job.printerId },
          data: { status: 'OFFLINE', statusDetail: msg.slice(0, 200), lastSeenAt: now },
        });
      } else if (body.printerStatus === 'PAPER_OUT' || body.printerStatus === 'COVER_OPEN' || body.printerStatus === 'ERROR') {
        if (job.printerId) {
          await this.prisma.printer.update({
            where: { id: job.printerId },
            data: { status: 'ERROR', statusDetail: PRINTER_STATUS_TEXT[body.printerStatus], lastSeenAt: now },
          });
        }
      }
    }
    const cur = await this.prisma.printJob.findUnique({ where: { id: jobId }, select: { status: true } });
    return { status: cur?.status ?? job.status };
  }

  private async finalFail(jobId: string, reason: string, errorCode: string | null): Promise<void> {
    const r = await this.prisma.printJob.updateMany({
      where: { id: jobId, status: { in: ['PENDING', 'SENT'] } },
      data: { status: 'FAILED', leaseUntil: null, failedReason: reason, lastError: reason, errorCode },
    });
    if (r.count > 0) await this.print.notifyFailed(jobId);
  }

  // ================= BO QUET =================

  /** Het han thue / job qua cu / agent mat ket noi. Chay moi 5 giay. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = new Date();
      // 1) Het han thue (agent sap giua chung): ve PENDING, het luot thi FAILED
      const expired = await this.prisma.printJob.findMany({
        where: { status: 'SENT', leaseUntil: { lt: now } },
        select: { id: true, attemptCount: true, maxAttempts: true },
        take: 100,
      });
      for (const j of expired) {
        if (j.attemptCount >= j.maxAttempts) {
          await this.finalFail(j.id, 'Print Agent không báo kết quả (hết hạn thuê)', 'LEASE_EXPIRED');
        } else {
          await this.prisma.printJob.updateMany({
            where: { id: j.id, status: 'SENT', leaseUntil: { lt: now } },
            data: { status: 'PENDING', leaseUntil: null, nextAttemptAt: now, lastError: 'Hết hạn thuê, giao lại' },
          });
        }
      }
      // 2) Job cho qua lau: khong in tu dong (tranh in hang loat phieu cu), canh bao
      const old = await this.prisma.printJob.findMany({
        where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - MAX_JOB_AGE_MS) } },
        select: { id: true },
        take: 100,
      });
      for (const j of old) await this.finalFail(j.id, 'Quá hạn: phiếu chờ in quá 15 phút', 'JOB_EXPIRED');
      // 3) Agent mat ket noi
      const stale = await this.prisma.printAgent.findMany({
        where: {
          revokedAt: null,
          lastSeenAt: { not: null, lt: new Date(now.getTime() - AGENT_OFFLINE_MS) },
        },
      });
      for (const a of stale) {
        if (this.offlineAgents.has(a.id)) continue;
        this.offlineAgents.add(a.id);
        await this.prisma.printer.updateMany({
          where: { agentId: a.id },
          data: { status: 'OFFLINE', statusDetail: 'Print Agent mất kết nối' },
        });
        this.events.generic('print.agent_offline', a.storeId, { agentName: a.name, since: a.lastSeenAt });
      }
    } catch (e) {
      this.logger.error(`sweep: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
