import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JobPayload } from '../document/types.js';
import type { AgentJob, JobResultRequest, PrintJobType } from '../protocol.js';

// Server gia lap hang doi in theo dung dac ta (lease, retry lui dan, het han thue) de chay thu agent
// end-to-end. Chi dung cho dev/kiem thu, KHONG phai ma production.

export type MockStatus = 'PENDING' | 'SENT' | 'PRINTED' | 'FAILED' | 'CANCELLED';

export interface MockJob {
  id: string;
  jobType: PrintJobType;
  printerId: string;
  status: MockStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseUntil: number | null;
  nextAttemptAt: number;
  createdAt: number;
  copies: number;
  openDrawer: boolean;
  payload: JobPayload;
  lastError: string | null;
  lastErrorCode: string | null;
  printedAt: number | null;
  results: JobResultRequest[];
}

export interface MockOptions {
  token?: string;
  port?: number;
  /** Thoi han thue (mac dinh 60s nhu dac ta) */
  leaseMs?: number;
  /** Lich thu lai sau moi lan loi (mac dinh 5s, 15s, 45s) */
  retryBackoffMs?: number[];
  maxAttempts?: number;
  /** Chu ky quet het han thue (mac dinh 15s) */
  sweepMs?: number;
  /** Job cu hon khong giao ma danh dau FAILED "Qua han" (mac dinh 15 phut) */
  maxJobAgeMs?: number;
}

export interface EnqueueInput {
  jobType?: PrintJobType;
  printerId: string;
  payload: JobPayload;
  copies?: number;
  openDrawer?: boolean;
  maxAttempts?: number;
  createdAt?: number;
}

export class MockServer {
  readonly token: string;
  readonly jobs = new Map<string, MockJob>();
  heartbeats: Array<{ at: number; body: unknown }> = [];
  /** So lan tiep theo phai "mat phan hoi ket qua": server van ghi nhan nhung tra 500 */
  dropResultResponses = 0;
  private server: http.Server | null = null;
  private port: number;
  private sweeper: NodeJS.Timeout | null = null;
  private readonly o: Required<Omit<MockOptions, 'token' | 'port'>>;
  private readonly sockets = new Set<import('node:net').Socket>();

  constructor(opts: MockOptions = {}) {
    this.token = opts.token ?? 'mock-agent-token';
    this.port = opts.port ?? 0;
    this.o = {
      leaseMs: opts.leaseMs ?? 60000,
      retryBackoffMs: opts.retryBackoffMs ?? [5000, 15000, 45000],
      maxAttempts: opts.maxAttempts ?? 3,
      sweepMs: opts.sweepMs ?? 15000,
      maxJobAgeMs: opts.maxJobAgeMs ?? 15 * 60000,
    };
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const srv = http.createServer((req, res) => void this.handle(req, res));
    srv.on('connection', (s) => {
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.port = (srv.address() as AddressInfo).port;
    this.server = srv;
    this.sweeper = setInterval(() => this.sweep(), this.o.sweepMs);
  }

  /** Tat server (gia lap mat ket noi); du lieu job van giu, goi start() lai de bat tiep cung cong */
  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const s of this.sockets) s.destroy();
    const srv = this.server;
    this.server = null;
    if (srv) await new Promise<void>((r) => srv.close(() => r()));
  }

  enqueue(i: EnqueueInput): MockJob {
    const job: MockJob = {
      id: randomUUID(),
      jobType: i.jobType ?? 'KITCHEN_TICKET',
      printerId: i.printerId,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: i.maxAttempts ?? this.o.maxAttempts,
      leaseUntil: null,
      nextAttemptAt: 0,
      createdAt: i.createdAt ?? Date.now(),
      copies: i.copies ?? 1,
      openDrawer: i.openDrawer ?? false,
      payload: i.payload,
      lastError: null,
      lastErrorCode: null,
      printedAt: null,
      results: [],
    };
    this.jobs.set(job.id, job);
    return job;
  }

  /** Ep job ve PENDING (gia lap giao lai do loi mang) */
  requeue(id: string): void {
    const j = this.jobs.get(id);
    if (j) {
      j.status = 'PENDING';
      j.leaseUntil = null;
      j.nextAttemptAt = 0;
    }
  }

  /** Quet het han thue: job SENT qua han tro ve PENDING (hoac FAILED neu het so lan) */
  sweep(): void {
    const now = Date.now();
    for (const j of this.jobs.values()) {
      if (j.status === 'SENT' && j.leaseUntil !== null && j.leaseUntil <= now) {
        j.leaseUntil = null;
        if (j.attemptCount >= j.maxAttempts) {
          j.status = 'FAILED';
          j.lastError = 'Hết hạn thuê, đã hết số lần thử';
        } else {
          j.status = 'PENDING';
          j.nextAttemptAt = now;
        }
      }
    }
  }

