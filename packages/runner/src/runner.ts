import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentsSettings } from '@jeko/shared';
import { agentInfos, resolveAgent } from './agents/index.js';
import { RunnerClient } from './client.js';
import { runDiagnostics } from './diagnostics.js';
import { createNodeHost } from './engine/node-host.js';
import { defaultDataDir } from './journal.js';
import type { LinkSocket } from './link.js';
import { ApprovalEndpoint, pipePath } from './permissions/endpoint.js';
import { platform } from './platform/index.js';
import { ProcessRegistry } from './processes.js';

export interface LocalRunner {
  client: RunnerClient;
  /** Esce senza annullare nulla: i turni dell'agente restano vivi e il prossimo avvio li riaggancia. */
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
  // Agente delle impostazioni per assistenza, contesto e verifiche; le run usano il proprio.
  let agentsConfig = '{}';
  let agent = resolveAgent(undefined);
  const processes = new ProcessRegistry(join(dataDir, 'processes'));

  const client = new RunnerClient({
    connect: opts.connect,
    runnerId: process.env['JEKO_RUNNER_ID'] ?? hostname(),
    version: opts.version,
    dataDir,
    pickFolder: platform.folderPicker,
    openTerminal: platform.terminal,
    assist: (prompt) => agent.assist(prompt),
    probeContext: (cwd) =>
      agent.probe
        ? agent.probe(cwd)
        : Promise.reject(new Error(`${agent.label} non elenca cosa carica`)),
    diagnose: () => runDiagnostics({ agent, dataDir, scriptsDir, permissionsEndpoint: true }),
    agents: agentInfos(),
    configureAgents: (agents: AgentsSettings) => {
      const next = JSON.stringify(agents);
      if (next === agentsConfig) return false;
      agentsConfig = next;
      agent = resolveAgent(agents);
      return true;
    },
    makeHost: (io, start, { runDir }) => {
      const runAgent = resolveAgent(start.settings?.agents);
      const permissions = runAgent.permissions?.({ endpoint, scriptsDir });
      return createNodeHost({
        ...io,
        agent: runAgent,
        ...(permissions && { permissions }),
        startProcess: (p) => processes.start(start.runId, p),
        turnsDir: join(runDir, 'turns'),
        ...(start.cwd !== undefined && { cwd: start.cwd }),
        ...(start.exclude && { exclude: start.exclude }),
      });
    },
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
