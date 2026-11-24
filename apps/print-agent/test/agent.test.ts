import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { PrintAgent } from '../src/agent/agent.js';
import { AgentConfig, normalizeConfig } from '../src/agent/config.js';
import { silentLogger } from '../src/agent/logger.js';
import { ServerClient } from '../src/agent/server-client.js';
import { AgentState } from '../src/agent/state.js';
import { FakePrinter } from '../src/mock/fake-printer.js';
import { MockServer, MockOptions } from '../src/mock/mock-server.js';
import { decodeEscPos, renderPreviewText } from '../src/preview/decode.js';
import { buildSampleData } from '../src/samples.js';
import { TcpTransport } from '../src/transport/tcp.js';
import { assertPrinterHost, createTransportFactory } from '../src/transport/factory.js';
import { PrintError } from '../src/transport/transport.js';

const sample = buildSampleData();
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function waitFor(cond: () => boolean, ms = 5000, what = 'dieu kien'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Qua thoi gian cho ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

interface Env {
  mock: MockServer;
  fake: FakePrinter;
  dir: string;
  config: AgentConfig;
  makeAgent: (opts?: { token?: string; dryRunDir?: string; printerId?: string }) => { agent: PrintAgent; run: Promise<void>; state: AgentState };
}

async function setup(mockOpts: MockOptions = {}, startFake = true): Promise<Env> {
  const mock = new MockServer({ retryBackoffMs: [30, 30, 30], sweepMs: 30, ...mockOpts });
  await mock.start();
  const fake = new FakePrinter();
  await fake.start();
  const port = fake.port;
  if (!startFake) await fake.stop();
  fake.opts.port = port;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pa-test-'));
  const config = normalizeConfig(
    {
      serverUrl: mock.url,
      agentToken: mock.token,
      printers: [{ id: 'kitchen', name: 'Bếp', host: '127.0.0.1', port, width: 80, encoding: 'ascii' }],
      pollWaitSeconds: 0.2,
      heartbeatSeconds: 1,
      security: { allowLoopback: true },
      net: { connectTimeoutMs: 300, writeTimeoutMs: 2000, connectRetries: 0 },
      backoff: { minMs: 20, maxMs: 100 },
    },
    dir,
  );
  cleanups.push(async () => {
    await fake.stop();
    await mock.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const makeAgent: Env['makeAgent'] = (o = {}) => {
    const client = new ServerClient({ baseUrl: mock.url, token: o.token ?? mock.token, version: 'test' });
    const state = new AgentState(path.join(dir, 'state.json'));
    const agent = new PrintAgent({ config, client, logger: silentLogger, state, transportFactory: createTransportFactory(config), version: 'test', dryRunDir: o.dryRunDir });
    const run = agent.start();
    cleanups.push(async () => {
      agent.stop();
      await run;
    });
    return { agent, run, state };
  };
  return { mock, fake, dir, config, makeAgent };
}

const kitchenPayload = { kind: 'kitchen_ticket', data: sample.kitchen } as const;
const printedText = (fake: FakePrinter, i = 0) => renderPreviewText(decodeEscPos(fake.received[i].bytes), { cols: 48 });

test('job thanh cong: poll -> in -> ack, may in nhan dung mot phieu', async () => {
  const e = await setup();
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent();
  await waitFor(() => job.status === 'PRINTED', 5000, 'job PRINTED');
  assert.equal(job.attemptCount, 1);
  assert.equal(e.fake.received.length, 1);
  const t = printedText(e.fake);
  assert.ok(t.includes('BAN B05') && t.includes('2 x Lau Thai hai san'), t);
  assert.ok(e.fake.received[0].bytes.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])));
  await waitFor(() => e.mock.heartbeats.length > 0, 3000, 'heartbeat');
});

