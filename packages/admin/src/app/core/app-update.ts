import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { AppInfo, UpdateInfo } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';

/** Versione dell'app e aggiornamenti dalle release GitHub (solo nell'app desktop). */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  private readonly http = inject(HttpClient);
  readonly info = signal<AppInfo | null>(null);
  readonly checking = signal(false);
  readonly installing = signal(false);
  /** Messaggio dell'ultimo errore di installazione. */
  readonly error = signal<string | null>(null);

  async load(): Promise<AppInfo | null> {
    try {
      const info = await firstValueFrom(this.http.get<AppInfo>('/api/app'));
      this.info.set(info);
      return info;
    } catch {
      return null;
    }
  }

  async check(): Promise<void> {
    this.checking.set(true);
    try {
      const update = await firstValueFrom(this.http.post<UpdateInfo>('/api/app/update/check', {}));
      this.info.update((i) => i && { ...i, update });
      await this.load();
    } catch {
      /* il risultato (con l'errore) è in info.update */
    } finally {
      this.checking.set(false);
    }
  }

  /** Scarica e installa; poi l'app si chiude e si riapre da sola. */
  async install(): Promise<void> {
    this.installing.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post('/api/app/update/install', {}));
    } catch (e) {
      const message = e instanceof HttpErrorResponse ? (e.error?.message as string) : undefined;
      this.error.set(message ?? String(e));
      this.installing.set(false);
    }
  }
}
