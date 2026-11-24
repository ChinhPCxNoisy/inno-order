import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { JobResultRequest } from '../protocol.js';

export interface PendingResult {
  jobId: string;
  body: JobResultRequest;
}

interface StateFile {
  printed: string[];
  pending: PendingResult[];
}

const MAX_PRINTED = 500;

/**
 * Trang thai cuc bo: danh sach job da in (chong in doi khi server giao lai) va ket qua
 * chua gui duoc len server (gui lai khi co mang). Ghi nguyen tu (tmp + rename).
 */
export class AgentState {
  private data: StateFile = { printed: [], pending: [] };

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const d = JSON.parse(readFileSync(file, 'utf8'));
        this.data = { printed: Array.isArray(d.printed) ? d.printed : [], pending: Array.isArray(d.pending) ? d.pending : [] };
      } catch {
        try {
          renameSync(file, `${file}.bad`); // tep hong: giu lai de xem, bat dau lai
        } catch {
          // bo qua
        }
      }
    }
  }

  hasPrinted(jobId: string): boolean {
    return this.data.printed.includes(jobId);
  }

  markPrinted(jobId: string): void {
    if (!this.hasPrinted(jobId)) this.data.printed.push(jobId);
    if (this.data.printed.length > MAX_PRINTED) this.data.printed.splice(0, this.data.printed.length - MAX_PRINTED);
    this.save();
  }

  get pending(): readonly PendingResult[] {
    return this.data.pending;
  }

  addPending(r: PendingResult): void {
    this.data.pending = this.data.pending.filter((p) => p.jobId !== r.jobId);
    this.data.pending.push(r);
    this.save();
  }

  removePending(jobId: string): void {
    this.data.pending = this.data.pending.filter((p) => p.jobId !== jobId);
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
