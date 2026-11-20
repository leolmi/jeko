import type { UserSettings } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { json } from '../db/sql.js';

const KEY = 'user.settings';

/** Opzioni dell'utente: un solo oggetto nella tabella `settings`. */
export class UserSettingsStore {
  constructor(private readonly db: Db) {}

  async get(): Promise<UserSettings> {
    const { rows } = await this.db.query<{ value: UserSettings }>(
      `SELECT value FROM settings WHERE key = $1`,
      [KEY],
    );
    return rows[0]?.value ?? {};
  }

  /** Sostituisce le opzioni con quelle date (la web-app manda sempre l'oggetto intero). */
  async set(settings: UserSettings): Promise<UserSettings> {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, json(settings)],
    );
    return settings;
  }
}
