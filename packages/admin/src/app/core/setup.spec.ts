import { blocking, serverChecks } from './setup';

describe('verifiche del primo avvio', () => {
  it('un avviso non blocca, un errore sì', () => {
    expect(blocking([{ id: 'a', ok: false, severity: 'warn' }])).toBe(false);
    expect(blocking([{ id: 'a', ok: false, severity: 'error' }])).toBe(true);
  });

  it('senza workflow il server dà solo un avviso', () => {
    const checks = serverChecks({
      completed: false,
      server: { version: '0.1.0', database: true, workflows: 0 },
      runner: { connected: false, checks: null, token: false },
    });
    expect(blocking(checks)).toBe(false);
    expect(checks.find((c) => c.id === 'server.workflows')?.ok).toBe(false);
  });
});
