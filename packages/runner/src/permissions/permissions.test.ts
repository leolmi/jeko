import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRequest } from '../engine/engine.js';
import { createMcpServer } from '../mcp.js';
import { answerQuestions, createPermissionBridge, parseQuestions } from './bridge.js';
import { ApprovalEndpoint, pipePath, type Authorizer } from './endpoint.js';
import { hookDecision, runHook } from './hook.js';
import { ENV, PERMISSION_PROMPT_TOOL } from './protocol.js';
import { requestDecision } from './request.js';

const gates = {
  policies: [{ match: 'git.push' as const, gate: 'always' as const }],
  mode: 'headless' as const,
};

describe('endpoint dei permessi (named pipe)', () => {
  let endpoint: ApprovalEndpoint | undefined;
  afterEach(async () => {
    await endpoint?.stop();
    endpoint = undefined;
  });

  const startEndpoint = async (pollMs = 20_000) => {
    endpoint = new ApprovalEndpoint(pipePath(), pollMs);
    await endpoint.start();
    return endpoint;
  };

  it('inoltra la richiesta al turno giusto e restituisce la decisione', async () => {
    const ep = await startEndpoint();
    const seen: string[] = [];
    const authorize: Authorizer = async (tool, input) => {
      seen.push(`${tool} ${String(input['command'])}`);
      return input['command'] === 'git push'
        ? { approved: false, note: 'non ora' }
        : { approved: true };
    };
    const { token } = ep.register(authorize);
    const opts = { pipe: ep.path, token };

    expect(await requestDecision(opts, 'Bash', { command: 'npm test' })).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'npm test' },
    });
    expect(await requestDecision(opts, 'Bash', { command: 'git push' })).toEqual({
      behavior: 'deny',
      message: 'Rifiutato: non ora',
    });
    expect(seen).toEqual(['Bash npm test', 'Bash git push']);
  });

  it("regge un'attesa lunga a tappe senza decidere due volte", async () => {
    const ep = await startEndpoint(30);
    let calls = 0;
    let release!: () => void;
    const { token } = ep.register(async () => {
      calls++;
      await new Promise<void>((r) => (release = r));
      return { approved: true };
    });
    const decision = requestDecision({ pipe: ep.path, token }, 'Bash', { command: 'x' });
    await new Promise((r) => setTimeout(r, 150)); // diverse risposte `pending`
    release();
    expect((await decision).behavior).toBe('allow');
    expect(calls).toBe(1);
  });

  it('rifiuta un token sconosciuto o di un turno chiuso, dopo aver atteso', async () => {
    const ep = await startEndpoint();
    const { token, dispose } = ep.register(async () => ({ approved: true }));
    dispose();
    const opts = { pipe: ep.path, token, giveUpMs: 50, retryMs: 10 };
    expect(await requestDecision(opts, 'Bash', {})).toEqual({
      behavior: 'deny',
      message: 'Jeko non riconosce questo turno',
    });
  });

  it('ritrova un turno registrato di nuovo con lo stesso token (riavvio del runner)', async () => {
    const ep = await startEndpoint();
    const first = ep.register(async () => ({ approved: false }));
    first.dispose();
    const pending = requestDecision({ pipe: ep.path, token: first.token, retryMs: 10 }, 'Bash', {});
    await new Promise((r) => setTimeout(r, 50));
    ep.register(async () => ({ approved: true }), first.token);
    expect((await pending).behavior).toBe('allow');
  });

  it('rifiuta se il runner non è raggiungibile', async () => {
    const res = await requestDecision(
      { pipe: pipePath(), token: 't', giveUpMs: 50, retryMs: 10 },
      'Bash',
      {},
    );
    expect(res).toEqual({ behavior: 'deny', message: 'Runner di Jeko non raggiungibile' });
  });

  it('il server MCP espone approve e risponde nel formato di claude', async () => {
    const ep = await startEndpoint();
    const { token } = ep.register(async () => ({ approved: false }));
    const server = createMcpServer({ pipe: ep.path, token });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['approve']);
    const res = await client.callTool({
      name: 'approve',
      arguments: { tool_name: 'Bash', input: { command: 'git push' } },
    });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text)).toEqual({ behavior: 'deny', message: 'Rifiutato da Jeko' });
    await client.close();
  });

  it('il bridge prepara mcp-config, settings e ambiente del turno', async () => {
    const ep = await startEndpoint();
    const bridge = createPermissionBridge({ endpoint: ep, scriptsDir: 'C:\\jeko\\dist' });
    const req: AgentRequest = {
      stepId: 's',
      instructions: 'x',
      turnKey: 's-0',
      gates,
      authorize: async () => true,
    };
    const turn = bridge(req, mkdtempSync(join(tmpdir(), 'jeko-bridge-')));
    expect(turn.input.permissionPromptTool).toBe(PERMISSION_PROMPT_TOOL);
    expect(JSON.parse(turn.input.env![ENV.policy]!)).toEqual(gates);

    const mcp = JSON.parse(readFileSync(turn.input.mcpConfig!, 'utf8'));
    const env = mcp.mcpServers.jeko.env;
    expect(env[ENV.pipe]).toBe(ep.path);
    expect(
      await requestDecision({ pipe: ep.path, token: env[ENV.token] }, 'Read', {}),
    ).toMatchObject({
      behavior: 'allow',
    });

    const settings = JSON.parse(readFileSync(turn.input.settings!, 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('hook-main.ts');

    turn.dispose();
    expect(
      await requestDecision({ pipe: ep.path, token: env[ENV.token], giveUpMs: 0 }, 'Read', {}),
    ).toMatchObject({
      behavior: 'deny',
    });
  });
});

