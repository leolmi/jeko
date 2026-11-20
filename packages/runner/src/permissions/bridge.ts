import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRequest } from '../engine/engine.js';
import type { TurnPermissions } from '../turn.js';
import type { ApprovalEndpoint } from './endpoint.js';
import type { HookPolicy } from './hook.js';
import { ENV, MCP_SERVER_NAME, PERMISSION_PROMPT_TOOL } from './protocol.js';

/**
 * Comando (argv) per lanciare uno script del runner: il bundle `<name>.js` o, in sviluppo,
 * `<name>-main.ts` con tsx (risolto da qui: claude gira nella cartella del progetto).
 */
export function nodeScript(dir: string, name: string): string[] {
  const js = join(dir, `${name}.js`);
  if (existsSync(js)) return [process.execPath, js];
  return [process.execPath, '--import', import.meta.resolve('tsx'), join(dir, `${name}-main.ts`)];
}

/** Riga di comando per l'hook: claude la passa a una shell, quindi barre in avanti e virgolette. */
function commandLine(argv: string[]): string {
  return argv.map((a) => `"${a.replaceAll('\\', '/')}"`).join(' ');
}

export interface BridgeOptions {
  endpoint: ApprovalEndpoint;
  /** Cartella che contiene `mcp` e `hook` (dist nel bundle, src in sviluppo). */
  scriptsDir: string;
}

/** Prepara i permessi di un turno nella sua cartella; con `token` riaggancia un turno esistente. */
export type PermissionBridge = (req: AgentRequest, dir: string, token?: string) => TurnPermissions;

/**
 * Collega un turno di claude ai permessi di Jeko:
 * - server MCP `jeko` con lo strumento `approve` come `--permission-prompt-tool`;
 * - hook PreToolUse (via `--settings`) che forza la richiesta quando una policy lo vuole.
 */
export function createPermissionBridge(opts: BridgeOptions): PermissionBridge {
  const mcp = nodeScript(opts.scriptsDir, 'mcp');
  const hook = nodeScript(opts.scriptsDir, 'hook');

  return (req, dir, existing) => {
    const { token, dispose } = opts.endpoint.register(
      async (tool, input) => ({ approved: await req.authorize(tool, input) }),
      ...(existing !== undefined ? [existing] : []),
    );
    const mcpConfig = join(dir, 'mcp.json');
    const settings = join(dir, 'settings.json');
    const [command, ...args] = mcp;
    writeFileSync(
      mcpConfig,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: 'stdio',
            command,
            args,
            env: { [ENV.pipe]: opts.endpoint.path, [ENV.token]: token },
          },
        },
      }),
    );
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: '*', hooks: [{ type: 'command', command: commandLine(hook), timeout: 30 }] },
          ],
        },
      }),
    );
    const policy: HookPolicy = req.gates;
    return {
      token,
      input: {
        mcpConfig,
        settings,
        permissionPromptTool: PERMISSION_PROMPT_TOOL,
        env: { [ENV.policy]: JSON.stringify(policy) },
      },
      dispose,
    };
  };
}
