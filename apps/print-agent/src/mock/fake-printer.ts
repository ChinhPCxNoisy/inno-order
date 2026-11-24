import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface FakePrinterOptions {
  port?: number;
  host?: string;
  /** Thu muc ghi tep .bin cho moi phieu nhan duoc (tuy chon) */
  outDir?: string;
  /** Tri hoan sau khi nhan du lieu moi dong ket noi (gia lap may in cham) */
  delayMs?: number;
  /** Byte tra loi cho DLE EOT 2 va 4 (mac dinh 0x12, 0x12 = binh thuong) */
  statusReply?: number[];
}

export interface ReceivedPrint {
  at: number;
  bytes: Buffer;
}

/** May in LAN gia lap: lang nghe TCP, ghi lai byte nhan duoc, tra loi truy van trang thai */
export class FakePrinter {
  readonly received: ReceivedPrint[] = [];
  private server: net.Server | null = null;
  private readonly conns = new Set<net.Socket>();
  port = 0;

  constructor(readonly opts: FakePrinterOptions = {}) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer((sock) => this.onConnection(sock));
      srv.once('error', reject);
      srv.listen(this.opts.port ?? 0, this.opts.host ?? '127.0.0.1', () => {
        this.server = srv;
        this.port = (srv.address() as net.AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  private onConnection(sock: net.Socket): void {
    this.conns.add(sock);
    const chunks: Buffer[] = [];
    sock.on('data', (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      // truy van trang thai: DLE EOT 2 / DLE EOT 4 (khong phai phieu)
      if (all.length >= 6 && all[0] === 0x10 && all[1] === 0x04 && all[3] === 0x10) {
        sock.write(Buffer.from(this.opts.statusReply ?? [0x12, 0x12]));
        chunks.length = 0;
      }
    });
    sock.on('end', () => {
      const bytes = Buffer.concat(chunks);
      const finish = () => {
        if (bytes.length) {
          this.received.push({ at: Date.now(), bytes });
          if (this.opts.outDir) {
            mkdirSync(this.opts.outDir, { recursive: true });
            writeFileSync(path.join(this.opts.outDir, `print-${Date.now()}-${this.received.length}.bin`), bytes);
          }
        }
        sock.end();
      };
      if (this.opts.delayMs) setTimeout(finish, this.opts.delayMs);
      else finish();
    });
    sock.on('error', () => undefined);
    sock.on('close', () => this.conns.delete(sock));
  }

  /** Tat may in (gia lap offline); goi start() lai de bat tiep (nen dung lai cung cong) */
  async stop(): Promise<void> {
    for (const s of this.conns) s.destroy();
    const srv = this.server;
    this.server = null;
    if (srv) await new Promise<void>((r) => srv.close(() => r()));
  }
}
