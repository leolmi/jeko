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
