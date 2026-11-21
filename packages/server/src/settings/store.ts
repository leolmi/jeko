import { UserSettingsSchema, type UserSettings } from '@jeko/shared';
import { Kind, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { SettingsFile } from '../data/files.js';

const KEY = 'user.settings';

/**
 * Tiene di `value` solo ciò che `schema` accetta: un campo sconosciuto o non valido (es.
 * scritto da una versione più nuova che usa gli stessi dati) si toglie, il resto resta.
 */
export function prune(schema: TSchema, value: unknown): unknown {
  if (Value.Check(schema, value)) return value;
  if (schema[Kind] !== 'Object' || typeof value !== 'object' || value === null) return undefined;
  const props = schema['properties'] as Record<string, TSchema>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const sub = props[k];
    const kept = sub && prune(sub, v);
    if (kept !== undefined) out[k] = kept;
  }
  return Value.Check(schema, out) ? out : undefined;
}

/** Opzioni dell'utente: un solo oggetto in `settings.json`. */
export class UserSettingsStore {
  constructor(private readonly settings: SettingsFile) {}

  async get(): Promise<UserSettings> {
    const saved = this.settings.get<unknown>(KEY);
    return (prune(UserSettingsSchema, saved ?? {}) as UserSettings | undefined) ?? {};
  }

  /** Sostituisce le opzioni con quelle date (la web-app manda sempre l'oggetto intero). */
  async set(settings: UserSettings): Promise<UserSettings> {
    this.settings.set(KEY, settings);
    return settings;
  }
}
