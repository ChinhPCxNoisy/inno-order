import net from 'node:net';
import os from 'node:os';
import { parseArgs } from 'node:util';

// Quet dai mang /24 tim may in LAN dang mo cong 9100. Chi ket noi TCP roi dong, khong gui du lieu.
// Chay: npm run discover -- [--subnet 192.168.1] [--port 9100]
const { values } = parseArgs({ options: { subnet: { type: 'string' }, port: { type: 'string', default: '9100' }, timeout: { type: 'string', default: '400' } } });
const port = Number(values.port);
const timeout = Number(values.timeout);

function localSubnets(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) out.add(i.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}

function probe(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

const subnets = values.subnet ? [values.subnet] : localSubnets();
if (!subnets.length) {
  console.error('Không tìm thấy mạng nội bộ. Dùng --subnet 192.168.1');
  process.exit(2);
}
for (const sub of subnets) {
  if (!/^(10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3})$/.test(sub)) {
    console.error(`Dải ${sub} không phải mạng nội bộ, bỏ qua`);
    continue;
  }
  console.log(`Quét ${sub}.1-254 cổng ${port} ...`);
  const hosts = Array.from({ length: 254 }, (_, i) => `${sub}.${i + 1}`);
  const found: string[] = [];
  for (let i = 0; i < hosts.length; i += 64) {
    const batch = hosts.slice(i, i + 64);
    const res = await Promise.all(batch.map(probe));
    batch.forEach((h, k) => res[k] && found.push(h));
  }
  console.log(found.length ? found.map((h) => `  ${h}:${port}  (có thể là máy in)`).join('\n') : '  Không thấy thiết bị nào mở cổng này');
}
