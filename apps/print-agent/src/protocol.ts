// Giao thuc Agent <-> Server (xem PROTOCOL.md). Day la hop dong de dot sau backend hien thuc.
import type { JobPayload } from './document/types.js';

export type PrintJobType = 'KITCHEN_TICKET' | 'BILL' | 'PRE_BILL' | 'CANCEL' | 'REPRINT' | 'TEST' | 'DRAWER' | 'TABLE_MOVE';

/** Job do server giao cho agent (sau khi da thue: status = SENT) */
export interface AgentJob {
  id: string;
  jobType: PrintJobType;
  /** Id may in (trung voi printers[].id trong cau hinh agent) */
  printerId: string;
  /** So lan da giao, tinh ca lan nay (1 = lan dau) */
  attemptCount: number;
  maxAttempts: number;
  /** Han thue (ISO, gio server). Qua han ma chua co ket qua -> server tra job ve PENDING */
  leaseUntil: string;
  createdAt: string;
  /** So ban in, mac dinh 1 */
  copies?: number;
  /** true = mo ket tien sau khi in (chi co hieu luc neu may in bat drawer trong cau hinh) */
  openDrawer?: boolean;
  dedupeKey?: string | null;
  payload: JobPayload;
}

export type ReportedPrinterStatus = 'OK' | 'PAPER_OUT' | 'COVER_OPEN' | 'ERROR';

export interface HeartbeatRequest {
  version: string;
  printers: Array<{
    printerId: string;
    reachable: boolean;
    status?: ReportedPrinterStatus;
    detail?: string;
  }>;
}

export interface HeartbeatResponse {
  /** Gio server (ISO) de agent hieu chinh dong ho khi kiem tra han thue */
  serverTime: string;
}

export interface PollResponse {
  jobs: AgentJob[];
  serverTime: string;
}

/** Ma loi agent bao cho server khi that bai */
export type AgentErrorCode =
  | 'PRINTER_NOT_CONFIGURED' // job tro toi may in khong co trong cau hinh agent (khong thu lai)
  | 'PRINTER_UNREACHABLE' // khong toi duoc may in (host khong thay)
  | 'PRINTER_REFUSED' // may in tu choi ket noi (co the dang ban/tat)
  | 'PRINTER_TIMEOUT' // qua thoi gian ket noi/ghi
  | 'PRINTER_IO' // loi khac khi ghi len socket
  | 'PRINTER_HOST_REJECTED' // dia chi may in bi chan boi chinh sach an toan (khong thu lai)
  | 'INVALID_PAYLOAD' // payload sai dinh dang (khong thu lai)
  | 'RENDER_FAILED' // loi dung phieu/ve chu (khong thu lai)
  | 'JOB_EXPIRED' // job qua cu so voi maxJobAgeMinutes (khong thu lai)
  | 'UNSUPPORTED_TRANSPORT'; // kieu ket noi chua ho tro (khong thu lai)

export interface JobResultRequest {
  ok: boolean;
  error?: string;
  errorCode?: AgentErrorCode;
  /** false = loi khong the thu lai (server dat FAILED ngay). Mac dinh true */
  retryable?: boolean;
  printerStatus?: ReportedPrinterStatus;
  durationMs?: number;
  /** "DEDUPED" khi agent bo qua vi job da in truoc do (chi gui lai ket qua) */
  note?: string;
}

export interface JobResultResponse {
  status: 'PENDING' | 'SENT' | 'PRINTED' | 'FAILED' | 'CANCELLED';
}
