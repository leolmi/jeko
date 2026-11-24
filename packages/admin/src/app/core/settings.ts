import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { UserSettings } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';

/** Opzioni dell'utente, salvate sul server: il runner le riceve con ogni run. */
@Injectable({ providedIn: 'root' })
export class Settings {
  private readonly http = inject(HttpClient);
  /** null finché non sono state lette dal server. */
  readonly value = signal<UserSettings | null>(null);

  async load(): Promise<UserSettings> {
    const s = await firstValueFrom(this.http.get<UserSettings>('/api/settings'));
    this.value.set(s);
    return s;
  }

  async save(s: UserSettings): Promise<void> {
    this.value.set(await firstValueFrom(this.http.put<UserSettings>('/api/settings', s)));
  }
}

/** Il servizio gira sul PC della finestra: il sistema è quello del browser. */
export const isWindows = () => /Windows/.test(navigator.userAgent);

/** Cartella dei progetti col separatore finale (es. `D:\dev\`); null se non è impostata. */
export function projectDirPrefix(
  projectsDir: string | undefined,
  windows = isWindows(),
): string | null {
  const dir = projectsDir?.trim().replace(/[\\/]+$/, '');
  if (!dir) return null;
  const sep = dir.includes('\\') || (!dir.includes('/') && windows) ? '\\' : '/';
  return `${dir}${sep}`;
}

/** Esempio di cartella di un progetto: dentro la cartella dei progetti. */
export function projectDirHint(projectsDir: string | undefined, windows = isWindows()): string {
  return `${projectDirPrefix(projectsDir, windows) ?? (windows ? 'C:\\progetti\\' : '/home/utente/progetti/')}…`;
}

/**
 * Completamento con Tab: la cartella dei progetti, se il campo è vuoto o ne contiene
 * solo l'inizio; null se non c'è niente da completare.
 */
export function completeProjectDir(value: string, projectsDir: string | undefined): string | null {
  const prefix = projectDirPrefix(projectsDir);
  if (!prefix || value.length >= prefix.length) return null;
  return prefix.toLowerCase().startsWith(value.toLowerCase()) ? prefix : null;
}

/** Le opzioni senza cui Jeko non può lavorare sono impostate. */
export const settingsReady = (s: UserSettings | null) => !!s?.projectsDir?.trim();
