import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPgliteDb, defaultDbDir, openDb } from './db.js';
import { migrate } from './migrate.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('database incorporato', () => {
  it('conserva i dati su disco tra una apertura e la successiva', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-db-'));
    dirs.push(dir);

    const first = await openDb({ JEKO_DB_DIR: dir });
    await migrate(first);
    await first.query(`INSERT INTO settings (key, value) VALUES ('k', '"v"'::jsonb)`);
    await first.close();

    const again = await createPgliteDb(dir);
    await migrate(again); // già fatte: non rifà nulla
    const { rows } = await again.query<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'k'`,
    );
    expect(rows).toEqual([{ value: 'v' }]);
    await again.close();
  });

  it('sceglie la cartella da JEKO_DB_DIR o da LOCALAPPDATA', () => {
    expect(defaultDbDir({ JEKO_DB_DIR: 'x' })).toBe('x');
    expect(defaultDbDir({ LOCALAPPDATA: 'L' })).toBe(join('L', 'jeko', 'db'));
  });
});
