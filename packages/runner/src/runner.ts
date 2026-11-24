import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeAssistant } from './assist.js';
import { claudeContextProbe } from './context-probe.js';
import { RunnerClient } from './client.js';
import { runDiagnostics } from './diagnostics.js';
import { createNodeHost } from './engine/node-host.js';
import { defaultDataDir } from './journal.js';
import type { LinkSocket } from './link.js';
import { createPermissionBridge } from './permissions/bridge.js';
import { ApprovalEndpoint, pipePath } from './permissions/endpoint.js';
import { platform } from './platform/index.js';
import { ProcessRegistry } from './processes.js';

export interface LocalRunner {
  client: RunnerClient;
  /** Esce senza annullare nulla: i turni di claude restano vivi e il prossimo avvio li riaggancia. */
  detach(): Promise<void>;
}

/**
 * Avvia il runner nel processo del server: lancia claude, risponde alle richieste del server
 * e gli manda eventi e domande attraverso `connect`.
 */
export async function startRunner(opts: {
  connect: () => LinkSocket;
  version: string;
  /** Cartella con gli script `mcp` e `hook` (il bundle `jeko.js`, o `src/` in sviluppo). */
  scriptsDir?: string;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}): Promise<LocalRunner> {
  const dataDir = defaultDataDir();

  // Endpoint dei permessi su named pipe: nessuna porta, nemmeno locale. Il nome è fisso
  // (i turni sopravvissuti a un riavvio lo ritrovano) e fa anche da lucchetto: un solo runner.
  const user = userInfo().username.replace(/[^\w.-]/g, '_');
  const endpoint = new ApprovalEndpoint(pipePath(`jeko-runner-${user}`));
  try {
    await endpoint.start();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw new Error('Un altro runner di Jeko è già attivo.', { cause: e });
    throw e;
  }
  const scriptsDir = opts.scriptsDir ?? dirname(fileURLToPath(import.meta.url));
  const permissions = createPermissionBridge({ endpoint, scriptsDir });
  const claude = [process.env['JEKO_CLAUDE_BIN'] ?? 'claude'];
  const processes = new ProcessRegistry(join(dataDir, 'processes'));

  const client = new RunnerClient({
    connect: opts.connect,
    runnerId: process.env['JEKO_RUNNER_ID'] ?? hostname(),
    version: opts.version,
    dataDir,
    pickFolder: platform.folderPicker,
    openTerminal: platform.terminal,
    assist: claudeAssistant(claude),
    probeContext: claudeContextProbe(claude),
    diagnose: () => runDiagnostics({ claude, dataDir, scriptsDir, permissionsEndpoint: true }),
    makeHost: (io, start, { runDir }) =>
      createNodeHost({
        ...io,
        permissions,
        startProcess: (p) => processes.start(start.runId, p),
        turnsDir: join(runDir, 'turns'),
        ...(start.cwd !== undefined && { cwd: start.cwd }),
        ...(start.exclude && { exclude: start.exclude }),
      }),
    onRunFinished: (runId) => processes.stopRun(runId),
    processes: (runId, stop) => (stop ? processes.stop(runId) : processes.status(runId)),
    ...(opts.log && { log: opts.log }),
  });
  client.start();

  return {
    client,
    detach: async () => {
      client.detach();
      await endpoint.stop();
    },
  };
}
