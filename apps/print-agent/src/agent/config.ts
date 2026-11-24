import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CutMode } from '../escpos/commands.js';
import { Encoding, makeProfile, PrinterProfile } from '../escpos/profile.js';

export interface PrinterConfig {
  /** Trung voi printerId trong job cua server */
  id: string;
  name: string;
  /** Hien chi ho tro 'lan' (TCP 9100); 'usb-spooler' de danh cho dot sau */
  connection: 'lan' | 'usb-spooler';
  host: string;
  port: number;
  width: 58 | 80;
  encoding: Encoding;
  /** So bang ma cho cp1258 (ESC t n) */
  codePage: number;
  /** Khu in: thong tin (server dinh tuyen theo printerId, khong theo truong nay) */
  station?: string;
  cutMode: CutMode;
  /** May in co noi ket tien hay khong */
  drawer: boolean;
  drawerPin: 0 | 1;
  /** Ghi de so cot/diem (vi du may 80mm 512 diem = 42 cot) */
  cols?: number;
  dots?: number;
  fontRegular?: string;
  fontBold?: string;
}

export interface AgentConfig {
  serverUrl: string;
  agentToken: string;
  printers: PrinterConfig[];
  pollWaitSeconds: number;
  maxJobsPerPoll: number;
  heartbeatSeconds: number;
  /** Job cu hon so phut nay thi khong in (0 = tat). Server cung kiem; day la lop phong thu thu hai */
  maxJobAgeMinutes: number;
  /** Cho phep http:// (chi nen dung khi dev voi server local) */
  allowInsecureHttp: boolean;
  security: { allowLoopback: boolean; allowHostnames: boolean };
  net: { connectTimeoutMs: number; writeTimeoutMs: number; connectRetries: number };
  /** Lui dan khi mat ket noi toi server */
  backoff: { minMs: number; maxMs: number };
  dataDir: string;
  logDir: string;
}

export class ConfigError extends Error {}

const DEFAULTS = {
  pollWaitSeconds: 20,
  maxJobsPerPoll: 5,
  heartbeatSeconds: 15,
  maxJobAgeMinutes: 15,
  allowInsecureHttp: false,
};

export function profileOf(p: PrinterConfig): PrinterProfile {
  const ov: Partial<PrinterProfile> = {
    encoding: p.encoding,
    codePage: p.codePage,
    cutMode: p.cutMode,
    drawerPin: p.drawerPin,
    fontRegular: p.fontRegular,
    fontBold: p.fontBold,
  };
  if (p.cols) ov.cols = p.cols;
  if (p.dots) ov.dots = Math.floor(p.dots / 8) * 8;
  return makeProfile(p.width, ov);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new ConfigError(`Cấu hình thiếu "${field}"`);
  return v.trim();
}

function num(v: unknown, def: number, field: string, min = 0): number {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new ConfigError(`"${field}" phải là số >= ${min}`);
  return v;
}

export function normalizePrinter(raw: unknown, i: number): PrinterConfig {
  if (!isObj(raw)) throw new ConfigError(`printers[${i}] không hợp lệ`);
  const id = str(raw.id, `printers[${i}].id`);
  const width = raw.width === undefined ? 80 : raw.width;
  if (width !== 58 && width !== 80) throw new ConfigError(`printers[${i}].width phải là 58 hoặc 80`);
  const encoding = (raw.encoding ?? 'raster') as Encoding;
  if (!['raster', 'cp1258', 'ascii'].includes(encoding)) throw new ConfigError(`printers[${i}].encoding phải là raster | cp1258 | ascii`);
  const cutMode = (raw.cutMode ?? 'partial') as CutMode;
  if (!['partial', 'full', 'partial_feed', 'full_feed', 'none'].includes(cutMode)) throw new ConfigError(`printers[${i}].cutMode không hợp lệ`);
  const connection = (raw.connection ?? 'lan') as PrinterConfig['connection'];
  if (connection !== 'lan' && connection !== 'usb-spooler') throw new ConfigError(`printers[${i}].connection không hợp lệ`);
  const port = num(raw.port, 9100, `printers[${i}].port`, 1);
  const pin = raw.drawerPin === 1 ? 1 : 0;
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    connection,
    host: str(raw.host, `printers[${i}].host`),
    port,
    width,
    encoding,
    codePage: num(raw.codePage, 52, `printers[${i}].codePage`),
    station: typeof raw.station === 'string' ? raw.station : undefined,
    cutMode,
    drawer: raw.drawer === true,
    drawerPin: pin,
    cols: raw.cols === undefined ? undefined : num(raw.cols, 0, `printers[${i}].cols`, 8),
    dots: raw.dots === undefined ? undefined : num(raw.dots, 0, `printers[${i}].dots`, 64),
    fontRegular: typeof raw.fontRegular === 'string' ? raw.fontRegular : undefined,
    fontBold: typeof raw.fontBold === 'string' ? raw.fontBold : undefined,
  };
}

