import type { UserSettings } from '@jeko/shared';
import type { SettingsFile } from '../data/files.js';

const KEY = 'user.settings';

/** Opzioni dell'utente: un solo oggetto in `settings.json`. */
export class UserSettingsStore {
  constructor(private readonly settings: SettingsFile) {}

  async get(): Promise<UserSettings> {
    return this.settings.get<UserSettings>(KEY) ?? {};
  }

  /** Sostituisce le opzioni con quelle date (la web-app manda sempre l'oggetto intero). */
  async set(settings: UserSettings): Promise<UserSettings> {
    this.settings.set(KEY, settings);
    return settings;
  }
}
