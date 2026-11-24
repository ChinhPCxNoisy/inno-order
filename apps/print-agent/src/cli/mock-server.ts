import { parseArgs } from 'node:util';
import { buildSampleData } from '../samples.js';
import { MockServer } from '../mock/mock-server.js';

// Chay: npm run mock-server -- --port 4010 --printer kitchen --seed
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4010' },
    token: { type: 'string', default: 'mock-agent-token' },
    printer: { type: 'string', default: 'kitchen' },
    seed: { type: 'boolean' },
    lease: { type: 'string', default: '60000' },
  },
});
const mock = new MockServer({ port: Number(values.port), token: values.token, leaseMs: Number(values.lease), sweepMs: 1000 });
await mock.start();
console.log(`Mock server: ${mock.url}  token: ${mock.token}`);
console.log('Them job: POST /mock/jobs {printerId, payload}; xem: GET /mock/jobs');
if (values.seed) {
  const s = buildSampleData();
  mock.enqueue({ jobType: 'TEST', printerId: values.printer!, payload: { kind: 'test', data: { printerName: 'Mock' } } });
  mock.enqueue({ jobType: 'KITCHEN_TICKET', printerId: values.printer!, payload: { kind: 'kitchen_ticket', data: s.kitchen } });
  mock.enqueue({ jobType: 'BILL', printerId: values.printer!, openDrawer: true, payload: { kind: 'bill', data: s.bill } });
  console.log('Đã thêm 3 job mẫu (test, phiếu bếp, bill)');
}
process.on('SIGINT', () => void mock.stop().then(() => process.exit(0)));
