import { describe, expect, it } from 'vitest';
import {
  NON_INTERACTIVE_TOOLS,
  TURN_NOTE,
  claudeArgs,
  parseActivity,
  parseInit,
  parseStream,
  settingsWithPlugins,
  toolDetail,
} from './claude.js';

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
      '--append-system-prompt',
      TURN_NOTE,
      '--disallowedTools',
      NON_INTERACTIVE_TOOLS.join(','),
    ]);
    expect(claudeArgs({ sessionId: 's1', resume: true })).toContain('--resume');
    expect(claudeArgs({ sessionId: 's1', resume: true })).not.toContain('--fork-session');
    expect(claudeArgs({ sessionId: 's1', resume: true, fork: true }).slice(4, 7)).toEqual([
      '--resume',
      's1',
      '--fork-session',
    ]);
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
    // Il modello del turno viene dall'init.
    const withModel = [lines[0]!.replace('}', ',"model":"claude-opus-5-5"}'), lines[2]!];
    expect(parseStream(withModel.join('\n'))).toMatchObject({ model: 'claude-opus-5-5' });
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

describe('esclusioni dal contesto', () => {
  const base = { sessionId: 's', resume: false };

  it('strumenti e server MCP diventano --disallowedTools, le skill --disable-slash-commands', () => {
    const args = claudeArgs({
      ...base,
      exclude: {
        tools: ['WebSearch'],
        mcpServers: ['github', 'claude.ai Gmail'],
        plugins: ['x@y'],
        skills: true,
      },
    });
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe(
      [...NON_INTERACTIVE_TOOLS, 'WebSearch', 'mcp__github', 'mcp__claude_ai_Gmail'].join(','),
    );
  });

  it('senza esclusioni toglie solo gli strumenti che rimandano a dopo il turno', () => {
    const args = claudeArgs({
      ...base,
      exclude: { tools: [], mcpServers: [], plugins: [], skills: false },
    });
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe(NON_INTERACTIVE_TOOLS.join(','));
    expect(args).not.toContain('--disable-slash-commands');
  });

  it('i plugin esclusi si aggiungono alle impostazioni esistenti', () => {
    expect(
      settingsWithPlugins({ hooks: { a: 1 }, enabledPlugins: { 'k@m': true } }, ['p@m']),
    ).toEqual({ hooks: { a: 1 }, enabledPlugins: { 'k@m': true, 'p@m': false } });
  });

  it('legge il messaggio init, senza il server di Jeko né i plugin integrati', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      tools: ['Bash', 'WebSearch', 'mcp__github__issue'],
      mcp_servers: [
        { name: 'github', status: 'connected' },
        { name: 'jeko', status: 'connected' },
      ],
      plugins: [
        { name: 'armadillo', source: 'armadillo@market' },
        { name: 'tel', source: 'cc-plugin-telemetry@builtin' },
      ],
      skills: ['dataviz'],
    });
    expect(parseInit(line, 'jeko')).toEqual({
      tools: ['Bash', 'WebSearch'],
      mcpServers: [{ name: 'github', status: 'connected' }],
      plugins: [{ name: 'armadillo', source: 'armadillo@market' }],
      skills: ['dataviz'],
    });
    expect(parseInit('{"type":"assistant"}', 'jeko')).toBeNull();
  });
});
