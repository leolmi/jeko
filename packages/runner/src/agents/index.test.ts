import { describe, expect, it } from 'vitest';
import { agentInfos, resolveAgent, runAgent } from './index.js';

describe('agenti', () => {
  it('elenca gli agenti col comando predefinito', () => {
    expect(agentInfos({})).toEqual([{ id: 'claude', label: 'Claude Code', command: 'claude' }]);
    expect(agentInfos({ JEKO_CLAUDE_BIN: 'C:\\bin\\claude.exe' })[0]?.command).toBe(
      'C:\\bin\\claude.exe',
    );
  });

  it("usa l'agente e il comando delle impostazioni", () => {
    expect(resolveAgent(undefined, {}).command).toEqual(['claude']);
    const custom = resolveAgent(
      { default: 'claude', commands: { claude: ' D:\\tools\\claude.exe ' } },
      {},
    );
    expect(custom.id).toBe('claude');
    expect(custom.command).toEqual(['D:\\tools\\claude.exe']);
  });

  it('un agente sconosciuto ricade sul predefinito', () => {
    expect(resolveAgent({ default: 'altro' }, {}).id).toBe('claude');
  });

  it("l'agente di una run non ricade su un altro", () => {
    const custom = runAgent('claude', { commands: { claude: 'D:/c.exe' } }, {});
    expect(custom.command).toEqual(['D:/c.exe']);
    expect(() => runAgent('codex', undefined, {})).toThrow(/non è disponibile/);
    expect(runAgent('codex', undefined, { JEKO_AGENTS_PREVIEW: '1' }).id).toBe('codex');
  });
});