test('may in nhan payload raw (base64 dung san tu server) nguyen ven, in 2 ban khi copies=2', async () => {
  const e = await setup();
  const raw = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x0a, 0x1d, 0x56, 0x01]);
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: { kind: 'raw', base64: raw.toString('base64') } });
  const job2 = e.mock.enqueue({ printerId: 'kitchen', copies: 2, payload: { kind: 'raw', base64: raw.toString('base64') } });
  e.makeAgent();
  await waitFor(() => job.status === 'PRINTED' && job2.status === 'PRINTED');
  assert.deepEqual([...e.fake.received[0].bytes], [...raw]);
  assert.equal(e.fake.received[1].bytes.length, raw.length * 2);
});

test('mat phan hoi ket qua: agent gui lai, server nhat quan, may in chi in mot lan', async () => {
  const e = await setup();
  e.mock.dropResultResponses = 1;
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  const { state } = e.makeAgent();
  await waitFor(() => job.status === 'PRINTED');
  await waitFor(() => job.results.length >= 2 && state.pending.length === 0, 5000, 'gui lai ket qua');
  assert.equal(e.fake.received.length, 1);
  assert.ok(job.results.every((r) => r.ok));
});

test('server giao lai job da in: agent khong in lan hai, chi bao lai DEDUPED', async () => {
  const e = await setup();
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent();
  await waitFor(() => job.status === 'PRINTED');
  e.mock.requeue(job.id);
  await waitFor(() => job.results.some((r) => r.note === 'DEDUPED'), 5000, 'DEDUPED');
  assert.equal(e.fake.received.length, 1);
  assert.equal(job.status, 'PRINTED');
});

test('may in offline: thu lai theo lich roi bao FAILED, ma loi ro rang', async () => {
  const e = await setup({}, false);
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent();
  await waitFor(() => job.status === 'FAILED', 8000, 'job FAILED');
  assert.equal(job.attemptCount, 3);
  assert.equal(job.lastErrorCode, 'PRINTER_REFUSED');
  assert.match(job.lastError ?? '', /từ chối kết nối|tắt/);
  assert.equal(job.results.length, 3);
});

test('may in bat lai giua cac lan thu: job in thanh cong o lan thu sau', async () => {
  const e = await setup({ retryBackoffMs: [250, 250, 250] }, false);
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent();
  await waitFor(() => job.attemptCount >= 1 && job.results.length >= 1, 5000, 'lan thu dau that bai');
  await e.fake.start();
  await waitFor(() => job.status === 'PRINTED', 8000, 'job PRINTED');
  assert.ok(job.attemptCount >= 2);
  assert.equal(job.results[0].ok, false);
  assert.equal(e.fake.received.length, 1);
});

test('het han thue: agent cu "chet", server tra job ve PENDING, agent moi in', async () => {
  const e = await setup({ leaseMs: 200 });
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  const stolen = e.mock.claim(1); // gia lap agent da nhan job roi sap
  assert.equal(stolen[0].id, job.id);
  assert.equal(job.status, 'SENT');
  e.makeAgent();
  await waitFor(() => job.status === 'PRINTED', 5000, 'job in sau khi het han thue');
  assert.equal(job.attemptCount, 2);
  assert.equal(e.fake.received.length, 1);
});

test('mat ket noi server roi noi lai: agent tu ket noi lai va in job cho', async () => {
  const e = await setup();
  e.makeAgent();
  const first = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  await waitFor(() => first.status === 'PRINTED');
  await e.mock.stop();
  const during = e.mock.enqueue({ printerId: 'kitchen', payload: { kind: 'test' } });
  await new Promise((r) => setTimeout(r, 400)); // agent bi loi ket noi, dang lui dan
  assert.equal(during.status, 'PENDING');
  await e.mock.start();
  await waitFor(() => during.status === 'PRINTED', 5000, 'in bu sau khi noi lai');
  assert.equal(e.fake.received.length, 2);
});

