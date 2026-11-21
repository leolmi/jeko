import { folderKey, type ClaudeModels } from '@jeko/shared';
import type { SettingsFile } from '../data/files.js';

const KEY = 'claude.models';

/**
 * Modello predefinito di claude visto nei turni senza modello scelto, per cartella: claude
 * non lo dice prima di partire e può cambiare da un progetto all'altro (`.claude/settings`).
 */
export class ClaudeModelStore {
  constructor(private readonly settings: SettingsFile) {}

  get(): ClaudeModels {
    const saved = this.settings.get<Partial<ClaudeModels>>(KEY);
    const byFolder = Object.fromEntries(
      Object.entries(saved?.byFolder ?? {}).filter(([, m]) => typeof m === 'string'),
    );
    return { byFolder, last: typeof saved?.last === 'string' ? saved.last : null };
  }

  /** Registra il modello della cartella; true se è cambiato qualcosa. */
  record(cwd: string | null, model: string): boolean {
    const current = this.get();
    const key = folderKey(cwd);
    if (current.last === model && (!key || current.byFolder[key] === model)) return false;
    this.settings.set(KEY, {
      byFolder: key ? { ...current.byFolder, [key]: model } : current.byFolder,
      last: model,
    });
    return true;
  }
}