describe('hook PreToolUse', () => {
  it('forza la richiesta solo per le azioni fermate dalle policy', () => {
    expect(hookDecision({ tool_name: 'Bash', tool_input: { command: 'git push' } }, gates)).toEqual(
      {
        reason: 'git.push: git push',
      },
    );
    expect(
      hookDecision({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, gates),
    ).toBeNull();
    expect(hookDecision({ tool_name: 'Read', tool_input: {} }, gates)).toBeNull();
    expect(hookDecision({ tool_name: 'AskUserQuestion', tool_input: {} }, gates)).not.toBeNull();
    // policy interactive in headless: nessun gate
    expect(
      hookDecision(
        { tool_name: 'Bash', tool_input: { command: 'git push' } },
        { policies: [{ match: 'git.push', gate: 'interactive' }], mode: 'headless' },
      ),
    ).toBeNull();
  });

  it('scrive ask nel formato di claude e chiede anche quando qualcosa va storto', () => {
    const env = { [ENV.policy]: JSON.stringify(gates) };
    const out = JSON.parse(
      runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } }), env),
    );
    expect(out.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
    });
    expect(runHook(JSON.stringify({ tool_name: 'Read' }), env)).toBe('');
    expect(JSON.parse(runHook('{}', {})).hookSpecificOutput.permissionDecision).toBe('ask');
  });
});

describe('AskUserQuestion', () => {
  const input = {
    questions: [
      {
        question: 'Quale database?',
        header: 'DB',
        options: [{ label: 'Postgres', description: 'relazionale' }, { label: 'SQLite' }, {}],
        multiSelect: false,
      },
      {
        question: 'Quali test?',
        options: [{ label: 'unit' }, { label: 'e2e' }],
        multiSelect: true,
      },
      { header: 'senza domanda' },
    ],
  };

  it('legge le domande nel formato di claude', () => {
    expect(parseQuestions(input)).toEqual([
      {
        question: 'Quale database?',
        header: 'DB',
        options: [{ label: 'Postgres', description: 'relazionale' }, { label: 'SQLite' }],
      },
      {
        question: 'Quali test?',
        options: [{ label: 'unit' }, { label: 'e2e' }],
        multiSelect: true,
      },
    ]);
    expect(parseQuestions({})).toEqual([]);
  });

  it("restituisce le risposte nell'input dello strumento", async () => {
    const asked: string[] = [];
    const res = await answerQuestions(input, async (q) => {
      asked.push(q.question);
      return q.multiSelect ? 'unit, e2e' : 'Postgres';
    });
    expect(asked).toEqual(['Quale database?', 'Quali test?']);
    expect(res).toEqual({
      approved: true,
      updatedInput: {
        ...input,
        answers: { 'Quale database?': 'Postgres', 'Quali test?': 'unit, e2e' },
      },
    });
    expect((await answerQuestions(input, async () => null)).approved).toBe(false);
    expect((await answerQuestions({}, async () => 'x')).approved).toBe(false);
  });

  it('il bridge manda le domande alla chat e le risposte a claude', async () => {
    const ep = new ApprovalEndpoint(pipePath());
    await ep.start();
    try {
      const bridge = createPermissionBridge({ endpoint: ep, scriptsDir: 'C:\\jeko\\dist' });
      const req: AgentRequest = {
        stepId: 's',
        instructions: 'x',
        turnKey: 's-0',
        gates,
        authorize: async () => false,
        askUser: async () => 'SQLite',
      };
      const turn = bridge(req, mkdtempSync(join(tmpdir(), 'jeko-ask-')));
      const token = JSON.parse(readFileSync(turn.input.mcpConfig!, 'utf8')).mcpServers.jeko.env[
        ENV.token
      ];
      const one = { questions: [input.questions[0]] };
      expect(await requestDecision({ pipe: ep.path, token }, 'AskUserQuestion', one)).toEqual({
        behavior: 'allow',
        updatedInput: { ...one, answers: { 'Quale database?': 'SQLite' } },
      });
      turn.dispose();
    } finally {
      await ep.stop();
    }
  });
});
