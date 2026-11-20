import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDiagnostics } from './diagnostics.js';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'jeko-diag-'));

describe('runDiagnostics', () => {
  it('riconosce claude e gli script dei permessi', async () => {
    const checks = await runDiagnostics({
      claude: [process.execPath, '-e', 'console.log("2.1.0 (Claude Code)")', '--'],
      dataDir,
      scriptsDir,
      permissionsEndpoint: true,
      env: { ...process.env, ANTHROPIC_API_KEY: 'x' },
    });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId['node']?.ok).toBe(true);
    expect(byId['claude']).toMatchObject({ ok: true, detail: '2.1.0 (Claude Code)' });
    expect(byId['claude.auth']).toMatchObject({ ok: true, detail: 'ANTHROPIC_API_KEY' });
    expect(byId['dataDir']?.ok).toBe(true);
    expect(byId['permissions.scripts']?.ok).toBe(true);
  });

  it('segnala claude mancante', async () => {
    const checks = await runDiagnostics({
      claude: ['jeko-claude-che-non-esiste'],
      dataDir,
      scriptsDir: dataDir,
      permissionsEndpoint: false,
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining(['claude', 'permissions.endpoint', 'permissions.scripts']),
    );
  });
});
