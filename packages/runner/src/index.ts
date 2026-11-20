import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeAssistant } from './assist.js';
import { RunnerClient } from './client.js';
import { loadConfig } from './config.js';
import { runDiagnostics } from './diagnostics.js';
import { systemFolderPicker } from './folder-picker.js';
import { createNodeHost } from './engine/node-host.js';
import { defaultDataDir } from './journal.js';
import { createPermissionBridge } from './permissions/bridge.js';
import { ApprovalEndpoint, pipePath } from './permissions/endpoint.js';

const VERSION = '0.1.0';
const dataDir = defaultDataDir();
const config = loadConfig(dataDir);

// Endpoint dei permessi su named pipe: nessuna porta, nemmeno locale. Il nome è fisso
// (i turni sopravvissuti a un riavvio lo ritrovano) e fa anche da lucchetto: un solo runner.
const user = userInfo().username.replace(/[^\w.-]/g, '_');
const endpoint = new ApprovalEndpoint(pipePath(`jeko-runner-${user}`));
try {
  await endpoint.start();
} catch (e) {
  const busy = (e as NodeJS.ErrnoException).code === 'EADDRINUSE';
  console.error(busy ? 'Un altro runner di Jeko è già attivo.' : e);
  process.exit(1);
}
// dist/ nel bundle, src/ in sviluppo: lì stanno mcp e hook.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const permissions = createPermissionBridge({ endpoint, scriptsDir });
const claude = [process.env['JEKO_CLAUDE_BIN'] ?? 'claude'];

const client = new RunnerClient({
  url: config.server,
  ...(config.token && { token: config.token }),
  runnerId: process.env['JEKO_RUNNER_ID'] ?? hostname(),
  version: VERSION,
  dataDir,
  pickFolder: systemFolderPicker(),
  assist: claudeAssistant(claude),
  diagnose: () => runDiagnostics({ claude, dataDir, scriptsDir, permissionsEndpoint: true }),
  makeHost: (io, start, { runDir }) =>
    createNodeHost({
      ...io,
      permissions,
      turnsDir: join(runDir, 'turns'),
      ...(start.cwd !== undefined && { cwd: start.cwd }),
    }),
});

client.start();

// All'uscita i turni di claude restano vivi: il prossimo runner li riaggancia.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    client.detach();
    void endpoint.stop().then(() => process.exit(0));
  });
}
