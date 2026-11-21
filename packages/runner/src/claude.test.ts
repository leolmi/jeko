import { describe, expect, it } from 'vitest';
import { claudeArgs, parseActivity, parseStream, toolDetail } from './claude.js';

describe('claude', () => {
  it('costruisce gli argomenti del turno', () => {
    expect(
      claudeArgs({
        sessionId: 's1',
        resume: false,
        allowedTools: ['Read', 'Edit'],
        mcpConfig: 'mcp.json',
        settings: 'settings.json',
      }),
    ).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--session-id',
      's1',
      '--allowedTools',
      'Read,Edit',
      '--mcp-config',
      'mcp.json',
      '--settings',
      'settings.json',
    ]);
    expect(claudeArgs({ sessionId: 's1', resume: true })).toContain('--resume');
    const tuned = claudeArgs({ sessionId: 's1', resume: true, effort: 'high', model: 'opus' });
    expect(tuned.join(' ')).toContain('--effort high --model opus');
  });

  it('trova il risultato in uno stream-json, anche con una riga a metà', () => {
    const lines = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"assistant","message":{}}',
      '{"type":"result","result":"fatto","is_error":false,"session_id":"abc"}',
    ];
    expect(parseStream(lines.join('\n'))).toEqual({ ok: true, output: 'fatto', sessionId: 'abc' });
    expect(parseStream(`${lines.slice(0, 2).join('\n')}\n{"type":"res`)).toBeNull();
    expect(parseStream('{"type":"result","result":"no","is_error":true}')).toEqual({
      ok: false,
      output: 'no',
    });
  });

  it('ricava tempi, token e costo dal risultato', () => {
    const line = JSON.stringify({
      type: 'result',
      result: 'fatto',
      is_error: false,
      duration_ms: 4200,
      total_cost_usd: 0.12,
      usage: {
        input_tokens: 7,
        output_tokens: 300,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 1200,
      },
    });
    expect(parseStream(line)?.usage).toEqual({
      durationMs: 4200,
      inputTokens: 7,
      outputTokens: 300,
      cacheReadTokens: 9000,
      cacheWriteTokens: 1200,
      costUsd: 0.12,
      turns: 1,
    });
  });

  it("ricava l'attività dai messaggi assistant", () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '  Leggo i file \n' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
          { type: 'thinking', thinking: 'x' },
        ],
      },
    });
    expect(parseActivity(line)).toEqual([
      { kind: 'text', text: 'Leggo i file' },
      { kind: 'tool', tool: 'Read', text: 'src/a.ts' },
    ]);
    expect(parseActivity('{"type":"user","message":{"content":[]}}')).toEqual([]);
    expect(parseActivity('{"type":"assi')).toEqual([]);
    expect(toolDetail({ command: 'npm test\nnpm run lint' })).toBe('npm test');
    expect(toolDetail({ todos: [] })).toBe('');
  });
});
