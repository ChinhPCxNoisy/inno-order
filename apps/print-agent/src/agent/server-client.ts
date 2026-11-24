import type { AgentJob, HeartbeatRequest, HeartbeatResponse, JobResultRequest, JobResultResponse, PollResponse } from '../protocol.js';

/** Khong toi duoc server (mang rot, DNS, timeout) */
export class NetworkError extends Error {}
/** Server tra loi nhung bao loi */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 5xx, 408, 429 coi la tam thoi, gui lai sau */
  get transient(): boolean {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}
/** Token sai/bi thu hoi */
export class AuthError extends ServerError {}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  version: string;
  fetchImpl?: typeof fetch;
}

/** Client HTTP cho cac endpoint /api/v1/agent/* (xem PROTOCOL.md) */
export class ServerClient {
  /** Chenh lech dong ho: gio server - gio may quay (ms) */
  clockOffsetMs = 0;
  private readonly f: typeof fetch;

  constructor(private readonly o: ClientOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, pathName: string, body?: unknown, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl}/api/v1/agent${pathName}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.o.token}`,
          'Content-Type': 'application/json',
          'User-Agent': `innoorder-print-agent/${this.o.version}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new NetworkError(`Không kết nối được server: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let msg = text.slice(0, 200);
      try {
        msg = JSON.parse(text).message ?? msg;
      } catch {
        // khong phai JSON
      }
      if (res.status === 401 || res.status === 403) throw new AuthError(res.status, String(msg || 'Token máy in không hợp lệ'));
      throw new ServerError(res.status, String(msg || `HTTP ${res.status}`));
    }
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new ServerError(502, 'Server trả về dữ liệu không phải JSON');
    }
  }

  private syncClock(serverTime?: string): void {
    const t = serverTime ? Date.parse(serverTime) : NaN;
    if (!Number.isNaN(t)) this.clockOffsetMs = t - Date.now();
  }

  /** Gio hien tai theo dong ho server */
  serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  async heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse> {
    const r = await this.call<HeartbeatResponse>('POST', '/heartbeat', req);
    this.syncClock(r.serverTime);
    return r;
  }

  /** Poll dai: server giu ket noi toi da waitSeconds. Chap nhan ca dang mang tran lan {jobs} */
  async pollJobs(waitSeconds: number, max: number, signal?: AbortSignal): Promise<AgentJob[]> {
    const r = await this.call<PollResponse | AgentJob[]>(
      'GET',
      `/jobs/next?wait=${waitSeconds}&max=${max}`,
      undefined,
      waitSeconds * 1000 + 10000,
      signal,
    );
    if (Array.isArray(r)) return r;
    this.syncClock(r.serverTime);
    return Array.isArray(r.jobs) ? r.jobs : [];
  }

  sendResult(jobId: string, body: JobResultRequest): Promise<JobResultResponse> {
    return this.call<JobResultResponse>('POST', `/jobs/${encodeURIComponent(jobId)}/result`, body);
  }
}
