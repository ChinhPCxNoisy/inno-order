import type { AgentErrorCode, ReportedPrinterStatus } from '../protocol.js';

/** Loi khi gui toi may in. retryable = server nen thu lai (theo lich 5s/15s/45s) */
export class PrintError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly retryable = true,
    /** true = loi xay ra truoc khi ket noi duoc (an toan de thu lai ngay, chua ghi byte nao) */
    public beforeConnect = false,
  ) {
    super(message);
    this.name = 'PrintError';
  }
}

export interface PrinterStatusInfo {
  reachable: boolean;
  /** undefined = may in khong tra loi lenh truy van (khong phai may nao cung ho tro) */
  status?: ReportedPrinterStatus;
  detail?: string;
}

/** Cach dua byte ESC/POS toi may in. Hien co LAN (TCP 9100); USB/Windows spooler cam them o day. */
export interface PrinterTransport {
  readonly kind: string;
  send(data: Buffer): Promise<void>;
  /** Kiem tra ket noi + (neu may ho tro) trang thai giay/nap. Khong nem loi, tra reachable=false */
  queryStatus(): Promise<PrinterStatusInfo>;
}
