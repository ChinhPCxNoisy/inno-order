import net from 'node:net';
import type { AgentConfig, PrinterConfig } from '../agent/config.js';
import { TcpTransport } from './tcp.js';
import { PrintError, PrinterTransport } from './transport.js';

export type TransportFactory = (printer: PrinterConfig) => PrinterTransport;

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const oct = m.slice(1).map(Number);
  if (oct.some((o) => o > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Chi cho phep IP mang noi bo (10.x, 172.16-31.x, 192.168.x); loopback/hostname phai bat rieng trong cau hinh */
export function assertPrinterHost(host: string, sec: AgentConfig['security']): void {
  const fail = (why: string) => {
    throw new PrintError('PRINTER_HOST_REJECTED', `Địa chỉ máy in "${host}" bị chặn: ${why}`, false);
  };
  const ip = net.isIP(host);
  if (ip === 4) {
    if (isPrivateIPv4(host)) return;
    if (/^127\./.test(host) && sec.allowLoopback) return;
    return fail('chỉ chấp nhận IP mạng nội bộ (10.x, 172.16-31.x, 192.168.x)');
  }
  if (ip === 6) {
    if (host === '::1' && sec.allowLoopback) return;
    return fail('chưa hỗ trợ IPv6');
  }
  if (sec.allowHostnames) return;
  fail('tên máy chưa được phép (dùng địa chỉ IP, hoặc bật security.allowHostnames)');
}

/** Tao transport theo kieu ket noi cua may in. Cho USB/Windows spooler: them nhanh o day */
export function createTransportFactory(cfg: AgentConfig): TransportFactory {
  return (p) => {
    if (p.connection !== 'lan') {
      throw new PrintError('UNSUPPORTED_TRANSPORT', `Kiểu kết nối "${p.connection}" chưa được hỗ trợ`, false);
    }
    assertPrinterHost(p.host, cfg.security);
    return new TcpTransport({ host: p.host, port: p.port, ...cfg.net });
  };
}
