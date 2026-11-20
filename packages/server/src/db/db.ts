import { homedir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/** Interfaccia minima comune a pg.Pool e PGlite. */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return {
    query: async <R>(sql: string, params?: unknown[]) => {
      const res = await pool.query(sql, params);
      return { rows: res.rows as R[] };
    },
    close: () => pool.end(),
  };
}

/**
 * Postgres incorporato (PGlite): i dati stanno in `dataDir`, o in memoria senza cartella.
 * Un solo processo alla volta può aprire la cartella: per Jeko è il server.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pg = await PGlite.create(dataDir);
  return {
    query: async <R>(sql: string, params?: unknown[]) => ({
      rows: (await pg.query<R>(sql, params)).rows,
    }),
    close: () => pg.close(),
  };
}

/** Cartella del database incorporato: `JEKO_DB_DIR` o `%LOCALAPPDATA%\jeko\db`. */
export function defaultDbDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['JEKO_DB_DIR']) return env['JEKO_DB_DIR'];
  const base = env['LOCALAPPDATA'] ?? join(homedir(), '.local', 'share');
  return join(base, 'jeko', 'db');
}

/** Con `DATABASE_URL` un Postgres vero, altrimenti quello incorporato su disco. */
export function openDb(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  const url = env['DATABASE_URL'];
  return url ? Promise.resolve(createPgDb(url)) : createPgliteDb(defaultDbDir(env));
}
