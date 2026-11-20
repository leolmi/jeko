import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/db.js';
import { migrate } from '../db/migrate.js';
import { parseTemplateFile, TemplateStore } from './templates.js';

const builtinDir = fileURLToPath(new URL('../../../shared/templates/', import.meta.url));
const builtin = readdirSync(builtinDir).map((f) =>
  parseTemplateFile(readFileSync(join(builtinDir, f), 'utf8')),
);

async function store(): Promise<TemplateStore> {
  const pg = new PGlite();
  const db: Db = {
    query: async <R>(sql: string, params?: unknown[]) => ({
      rows: (await pg.query<R>(sql, params)).rows,
    }),
    close: () => pg.close(),
  };
  await migrate(db);
  return new TemplateStore(db);
}

describe('template di serie', () => {
  it('il file ha il nome sulla prima riga e poi il prompt', () => {
    expect(parseTemplateFile('# Mio template\r\n\r\nFai così.\n')).toEqual({
      name: 'Mio template',
      prompt: 'Fai così.',
    });
    expect(() => parseTemplateFile('Senza titolo\n\nprompt')).toThrow();
  });

  it('sono validi e si caricano una volta sola', async () => {
    const s = await store();
    expect(await s.seed(builtin)).toHaveLength(builtin.length);
    expect(await s.seed(builtin)).toEqual([]);
    expect(await s.list()).toHaveLength(builtin.length);
  });

  it('eliminati, non tornano al riavvio', async () => {
    const s = await store();
    await s.seed(builtin);
    const name = builtin[0]!.name;
    expect(await s.remove(name)).toBe(true);
    expect(await s.seed(builtin)).toEqual([]);
    expect(await s.get(name)).toBeNull();
  });

  it('non toccano quelli salvati dall’utente', async () => {
    const s = await store();
    const name = builtin[0]!.name;
    await s.save(name, 'Mio prompt');
    await s.seed(builtin);
    expect((await s.get(name))!.prompt).toBe('Mio prompt');
  });
});
