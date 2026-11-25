import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EFFORTS, MODEL_ALIASES, type Check, type ContextExclusions } from '@jeko/shared';
import { createPermissionBridge } from '../../permissions/bridge.js';
import { run } from '../../spawn.js';
import type { AgentDriver } from '../driver.js';
import { claudeAssistant } from './assist.js';
import {
  claudeArgs,
  claudeToolCall,
  parseActivity,
  parseStream,
  settingsWithPlugins,
} from './cli.js';
import { claudeContextProbe } from './context-probe.js';

const TIMEOUT = 15_000;

/** Comando di claude: `JEKO_CLAUDE_BIN` o `claude`. */
export const claudeCommand = (env: NodeJS.ProcessEnv = process.env) => [
  env['JEKO_CLAUDE_BIN'] ?? 'claude',
];

/** File di impostazioni del turno con i plugin esclusi; senza esclusioni quello dei permessi. */
function excludePlugins(
  dir: string,
  settings: string | undefined,
  exclude: ContextExclusions | undefined,
): string | undefined {
  const plugins = exclude?.plugins ?? [];
  if (!plugins.length) return settings;
  const base = settings
    ? (JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>)
    : {};
  const file = join(dir, 'settings.exclude.json');
  writeFileSync(file, JSON.stringify(settingsWithPlugins(base, plugins)));
  return file;
}

/** Versione e accesso di claude: chiave o token nell'ambiente, o le credenziali del login. */
async function claudeChecks(command: string[], env: NodeJS.ProcessEnv): Promise<Check[]> {
  const res = await run([...command, '--version'], { env, timeout: TIMEOUT, windowsHide: true });
  const version = res.code === 0 ? res.stdout.trim().split(/\r?\n/)[0] || null : null;
  const configDir = env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
  const byEnv = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'].find((k) => env[k]);
  const byFile = existsSync(join(configDir, '.credentials.json'));
  return [
    { id: 'claude', ok: version !== null, severity: 'error', detail: version ?? command.join(' ') },
    {
      id: 'claude.auth',
      ok: Boolean(byEnv) || byFile,
      severity: 'warn',
      ...(byEnv ? { detail: byEnv } : byFile ? { detail: configDir } : {}),
    },
  ];
}

/** Driver di Claude Code (CLI `claude`). */
export function claudeDriver(command: string[] = claudeCommand()): AgentDriver {
  return {
    id: 'claude',
    label: 'Claude Code',
    command,
    caps: {
      resume: true,
      fork: true,
      ownSessionId: true,
      efforts: EFFORTS,
      models: MODEL_ALIASES,
      gate: 'per-tool',
      questions: true,
      context: true,
      usage: true,
      cost: true,
    },
    turn: (t) => {
      const perms = t.permissions;
      // Claude riceve sempre da Jeko l'id della sessione (`ownSessionId`).
      if (t.sessionId === undefined) throw new Error('Sessione di claude mancante');
      return {
        args: claudeArgs({
          sessionId: t.sessionId,
          resume: t.resume,
          fork: t.fork,
          allowedTools: t.allowedTools,
          effort: t.effort,
          model: t.model,
          mcpConfig: perms?.mcpConfig,
          permissionPromptTool: perms?.permissionPromptTool,
          settings: excludePlugins(t.dir, perms?.settings, t.exclude),
          exclude: t.exclude,
        }),
        ...(perms?.env && { env: perms.env }),
      };
    },
    parseStream,
    parseActivity,
    toolCall: claudeToolCall,
    permissions: createPermissionBridge,
    assist: claudeAssistant(command),
    probe: claudeContextProbe(command),
    checks: (env) => claudeChecks(command, env),
  };
}
