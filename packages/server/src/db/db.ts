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