test('loi khong the thu lai: may in chua cau hinh, payload hong, job qua cu -> FAILED ngay', async () => {
  const e = await setup({ maxJobAgeMs: 10 * 3600_000 });
  const a = e.mock.enqueue({ printerId: 'ghost', payload: kitchenPayload });
  const b = e.mock.enqueue({ printerId: 'kitchen', payload: { kind: 'document', document: { v: 1, blocks: [{ t: 'boom' }] } } as never });
  const c = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload, createdAt: Date.now() - 20 * 60000 });
  e.makeAgent();
  await waitFor(() => [a, b, c].every((j) => j.status === 'FAILED'), 5000, 'ca ba FAILED');
  assert.deepEqual([a, b, c].map((j) => j.attemptCount), [1, 1, 1]);
  assert.deepEqual([a, b, c].map((j) => j.lastErrorCode), ['PRINTER_NOT_CONFIGURED', 'INVALID_PAYLOAD', 'JOB_EXPIRED']);
  assert.equal(e.fake.received.length, 0);
});

test('dry-run: khong gui toi may in, khong bao ket qua, ghi tep xem truoc', async () => {
  const e = await setup({ leaseMs: 60000 });
  const out = path.join(e.dir, 'dry');
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent({ dryRunDir: out });
  await waitFor(() => existsSync(out) && readdirSync(out).some((f) => f.endsWith('.txt')), 5000, 'tep xem truoc');
  assert.equal(e.fake.received.length, 0);
  assert.equal(job.status, 'SENT'); // da thue nhung khong bao ket qua
  assert.equal(job.results.length, 0);
});

test('--once: lay mot luot, in, bao ket qua, tra tong ket', async () => {
  const e = await setup();
  const ok = e.mock.enqueue({ printerId: 'kitchen', payload: { kind: 'test' } });
  const client = new ServerClient({ baseUrl: e.mock.url, token: e.mock.token, version: 'test' });
  const agent = new PrintAgent({ config: e.config, client, logger: silentLogger, state: new AgentState(null), transportFactory: createTransportFactory(e.config), version: 'test' });
  const sum = await agent.runOnce();
  assert.deepEqual(sum, { received: 1, printed: 1, failed: 0, skipped: 0, deduped: 0 });
  assert.equal(ok.status, 'PRINTED');
});

test('token sai: agent khong sap, khong lay duoc job, dung duoc', async () => {
  const e = await setup();
  const job = e.mock.enqueue({ printerId: 'kitchen', payload: kitchenPayload });
  e.makeAgent({ token: 'sai-token' });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(job.status, 'PENDING');
  assert.equal(e.fake.received.length, 0);
});

test('chinh sach dia chi may in: chi IP noi bo, chan IP cong cong va ten may', () => {
  const sec = { allowLoopback: false, allowHostnames: false };
  for (const ok of ['192.168.1.50', '10.0.0.7', '172.16.5.5', '172.31.255.1']) assert.doesNotThrow(() => assertPrinterHost(ok, sec));
  for (const bad of ['8.8.8.8', '172.32.0.1', '127.0.0.1', '169.254.1.1', 'printer.example.com', '::1', '192.168.1.999']) {
    assert.throws(() => assertPrinterHost(bad, sec), (err: unknown) => err instanceof PrintError && err.code === 'PRINTER_HOST_REJECTED' && !err.retryable, bad);
  }
  assert.doesNotThrow(() => assertPrinterHost('127.0.0.1', { allowLoopback: true, allowHostnames: false }));
});

test('transport TCP: truy van trang thai (het giay / binh thuong) va may in khong tra loi', async () => {
  const fake = new FakePrinter({ statusReply: [0x12, 0x72] });
  await fake.start();
  cleanups.push(() => fake.stop());
  const t = new TcpTransport({ host: '127.0.0.1', port: fake.port, connectTimeoutMs: 300 });
  const st = await t.queryStatus();
  assert.equal(st.reachable, true);
  assert.equal(st.status, 'PAPER_OUT');
  assert.equal(fake.received.length, 0); // truy van khong bi tinh la phieu
  await fake.stop();
  const off = await t.queryStatus();
  assert.equal(off.reachable, false);
  await assert.rejects(new TcpTransport({ host: '127.0.0.1', port: fake.port, connectTimeoutMs: 300, connectRetries: 1, retryDelayMs: 10 }).send(Buffer.from('x')), (e: unknown) => e instanceof PrintError && e.code === 'PRINTER_REFUSED' && e.retryable);
});
