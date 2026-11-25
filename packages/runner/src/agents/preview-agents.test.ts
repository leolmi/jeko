// Uscite di esempio scritte dalla documentazione delle CLI: i driver non sono ancora stati
// provati con le CLI vere (vedi PIANO-AGENTI.md).
import { describe, expect, it } from 'vitest';
import { codexDriver } from './codex.js';
import { cursorDriver } from './cursor.js';
import { geminiDriver } from './gemini.js';
import { agentInfos, resolveAgent } from './index.js';

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const start = { dir: '.', prompt: 'fai', resume: false };

describe('Codex CLI', () => {
  const codex = codexDriver(['codex']);
  const out = jsonl(
    { type: 'thread.started', thread_id: 't-1' },
    { type: 'turn.started' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Fatto.' } },
    {
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
    },
  );

  it('argomenti: nuovo turno, ripresa, copia non supportata', () => {
    expect(codex.turn({ ...start, model: 'gpt-x', effort: 'max' }).args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-x',
      '-c',
      'model_reasoning_effort="xhigh"',
      '-',
    ]);
    expect(codex.turn({ ...start, resume: true, sessionId: 't-1' }).args.slice(-3)).toEqual([
      'resume',
      't-1',
      '-',
    ]);
    expect(codex.turn({ ...start, resume: true, fork: true, sessionId: 't-1' }).args).not.toContain(
      'resume',
    );
  });

  it('risultato, sessione, consumi e attività', () => {
    expect(codex.parseStream(out)).toEqual({
      ok: true,
      output: 'Fatto.',
      sessionId: 't-1',
      usage: expect.objectContaining({ inputTokens: 100, outputTokens: 7, cacheReadTokens: 40 }),
    });
    expect(codex.parseStream(out.split('\n').slice(0, 3).join('\n'))).toBeNull();
    expect(codex.sessionOf?.(out)).toBe('t-1');
    expect(out.split('\n').flatMap((l) => codex.parseActivity(l))).toEqual([
      { kind: 'tool', tool: 'shell', text: 'npm test' },
      { kind: 'text', text: 'Fatto.' },
    ]);
    const failed = jsonl({ type: 'turn.failed', error: { message: 'quota' } });
    expect(codex.parseStream(failed)).toEqual({ ok: false, output: 'quota' });
  });
});

describe('Cursor CLI', () => {
  const cursor = cursorDriver(['cursor-agent']);
  const out = jsonl(
    { type: 'system', subtype: 'init', session_id: 'c-1', model: 'Sonnet' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Leggo' }] } },
    {
      type: 'tool_call',
      subtype: 'started',
      tool_call: { shellToolCall: { args: { command: 'npm test' } } },
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'Ok', session_id: 'c-1' },
  );

  it('argomenti: richiesta in fondo, ripresa', () => {
    expect(cursor.turn(start).args).toEqual(['-p', '--output-format', 'stream-json', 'fai']);
    expect(cursor.turn({ ...start, resume: true, sessionId: 'c-1' }).args).toContain('--resume');
  });

  it('risultato, modello, sessione e attività', () => {
    expect(cursor.parseStream(out)).toEqual({
      ok: true,
      output: 'Ok',
      sessionId: 'c-1',
      model: 'Sonnet',
    });
    expect(cursor.sessionOf?.(out)).toBe('c-1');
    expect(out.split('\n').flatMap((l) => cursor.parseActivity(l))).toEqual([
      { kind: 'text', text: 'Leggo' },
      { kind: 'tool', tool: 'shell', text: 'npm test' },
    ]);
    expect(cursor.toolCall('shell', { command: 'git push' })).toEqual({
      kind: 'shell',
      name: 'shell',
      target: 'git push',
    });
  });
});

describe('Gemini CLI', () => {
  const gemini = geminiDriver(['gemini']);
  const out = jsonl(
    { type: 'init', session_id: 'g-1', model: 'gemini-pro' },
    { type: 'message', role: 'user', content: 'fai' },
    {
      type: 'tool_use',
      tool_name: 'run_shell_command',
      tool_id: 'x',
      parameters: { command: 'ls' },
    },
    { type: 'message', role: 'assistant', content: 'Fat', delta: true },
    { type: 'message', role: 'assistant', content: 'to.', delta: true },
    {
      type: 'result',
      status: 'success',
      stats: { input_tokens: 50, output_tokens: 5, duration_ms: 900 },
    },
  );

  it('argomenti: richiesta da stdin, ripresa', () => {
    expect(gemini.turn({ ...start, model: 'gemini-pro' }).args).toEqual([
      '--output-format',
      'stream-json',
      '--model',
      'gemini-pro',
    ]);
    expect(gemini.turn({ ...start, resume: true, sessionId: 'g-1' }).args).toContain('g-1');
  });

  it('risultato dai pezzi di testo, sessione e attività', () => {
    expect(gemini.parseStream(out)).toEqual({
      ok: true,
      output: 'Fatto.',
      sessionId: 'g-1',
      model: 'gemini-pro',
      usage: expect.objectContaining({ inputTokens: 50, outputTokens: 5, durationMs: 900 }),
    });
    expect(gemini.sessionOf?.(out)).toBe('g-1');
    expect(out.split('\n').flatMap((l) => gemini.parseActivity(l))).toEqual([
      { kind: 'tool', tool: 'run_shell_command', text: 'ls' },
    ]);
    expect(gemini.toolCall('run_shell_command', { command: 'npm i' }).kind).toBe('shell');
  });
});

describe('agenti in anteprima', () => {
  it('compaiono sempre, segnati come anteprima, e si scelgono', () => {
    expect(agentInfos({}).map((a) => [a.id, a.preview ?? false])).toEqual([
      ['claude', false],
      ['codex', true],
      ['cursor', true],
      ['gemini', true],
    ]);
    expect(resolveAgent({ default: 'gemini' }, {}).id).toBe('gemini');
  });
});
