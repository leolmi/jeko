import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SettingsFile } from '../data/files.js';
import { WorkflowStore } from './store.js';

const builtinDir = fileURLToPath(new URL('../../../shared/workflows/', import.meta.url));
const builtin = readdirSync(builtinDir).map((f) => readFileSync(join(builtinDir, f), 'utf8'));

async function store(dir = mkdtempSync(join(tmpdir(), 'jeko-wf-'))): Promise<WorkflowStore> {
  return new WorkflowStore(dir, new SettingsFile(dir));
}

describe('workflow di serie', () => {
  it('sono validi e si caricano una volta sola', async () => {
    const s = await store();
    expect(await s.seed(builtin)).toHaveLength(builtin.length);
    expect(await s.seed(builtin)).toEqual([]);
    expect(new Set((await s.list()).map((w) => w.kind))).toEqual(new Set(['develop']));
  });

  it('eliminati, non tornano al riavvio', async () => {
    const s = await store();
    await s.seed(builtin);
    expect(await s.remove('sviluppo')).toBe(true);
    expect(await s.seed(builtin)).toEqual([]);
    expect((await s.list()).map((w) => w.name)).not.toContain('sviluppo');
  });

  it('non toccano le versioni salvate dall’utente', async () => {
    const s = await store();
    const mine = builtin.find((y) => y.startsWith('name: sviluppo\n'))!.replace('Sviluppa', 'Mio');
    await s.save(mine);
    await s.seed(builtin);
    const versions = await s.versions('sviluppo');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.description).toContain('Mio');
  });
});
