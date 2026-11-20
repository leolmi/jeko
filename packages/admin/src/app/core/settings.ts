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

/** Le opzioni senza cui Jeko non può lavorare sono impostate. */
export const settingsReady = (s: UserSettings | null) => !!s?.projectsDir?.trim();
