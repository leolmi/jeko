import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ENV, MCP_SERVER_NAME, MCP_TOOL_NAME, PROCESS_TOOL_NAME } from './permissions/protocol.js';
import { requestDecision, requestProcess, type RequestOptions } from './permissions/request.js';

const PROCESS_DESCRIPTION =
  'Avvia un processo che deve restare attivo dopo la fine del turno (server di sviluppo, ' +
  'watcher e simili). Lo avvia Jeko, staccato da questa sessione, con uscita su un file di ' +
  'log; Jeko lo chiude quando il task viene chiuso. Il comando passa alla shell di sistema ' +
  '(cmd.exe su Windows, sh altrove). Restituisce PID, file di log, se è ancora attivo dopo ' +
  'qualche secondo e le ultime righe del log. Usalo al posto di run_in_background, ' +
  'Start-Process, nohup e simili.';

/**
 * Server MCP di Jeko, avviato da claude (stdio) per un turno. Il suo strumento `approve`
 * è il `--permission-prompt-tool`: ogni richiesta di permesso va al runner. `start_process`
 * fa avviare al runner i processi che devono sopravvivere al turno.
 */
export function createMcpServer(approval: RequestOptions): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' });

  server.registerTool(
    MCP_TOOL_NAME,
    {
      description: 'Decide le richieste di permesso di Claude Code tramite Jeko.',
      inputSchema: {
        tool_name: z.string(),
        input: z.record(z.string(), z.unknown()),
        tool_use_id: z.string().optional(),
      },
    },
    async ({ tool_name, input }) => {
      const decision = await requestDecision(approval, tool_name, input);
      return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
    },
  );

  server.registerTool(
    PROCESS_TOOL_NAME,
    {
      description: PROCESS_DESCRIPTION,
      inputSchema: {
        command: z.string().min(1).describe('Riga di comando da eseguire'),
        cwd: z.string().optional().describe('Cartella di lavoro (predefinita: quella del task)'),
      },
    },
    async ({ command, cwd }) => {
      try {
        const p = await requestProcess(approval, { command, ...(cwd !== undefined && { cwd }) });
        const state = p.running
          ? 'attivo'
          : `uscito subito (codice ${p.exitCode ?? 'sconosciuto'})`;
        const text =
          `PID ${p.pid}, ${state}\nLog: ${p.log}` +
          (p.output ? `\nUltime righe del log:\n${p.output}` : '\nLog ancora vuoto.');
        return { content: [{ type: 'text', text }], isError: !p.running };
      } catch (e) {
        const text = `Avvio non riuscito: ${e instanceof Error ? e.message : String(e)}`;
        return { content: [{ type: 'text', text }], isError: true };
      }
    },
  );

  return server;
}

export async function startMcpStdio(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createMcpServer({ pipe: env[ENV.pipe] ?? '', token: env[ENV.token] ?? '' });
  await server.connect(new StdioServerTransport());
}