/** Kiem tra va bo sung mac dinh cho cau hinh (da doc tu JSON + env) */
export function normalizeConfig(raw: unknown, baseDir: string): AgentConfig {
  if (!isObj(raw)) throw new ConfigError('Tệp cấu hình phải là một đối tượng JSON');
  const serverUrl = str(raw.serverUrl, 'serverUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new ConfigError('"serverUrl" không phải URL hợp lệ');
  }
  const allowInsecureHttp = raw.allowInsecureHttp === true;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || allowInsecureHttp))) {
    throw new ConfigError('"serverUrl" phải dùng https:// (http:// chỉ cho localhost hoặc khi bật allowInsecureHttp)');
  }
  if (!Array.isArray(raw.printers)) throw new ConfigError('"printers" phải là một mảng');
  const printers = raw.printers.map(normalizePrinter);
  const ids = new Set<string>();
  for (const p of printers) {
    if (ids.has(p.id)) throw new ConfigError(`Trùng id máy in: ${p.id}`);
    ids.add(p.id);
  }
  const sec = isObj(raw.security) ? raw.security : {};
  const net = isObj(raw.net) ? raw.net : {};
  const backoff = isObj(raw.backoff) ? raw.backoff : {};
  const abs = (v: unknown, def: string) => path.resolve(baseDir, typeof v === 'string' && v ? v : def);
  return {
    serverUrl,
    agentToken: str(raw.agentToken, 'agentToken'),
    printers,
    pollWaitSeconds: num(raw.pollWaitSeconds, DEFAULTS.pollWaitSeconds, 'pollWaitSeconds'),
    maxJobsPerPoll: num(raw.maxJobsPerPoll, DEFAULTS.maxJobsPerPoll, 'maxJobsPerPoll', 1),
    heartbeatSeconds: num(raw.heartbeatSeconds, DEFAULTS.heartbeatSeconds, 'heartbeatSeconds', 1),
    maxJobAgeMinutes: num(raw.maxJobAgeMinutes, DEFAULTS.maxJobAgeMinutes, 'maxJobAgeMinutes'),
    allowInsecureHttp,
    security: { allowLoopback: sec.allowLoopback === true, allowHostnames: sec.allowHostnames === true },
    net: {
      connectTimeoutMs: num(net.connectTimeoutMs, 3000, 'net.connectTimeoutMs', 100),
      writeTimeoutMs: num(net.writeTimeoutMs, 15000, 'net.writeTimeoutMs', 100),
      connectRetries: num(net.connectRetries, 1, 'net.connectRetries'),
    },
    backoff: { minMs: num(backoff.minMs, 1000, 'backoff.minMs', 1), maxMs: num(backoff.maxMs, 30000, 'backoff.maxMs', 1) },
    dataDir: abs(raw.dataDir, './data'),
    logDir: abs(raw.logDir, './logs'),
  };
}

/** Doc tep JSON + bien moi truong AGENT_SERVER_URL / AGENT_TOKEN (env uu tien hon tep) */
export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): AgentConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Không đọc được tệp cấu hình ${file}: ${(e as Error).message}`);
  }
  if (env.AGENT_SERVER_URL) raw.serverUrl = env.AGENT_SERVER_URL;
  if (env.AGENT_TOKEN) raw.agentToken = env.AGENT_TOKEN;
  return normalizeConfig(raw, path.dirname(path.resolve(file)));
}
