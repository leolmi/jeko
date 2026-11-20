import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunnerConfig {
  /** WebSocket del server. */
  server: string;
  /** Token del runner; assente finché sul server non se n'è creato uno. */
  token?: string;
}

const DEFAULT_SERVER = 'ws://127.0.0.1:4310/ws/runner';

/**
 * Configurazione del runner: `config.json` nella cartella dei dati (la scrive l'installer),
 * con le variabili `JEKO_SERVER_WS` e `JEKO_RUNNER_TOKEN` che hanno la precedenza.
 */
export function loadConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  let file: Partial<RunnerConfig> = {};
  try {
    file = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')) as Partial<RunnerConfig>;
  } catch {
    // nessun file (sviluppo) o illeggibile: valgono ambiente e predefiniti
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const token = str(env['JEKO_RUNNER_TOKEN']) ?? str(file.token);
  return {
    server: str(env['JEKO_SERVER_WS']) ?? str(file.server) ?? DEFAULT_SERVER,
    ...(token && { token }),
  };
}
