import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { Answer, CreateProjectRun, RunSummary, StartRun } from '@jeko/shared';
import { firstValueFrom, tap, type Observable } from 'rxjs';
import { Realtime } from './realtime';

/** Elenco delle run, tenuto aggiornato dagli eventi del server. */
@Injectable({ providedIn: 'root' })
export class Runs {
  private readonly http = inject(HttpClient);
  readonly list = signal<RunSummary[]>([]);
  readonly loaded = signal(false);
  /**
   * Task diretto aperto nella pagina, in attesa del messaggio seguente: il composer lo manda lì
   * invece di avviare un task nuovo.
   */
  readonly followUp = signal<{ runId: string; promptId: string; cwd: string | null } | null>(null);

  constructor() {
    const rt = inject(Realtime);
    this.reload();
    rt.onReconnect(() => this.reload());
    rt.on((msg) => {
      if (msg.type === 'runs.removed') return this.drop(msg.ids);
      if (msg.type === 'run.path') {
        const { runId, path } = msg;
        return this.list.update((runs) => runs.map((r) => (r.id === runId ? { ...r, path } : r)));
      }
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

  /** Messaggio seguente di un task diretto; null lo chiude. */
  continue(runId: string, promptId: string, value: string | null): Observable<unknown> {
    const answer: Answer = { kind: 'ask', value };
    return this.http.post(`/api/runs/${runId}/prompts/${promptId}`, answer);
  }

  /** Elimina i task conclusi fra quelli dati; il server ignora quelli ancora aperti. */
  async remove(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { removed } = await firstValueFrom(
      this.http.post<{ removed: string[] }>('/api/runs/remove', { ids }),
    );
    this.drop(removed);
  }

  private drop(ids: string[]): void {
    const gone = new Set(ids);
    this.list.update((runs) => runs.filter((r) => !gone.has(r.id)));
  }

  start(body: StartRun): Observable<RunSummary> {
    return this.add(this.http.post<RunSummary>('/api/runs', body));
  }

  /** Nuovo progetto creato da Jeko, da un template o dalla sola richiesta. */
  createProject(body: CreateProjectRun): Observable<RunSummary> {
    return this.add(this.http.post<RunSummary>('/api/projects/create', body));
  }

  private add(req: Observable<RunSummary>): Observable<RunSummary> {
    return req.pipe(
      tap((run) => this.list.update((runs) => [run, ...runs.filter((r) => r.id !== run.id)])),
    );
  }
}
