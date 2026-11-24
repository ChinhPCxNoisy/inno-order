import { parseArgs } from 'node:util';
import path from 'node:path';
import { AgentState } from '../agent/state.js';
import { PrintAgent } from '../agent/agent.js';
import { ConfigError, loadConfig } from '../agent/config.js';
import { FileLogger } from '../agent/logger.js';
import { ServerClient } from '../agent/server-client.js';
import { renderJob } from '../render-job.js';
import { createTransportFactory } from '../transport/factory.js';
import { VERSION } from '../version.js';

const HELP = `InnoOrder Print Agent ${VERSION}

Cach dung: print-agent [tuy chon]
  (khong tuy chon)        chay lien tuc: poll job, in, bao ket qua
  --once                  lay job mot luot roi thoat (ma thoat 1 neu co job loi)
  --dry-run               khong gui toi may in, khong bao ket qua; ghi xem truoc vao ./dry-run
  --test-print <id>       in trang thu tren may in <id> (khong can server)
  --config <tep>          tep cau hinh (mac dinh ./agent.config.json hoac PRINT_AGENT_CONFIG)
  --help
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      once: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'test-print': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const file = values.config ?? process.env.PRINT_AGENT_CONFIG ?? './agent.config.json';
  let config;
  try {
    config = loadConfig(file);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`Lỗi cấu hình: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const logger = new FileLogger({ dir: config.logDir });
  const transportFactory = createTransportFactory(config);

  if (values['test-print']) {
    const printer = config.printers.find((p) => p.id === values['test-print']);
    if (!printer) {
      console.error(`Không có máy in "${values['test-print']}" trong cấu hình. Có: ${config.printers.map((p) => p.id).join(', ')}`);
      return 2;
    }
    try {
      const { bytes } = renderJob({ kind: 'test', data: { printerName: printer.name } }, printer);
      await transportFactory(printer).send(bytes);
      logger.info(`Đã gửi trang in thử tới ${printer.name} (${printer.host}:${printer.port}, ${bytes.length} byte, ${printer.encoding})`);
      return 0;
    } catch (e) {
      logger.error(`In thử thất bại: ${(e as Error).message}`);
      return 1;
    }
  }

  const dryRunDir = values['dry-run'] ? path.resolve('dry-run') : undefined;
  const client = new ServerClient({ baseUrl: config.serverUrl, token: config.agentToken, version: VERSION });
  const state = new AgentState(dryRunDir ? null : path.join(config.dataDir, 'state.json'));
  const agent = new PrintAgent({ config, client, logger, state, transportFactory, version: VERSION, dryRunDir });

  if (values.once) {
    try {
      const s = await agent.runOnce();
      logger.info(`Xong: nhận ${s.received}, in ${s.printed}, lỗi ${s.failed}, bỏ qua ${s.skipped}, trùng ${s.deduped}`);
      return s.failed > 0 ? 1 : 0;
    } catch (e) {
      logger.error(`Không chạy được: ${(e as Error).message}`);
      return 1;
    }
  }

  const stop = () => {
    logger.info('Đang dừng agent...');
    agent.stop();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  logger.info(`Print Agent ${VERSION} khởi động. Server: ${config.serverUrl}; ${config.printers.length} máy in${dryRunDir ? '; CHẾ ĐỘ DRY-RUN' : ''}`);
  await agent.start();
  logger.info('Agent đã dừng');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
