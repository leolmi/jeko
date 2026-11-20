import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ENV, MCP_SERVER_NAME, MCP_TOOL_NAME } from './permissions/protocol.js';
import { requestDecision, type RequestOptions } from './permissions/request.js';

/**
 * Server MCP di Jeko, avviato da claude (stdio) per un turno. Il suo strumento `approve`
 * è il `--permission-prompt-tool`: ogni richiesta di permesso va al runner.
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

  return server;
}

export async function startMcpStdio(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createMcpServer({ pipe: env[ENV.pipe] ?? '', token: env[ENV.token] ?? '' });
  await server.connect(new StdioServerTransport());
}
