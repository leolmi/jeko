import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RunnerConfig {
  /** WebSocket del server. */
  server: string;
  /** Token del runner; assente finché sul server non se n'è creato uno. */
  token?: string;
  /** Cartella in cui nascono i progetti nuovi (variabile `jeko.projectsDir` dei workflow). */
  projectsDir: string;
}

const DEFAULT_SERVER = 'ws://127.0.0.1:4310/ws/runner';

/**
 * Configurazione del runner: `config.json` nella cartella dei dati (la scrive l'installer),
 * con le variabili `JEKO_SERVER_WS`, `JEKO_RUNNER_TOKEN` e `JEKO_PROJECTS_DIR` che hanno la precedenza.
 */
export function loadConfig(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): RunnerConfig {
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
    projectsDir: str(env['JEKO_PROJECTS_DIR']) ?? str(file.projectsDir) ?? join(home, 'projects'),
    ...(token && { token }),
  };
}
