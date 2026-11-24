import { profileOf } from './config.js';
import type { AgentConfig, PrinterConfig } from './config.js';
import type { Logger } from './logger.js';
import { AuthError, NetworkError, ServerClient, ServerError } from './server-client.js';
import type { AgentState } from './state.js';
import type { AgentJob, HeartbeatRequest, JobResultRequest, ReportedPrinterStatus } from '../protocol.js';
import { writePreview } from '../preview/decode.js';
import { renderJob } from '../render-job.js';
import type { TransportFactory } from '../transport/factory.js';
import { PrintError } from '../transport/transport.js';

export interface AgentDeps {
  config: AgentConfig;
  client: ServerClient;
  logger: Logger;
  state: AgentState;
  transportFactory: TransportFactory;
  version: string;
  /** Co gia tri = che do dry-run: khong gui toi may in, khong bao ket qua, ghi tep xem truoc vao thu muc nay */
  dryRunDir?: string;
}

export interface RunSummary {
  received: number;
  printed: number;
  failed: number;
  skipped: number;
  deduped: number;
}

/** Lui dan co jitter: 1s, 2s, 4s ... toi da maxMs */
export class Backoff {
  private n = 0;
  constructor(
    private readonly minMs: number,
    private readonly maxMs: number,
  ) {}
  next(): number {
    const base = Math.min(this.maxMs, this.minMs * 2 ** this.n++);
    return Math.round(base * (0.9 + Math.random() * 0.2));
  }
  reset(): void {
    this.n = 0;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class PrintAgent {
  private readonly ctrl = new AbortController();
  private readonly busy = new Set<string>();
  private lastStatus = new Map<string, { reachable: boolean; status?: ReportedPrinterStatus; detail?: string }>();

  constructor(private readonly d: AgentDeps) {}

  private get log() {
    return this.d.logger;
  }

  stop(): void {
    this.ctrl.abort();
  }

  /** Mot luot: gui lai ket qua ton, lay job (khong cho), in het, gui ket qua. Dung cho --once */
  async runOnce(): Promise<RunSummary> {
    const sum: RunSummary = { received: 0, printed: 0, failed: 0, skipped: 0, deduped: 0 };
    await this.flushPending();
    const jobs = await this.d.client.pollJobs(0, this.d.config.maxJobsPerPoll);
    for (const job of jobs) await this.handleJob(job, sum);
    await this.flushPending();
    return sum;
  }

  /** Chay lien tuc den khi stop() */
  async start(): Promise<void> {
    const { config } = this.d;
    const backoff = new Backoff(config.backoff.minMs, config.backoff.maxMs);
    const hb = this.heartbeatLoop();
    const sum: RunSummary = { received: 0, printed: 0, failed: 0, skipped: 0, deduped: 0 };
    let downSince: number | null = null;
    while (!this.ctrl.signal.aborted) {
      try {
        await this.flushPending();
        const jobs = await this.d.client.pollJobs(config.pollWaitSeconds, config.maxJobsPerPoll, this.ctrl.signal);
        if (downSince !== null) {
          this.log.info(`Đã kết nối lại server sau ${Math.round((Date.now() - downSince) / 1000)}s`);
          downSince = null;
        }
        backoff.reset();
        for (const job of jobs) await this.handleJob(job, sum);
      } catch (e) {
        if (this.ctrl.signal.aborted) break;
        let wait = backoff.next();
        if (e instanceof AuthError) {
          wait = Math.max(wait, 30000);
          this.log.error(`Server từ chối token (${e.status}): ${e.message}. Kiểm tra agentToken; thử lại sau ${Math.round(wait / 1000)}s`);
        } else if (e instanceof NetworkError || e instanceof ServerError) {
          if (downSince === null) {
            downSince = Date.now();
            this.log.warn(`Mất kết nối server: ${e.message}. Tự thử lại (lùi dần)`);
          } else this.log.debug(`Vẫn chưa kết nối được server: ${e.message}`);
        } else this.log.error('Lỗi không mong đợi trong vòng poll', e);
        await sleep(wait, this.ctrl.signal);
      }
    }
    await hb;
  }

  // ---------- Heartbeat ----------

  private async heartbeatLoop(): Promise<void> {
    const { config } = this.d;
    while (!this.ctrl.signal.aborted) {
      try {
        const req: HeartbeatRequest = { version: this.d.version, printers: [] };
        for (const p of config.printers) req.printers.push({ printerId: p.id, ...(await this.probe(p)) });
        await this.d.client.heartbeat(req);
      } catch (e) {
        this.log.debug(`Heartbeat lỗi: ${(e as Error).message}`);
      }
      await sleep(config.heartbeatSeconds * 1000, this.ctrl.signal);
    }
  }

  /** Hoi trang thai may in; may dang in thi dung trang thai lan truoc (tranh chen ket noi) */
  private async probe(p: PrinterConfig) {
    if (this.d.dryRunDir) return { reachable: true, status: 'OK' as const };
    if (this.busy.has(p.id)) return this.lastStatus.get(p.id) ?? { reachable: true };
    try {
      const info = await this.d.transportFactory(p).queryStatus();
      const r = { reachable: info.reachable, status: info.status, detail: info.detail };
      this.lastStatus.set(p.id, r);
      return r;
    } catch (e) {
      return { reachable: false, detail: (e as Error).message };
    }
  }

  // ---------- Xu ly job ----------

  /** In mot job va bao ket qua. Khong nem loi ra ngoai (loi that bai duoc bao len server) */
  async handleJob(job: AgentJob, sum: RunSummary): Promise<void> {
    const { config, state } = this.d;
    sum.received++;
    const tag = `job ${job.id} (${job.jobType}, lần ${job.attemptCount}/${job.maxAttempts})`;
    const dry = !!this.d.dryRunDir;

    if (!dry && state.hasPrinted(job.id)) {
      this.log.info(`${tag}: đã in trước đó, chỉ gửi lại kết quả (không in lần hai)`);
      sum.deduped++;
      await this.report(job.id, { ok: true, durationMs: 0, note: 'DEDUPED' });
      return;
    }

    const serverNow = this.d.client.serverNow();
    if (Date.parse(job.leaseUntil) <= serverNow) {
      this.log.warn(`${tag}: hết hạn thuê trước khi in, bỏ qua (server sẽ giao lại)`);
      sum.skipped++;
      return;
    }
    const ageMin = config.maxJobAgeMinutes;
    if (ageMin > 0 && serverNow - Date.parse(job.createdAt) > ageMin * 60000) {
      this.log.warn(`${tag}: quá ${ageMin} phút, không in tự động`);
      sum.failed++;
      await this.report(job.id, { ok: false, errorCode: 'JOB_EXPIRED', error: 'Quá hạn', retryable: false });
      return;
    }

    const printer = config.printers.find((p) => p.id === job.printerId);
    if (!printer) {
      this.log.error(`${tag}: máy in "${job.printerId}" không có trong cấu hình agent`);
      sum.failed++;
      await this.report(job.id, {
        ok: false,
        errorCode: 'PRINTER_NOT_CONFIGURED',
        error: `Máy in ${job.printerId} chưa được cấu hình trên agent`,
        retryable: false,
      });
      return;
    }

    const started = Date.now();
    let status: ReportedPrinterStatus | undefined;
    try {
      const rendered = renderJob(job.payload, printer, { copies: job.copies, openDrawer: job.openDrawer || job.jobType === 'DRAWER' });
      if (dry) {
        const base = `${job.id}-${printer.id}`;
        writePreview(this.d.dryRunDir!, base, rendered.bytes, profileOf(printer).cols);
        this.log.info(`${tag}: [dry-run] ${rendered.bytes.length} byte, xem trước tại ${this.d.dryRunDir}/${base}.*`);
        sum.skipped++;
        return;
      }
      this.busy.add(printer.id);
      try {
        await this.d.transportFactory(printer).send(rendered.bytes);
      } finally {
        this.busy.delete(printer.id);
      }
      state.markPrinted(job.id);
      sum.printed++;
      this.log.info(`${tag}: đã gửi ${rendered.bytes.length} byte tới ${printer.name} (${Date.now() - started}ms)`);
      await this.report(job.id, { ok: true, durationMs: Date.now() - started, printerStatus: status });
    } catch (e) {
      const pe =
        e instanceof PrintError ? e : new PrintError('PRINTER_IO', `Lỗi không xác định: ${(e as Error).message}`, true);
      this.log.warn(`${tag}: LỖI ${pe.code} - ${pe.message}`);
      sum.failed++;
      status = pe.code === 'PRINTER_UNREACHABLE' || pe.code === 'PRINTER_REFUSED' || pe.code === 'PRINTER_TIMEOUT' ? 'ERROR' : undefined;
      await this.report(job.id, {
        ok: false,
        error: pe.message,
        errorCode: pe.code,
        retryable: pe.retryable,
        printerStatus: status,
        durationMs: Date.now() - started,
      });
    }
  }

  // ---------- Gui ket qua (ben vung qua mat mang) ----------

  /** Luu truoc roi moi gui: neu sap/mat mang, ket qua van con trong hang cho gui lai */
  private async report(jobId: string, body: JobResultRequest): Promise<void> {
    this.d.state.addPending({ jobId, body });
    await this.flushPending();
  }

  async flushPending(): Promise<void> {
    for (const p of [...this.d.state.pending]) {
      try {
        const r = await this.d.client.sendResult(p.jobId, p.body);
        this.d.state.removePending(p.jobId);
        this.log.debug(`Đã báo kết quả job ${p.jobId} -> ${r.status}`);
      } catch (e) {
        if (e instanceof ServerError && !e.transient && !(e instanceof AuthError)) {
          // 404/409...: server khong nhan ket qua nay nua (job da bi huy/giao cho nguoi khac), bo
          this.log.warn(`Server từ chối kết quả job ${p.jobId} (${e.status}: ${e.message}), bỏ qua`);
          this.d.state.removePending(p.jobId);
          continue;
        }
        this.log.warn(`Chưa gửi được kết quả job ${p.jobId} (${(e as Error).message}), sẽ gửi lại`);
        return; // giu thu tu, thu lai o vong sau
      }
    }
  }
}
