import net from 'node:net';
import { CMD_STATUS_OFFLINE, CMD_STATUS_PAPER } from '../escpos/commands.js';
import { PrintError, PrinterStatusInfo, PrinterTransport } from './transport.js';

export interface TcpOptions {
  host: string;
  port: number;
  /** Thoi gian cho ket noi (spec: 3 giay) */
  connectTimeoutMs?: number;
  /** Tong thoi gian cho ghi xong du lieu */
  writeTimeoutMs?: number;
  /** So lan thu lai CHI khi chua ket noi duoc (khong thu lai khi da ghi dang do, tranh in doi) */
  connectRetries?: number;
  retryDelayMs?: number;
  /** Cho may in dong ket noi sau khi gui FIN truoc khi tu dong */
  lingerMs?: number;
}

/** May in LAN qua TCP (thuong cong 9100, JetDirect/RAW) */
export class TcpTransport implements PrinterTransport {
  readonly kind = 'lan';
  private readonly o: Required<TcpOptions>;

  constructor(opts: TcpOptions) {
    this.o = {
      connectTimeoutMs: 3000,
      writeTimeoutMs: 15000,
      connectRetries: 1,
      retryDelayMs: 300,
      lingerMs: 1500,
      ...opts,
    };
  }

  async send(data: Buffer): Promise<void> {
    let lastErr: PrintError | null = null;
    for (let attempt = 0; attempt <= this.o.connectRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.o.retryDelayMs));
      try {
        await this.sendOnce(data);
        return;
      } catch (e) {
        lastErr = e as PrintError;
        if (!(lastErr instanceof PrintError) || !lastErr.beforeConnect) throw e;
      }
    }
    throw lastErr!;
  }

  private sendOnce(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, port } = this.o;
      const sock = net.createConnection({ host, port });
      let connected = false;
      let settled = false;
      const done = (err?: PrintError) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(writeTimer);
        clearTimeout(lingerTimer);
        sock.destroy();
        if (err) {
          err.beforeConnect = !connected;
          reject(err);
        } else resolve();
      };
      let lingerTimer: NodeJS.Timeout | undefined;
      const connectTimer = setTimeout(
        () => done(new PrintError('PRINTER_TIMEOUT', `Không kết nối được máy in ${host}:${port} sau ${this.o.connectTimeoutMs}ms`)),
        this.o.connectTimeoutMs,
      );
      const writeTimer = setTimeout(
        () => done(new PrintError('PRINTER_TIMEOUT', `Gửi dữ liệu tới máy in ${host}:${port} quá thời gian`)),
        this.o.writeTimeoutMs,
      );
      sock.setNoDelay(true);
      sock.on('error', (e: NodeJS.ErrnoException) => done(mapNetError(e, host, port)));
      sock.once('connect', () => {
        connected = true;
        clearTimeout(connectTimer);
        // end(data) ghi du lieu roi gui FIN; 'finish' = da day het vao nhan he dieu hanh
        sock.end(data, () => {
          // cho may in tu dong ket noi (dam bao du lieu da duoc doc), qua han thi tu dong
          sock.once('close', () => done());
          lingerTimer = setTimeout(() => done(), this.o.lingerMs);
        });
      });
      sock.on('close', () => {
        if (!connected) done(new PrintError('PRINTER_IO', `Kết nối tới máy in ${host}:${port} bị đóng`));
      });
    });
  }

  /** Mo ket noi rieng, hoi trang thai DLE EOT 2 + 4, cho toi da 800ms sau khi noi */
  queryStatus(): Promise<PrinterStatusInfo> {
    const { host, port } = this.o;
    return new Promise((resolve) => {
      const sock = net.createConnection({ host, port });
      const chunks: number[] = [];
      let settled = false;
      let replyTimer: NodeJS.Timeout | undefined;
      const finish = (info: PrinterStatusInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(replyTimer);
        sock.destroy();
        resolve(info);
      };
      const connectTimer = setTimeout(
        () => finish({ reachable: false, detail: 'Không kết nối được (quá thời gian)' }),
        this.o.connectTimeoutMs,
      );
      sock.on('error', (e: NodeJS.ErrnoException) => finish({ reachable: false, detail: mapNetError(e, host, port).message }));
      sock.once('connect', () => {
        clearTimeout(connectTimer);
        sock.write(Buffer.concat([CMD_STATUS_OFFLINE, CMD_STATUS_PAPER]));
        replyTimer = setTimeout(() => finish(parseStatus(chunks)), 800);
        sock.on('data', (d) => {
          chunks.push(...d);
          if (chunks.length >= 2) finish(parseStatus(chunks));
        });
      });
    });
  }
}

/** DLE EOT 2: bit2 nap mo, bit5 het giay (dung in), bit6 loi. DLE EOT 4: bit2-3 sap het giay, bit5-6 het giay */
export function parseStatus(bytes: number[]): PrinterStatusInfo {
  if (bytes.length < 2) return { reachable: true };
  const [offline, paper] = bytes;
  if (paper & 0x60) return { reachable: true, status: 'PAPER_OUT', detail: 'Hết giấy' };
  if (offline & 0x20) return { reachable: true, status: 'PAPER_OUT', detail: 'Hết giấy (dừng in)' };
  if (offline & 0x04) return { reachable: true, status: 'COVER_OPEN', detail: 'Nắp máy in đang mở' };
  if (offline & 0x40) return { reachable: true, status: 'ERROR', detail: 'Máy in báo lỗi' };
  if (paper & 0x0c) return { reachable: true, status: 'OK', detail: 'Sắp hết giấy' };
  return { reachable: true, status: 'OK' };
}

function mapNetError(e: NodeJS.ErrnoException, host: string, port: number): PrintError {
  const at = `${host}:${port}`;
  switch (e.code) {
    case 'ECONNREFUSED':
      return new PrintError('PRINTER_REFUSED', `Máy in ${at} từ chối kết nối (đang tắt hoặc sai cổng)`);
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ENOTFOUND':
      return new PrintError('PRINTER_UNREACHABLE', `Không tìm thấy máy in ${at} trên mạng`);
    case 'ETIMEDOUT':
      return new PrintError('PRINTER_TIMEOUT', `Kết nối tới máy in ${at} quá thời gian`);
    default:
      return new PrintError('PRINTER_IO', `Lỗi mạng với máy in ${at}: ${e.code ?? e.message}`);
  }
}