  /** Thue toi da max job den han (giong UPDATE ... FOR UPDATE SKIP LOCKED) */
  claim(max: number, printerIds?: string[]): MockJob[] {
    const now = Date.now();
    const out: MockJob[] = [];
    const due = [...this.jobs.values()]
      .filter((j) => j.status === 'PENDING' && j.nextAttemptAt <= now && (!printerIds || printerIds.includes(j.printerId)))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const j of due) {
      if (out.length >= max) break;
      if (now - j.createdAt > this.o.maxJobAgeMs) {
        j.status = 'FAILED';
        j.lastError = 'Quá hạn';
        continue;
      }
      j.status = 'SENT';
      j.attemptCount++;
      j.leaseUntil = now + this.o.leaseMs;
      out.push(j);
    }
    return out;
  }

  private view(j: MockJob): AgentJob {
    return {
      id: j.id,
      jobType: j.jobType,
      printerId: j.printerId,
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
      leaseUntil: new Date(j.leaseUntil ?? Date.now()).toISOString(),
      createdAt: new Date(j.createdAt).toISOString(),
      copies: j.copies,
      openDrawer: j.openDrawer,
      payload: j.payload,
    };
  }

  private applyResult(j: MockJob, r: JobResultRequest): void {
    j.results.push(r);
    if (j.status === 'PRINTED' || j.status === 'CANCELLED' || j.status === 'FAILED') return; // idempotent
    if (r.ok) {
      j.status = 'PRINTED';
      j.printedAt = Date.now();
      j.leaseUntil = null;
      return;
    }
    if (j.status !== 'SENT') return;
    j.lastError = r.error ?? null;
    j.lastErrorCode = r.errorCode ?? null;
    j.leaseUntil = null;
    if (r.retryable === false || j.attemptCount >= j.maxAttempts) {
      j.status = 'FAILED';
    } else {
      j.status = 'PENDING';
      const b = this.o.retryBackoffMs;
      j.nextAttemptAt = Date.now() + b[Math.min(j.attemptCount - 1, b.length - 1)];
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname;
      // cac endpoint /mock/* de dev/test dieu khien (khong can token)
      if (p === '/mock/jobs' && req.method === 'POST') {
        const input = JSON.parse(await readBody(req)) as EnqueueInput;
        return send(201, this.enqueue(input));
      }
      if (p === '/mock/jobs' && req.method === 'GET') return send(200, [...this.jobs.values()]);
      if (!p.startsWith('/api/v1/agent/')) return send(404, { message: 'Not found' });
      if (req.headers.authorization !== `Bearer ${this.token}`) return send(401, { message: 'Token máy in không hợp lệ' });
      const sub = p.slice('/api/v1/agent'.length);

      if (sub === '/heartbeat' && req.method === 'POST') {
        this.heartbeats.push({ at: Date.now(), body: JSON.parse(await readBody(req)) });
        return send(200, { serverTime: new Date().toISOString() });
      }
      if (sub === '/jobs/next' && req.method === 'GET') {
        const wait = Math.min(30, Number(url.searchParams.get('wait') ?? 0)) * 1000;
        const max = Math.min(20, Math.max(1, Number(url.searchParams.get('max') ?? 5)));
        const deadline = Date.now() + wait;
        let closed = false;
        req.on('close', () => (closed = true));
        for (;;) {
          this.sweep();
          const jobs = this.claim(max);
          if (jobs.length || Date.now() >= deadline || closed) {
            if (closed) {
              // client da bo di: tra lai job vua thue
              for (const j of jobs) {
                j.status = 'PENDING';
                j.attemptCount--;
              }
              return;
            }
            return send(200, { jobs: jobs.map((j) => this.view(j)), serverTime: new Date().toISOString() });
          }
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      const m = /^\/jobs\/([^/]+)\/result$/.exec(sub);
      if (m && req.method === 'POST') {
        const job = this.jobs.get(decodeURIComponent(m[1]));
        if (!job) return send(404, { message: 'Không tìm thấy job' });
        this.applyResult(job, JSON.parse(await readBody(req)) as JobResultRequest);
        if (this.dropResultResponses > 0) {
          this.dropResultResponses--;
          return send(500, { message: 'Lỗi giả lập (mất phản hồi)' });
        }
        return send(200, { status: job.status });
      }
      send(404, { message: 'Not found' });
    } catch (e) {
      send(400, { message: (e as Error).message });
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > 2_000_000) reject(new Error('Body quá lớn'));
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
