import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Check } from '@jeko/shared';
import { run } from './spawn.js';

export interface DiagnosticsOptions {
  /** Comando di claude (come per i turni). */
  claude: string[];
  dataDir: string;
  /** Cartella con gli script `mcp` e `hook` dei permessi. */
  scriptsDir: string;
  /** L'endpoint dei permessi su named pipe è in ascolto. */
  permissionsEndpoint: boolean;
  env?: NodeJS.ProcessEnv;
}

const TIMEOUT = 15_000;

async function version(argv: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  const res = await run(argv, { env, timeout: TIMEOUT, windowsHide: true });
  if (res.code !== 0) return null;
  return res.stdout.trim().split(/\r?\n/)[0] || null;
}

function scriptPresent(dir: string, name: string): boolean {
  return existsSync(join(dir, `${name}.js`)) || existsSync(join(dir, `${name}-main.ts`));
}

/**
 * Verifiche dell'ambiente del runner, per il primo avvio e su richiesta. Gli id sono stabili:
 * l'admin li usa per titolo, spiegazione e rimedio.
 */
export async function runDiagnostics(opts: DiagnosticsOptions): Promise<Check[]> {
  const env = opts.env ?? process.env;
  const checks: Check[] = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    ok: major >= 22,
    severity: 'error',
    detail: `v${process.versions.node}`,
  });

  const [git, claude] = await Promise.all([
    version(['git', '--version'], env),
    version([...opts.claude, '--version'], env),
  ]);
  checks.push({ id: 'git', ok: git !== null, severity: 'error', ...(git && { detail: git }) });
  checks.push({
    id: 'claude',
    ok: claude !== null,
    severity: 'error',
    detail: claude ?? opts.claude.join(' '),
  });

  // Accesso di claude: chiave o token nell'ambiente, oppure le credenziali salvate dal login.
  const configDir = env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  const byEnv = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].find((k) => env[k]);
  const byFile = existsSync(join(configDir, '.credentials.json'));
  checks.push({
    id: 'claude.auth',
    ok: Boolean(byEnv) || byFile,
    severity: 'warn',
    ...(byEnv ? { detail: byEnv } : byFile ? { detail: configDir } : {}),
  });

  let writable = true;
  try {
    mkdirSync(opts.dataDir, { recursive: true });
    accessSync(opts.dataDir, constants.W_OK);
  } catch {
    writable = false;
  }
  checks.push({ id: 'dataDir', ok: writable, severity: 'error', detail: opts.dataDir });

  checks.push({ id: 'permissions.endpoint', ok: opts.permissionsEndpoint, severity: 'error' });
  const scripts = scriptPresent(opts.scriptsDir, 'mcp') && scriptPresent(opts.scriptsDir, 'hook');
  checks.push({
    id: 'permissions.scripts',
    ok: scripts,
    severity: 'error',
    detail: opts.scriptsDir,
  });

  return checks;
}
