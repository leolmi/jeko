import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.js';

const KEY = 'runner.token';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Token con cui il runner si presenta al server. Nel DB c'è solo l'hash: il token in chiaro
 * si vede una volta, dentro l'installer. Uno nuovo sostituisce il precedente.
 */
export class RunnerTokens {
  constructor(private readonly db: Db) {}

  async configured(): Promise<boolean> {
    return (await this.stored()) !== null;
  }

  /** Crea un token nuovo (quello vecchio smette di valere) e lo restituisce in chiaro. */
  async rotate(): Promise<string> {
    const token = `jk_${randomBytes(32).toString('base64url')}`;
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, hash(token)],
    );
    return token;
  }

  /**
   * true se il token è quello giusto. Finché non se n'è creato nessuno (primo avvio, sviluppo)
   * vale anche l'assenza di token.
   */
  async verify(token: string | undefined): Promise<boolean> {
    const stored = await this.stored();
    if (stored === null) return true;
    if (!token) return false;
    return timingSafeEqual(Buffer.from(hash(token)), Buffer.from(stored));
  }

  private async stored(): Promise<string | null> {
    const { rows } = await this.db.query<{ value: unknown }>(
      `SELECT value FROM settings WHERE key = $1`,
      [KEY],
    );
    const v = rows[0]?.value;
    return typeof v === 'string' ? v : null;
  }
}

/** Token da un header `Authorization: Bearer …`. */
export function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() || undefined : undefined;
}
