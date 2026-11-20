import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { RunSummary, StartRun } from '@jeko/shared';
import { tap, type Observable } from 'rxjs';
import { Realtime } from './realtime';

/** Elenco delle run, tenuto aggiornato dagli eventi del server. */
@Injectable({ providedIn: 'root' })
export class Runs {
  private readonly http = inject(HttpClient);
  readonly list = signal<RunSummary[]>([]);
  readonly loaded = signal(false);

  constructor() {
    const rt = inject(Realtime);
    this.reload();
    rt.onReconnect(() => this.reload());
    rt.on((msg) => {
      if (msg.type !== 'run.status') return;
      const known = this.list().some((r) => r.id === msg.runId);
      if (!known) return this.reload();
      this.list.update((runs) =>
        runs.map((r) =>
          r.id === msg.runId
            ? { ...r, status: msg.status, error: msg.error, updatedAt: new Date().toISOString() }
            : r,
        ),
      );
    });
  }

  reload(): void {
    this.http.get<RunSummary[]>('/api/runs').subscribe({
      next: (runs) => {
        this.list.set(runs);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  start(body: StartRun): Observable<RunSummary> {
    return this.http
      .post<RunSummary>('/api/runs', body)
      .pipe(
        tap((run) => this.list.update((runs) => [run, ...runs.filter((r) => r.id !== run.id)])),
      );
  }
}
