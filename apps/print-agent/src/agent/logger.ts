import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export interface LoggerOptions {
  /** Thu muc nhat ky; bo trong = chi ghi console */
  dir?: string;
  file?: string;
  maxBytes?: number;
  keep?: number;
  console?: boolean;
  level?: Level;
}

/** Nhat ky ra console + tep xoay vong nho (agent.log -> agent.log.1 -> .2 ...) */
export class FileLogger implements Logger {
  private readonly o: Required<Omit<LoggerOptions, 'dir'>> & { dir?: string };

  constructor(opts: LoggerOptions = {}) {
    this.o = { file: 'agent.log', maxBytes: 512 * 1024, keep: 3, console: true, level: 'info', ...opts };
    if (this.o.dir) mkdirSync(this.o.dir, { recursive: true });
  }

  private write(level: Level, msg: string, extra?: unknown): void {
    if (ORDER[level] < ORDER[this.o.level]) return;
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${extra === undefined ? '' : ' ' + safeJson(extra)}`;
    if (this.o.console) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    if (this.o.dir) {
      try {
        this.rotate();
        appendFileSync(path.join(this.o.dir, this.o.file), line + '\n');
      } catch {
        // khong de loi ghi nhat ky lam sap agent
      }
    }
  }

  private rotate(): void {
    const f = path.join(this.o.dir!, this.o.file);
    if (!existsSync(f) || statSync(f).size < this.o.maxBytes) return;
    rmSync(`${f}.${this.o.keep}`, { force: true });
    for (let i = this.o.keep - 1; i >= 1; i--) {
      if (existsSync(`${f}.${i}`)) renameSync(`${f}.${i}`, `${f}.${i + 1}`);
    }
    renameSync(f, `${f}.1`);
  }

  debug(m: string, e?: unknown) {
    this.write('debug', m, e);
  }
  info(m: string, e?: unknown) {
    this.write('info', m, e);
  }
  warn(m: string, e?: unknown) {
    this.write('warn', m, e);
  }
  error(m: string, e?: unknown) {
    this.write('error', m, e);
  }
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
