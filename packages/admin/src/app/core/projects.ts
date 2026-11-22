import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  FINAL_STATUSES,
  folderKey,
  type ContextExclusions,
  type AgentChoice,
  type ClaudeModels,
  type CreateProject,
  type Project,
  type RunRowStatus,
  type RunSummary,
} from '@jeko/shared';
import { firstValueFrom } from 'rxjs';
import { Realtime } from './realtime';
import { Runs } from './runs';
import { storage } from './storage';

/** Ordine dei task aperti: prima quelli che aspettano l'utente. */
const OPEN_ORDER: Partial<Record<RunRowStatus, number>> = { waiting: 0, running: 1, queued: 2 };
export const isOpen = (r: RunSummary): boolean => !FINAL_STATUSES.includes(r.status);

export interface ProjectView extends Project {
  /** Task aperti, prima quelli che aspettano l'utente. */
  open: RunSummary[];
  closed: RunSummary[];
  waiting: number;
  /** Ultima attività: l'ultimo task, o la creazione del progetto. */
  last: string;
}

function readDrafts(): Record<string, string> {
  try {
    return JSON.parse(storage.get('drafts') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Progetti gestiti, con i loro task, il progetto attivo e il testo in sospeso di ciascuno. */
@Injectable({ providedIn: 'root' })
export class Projects {
  private readonly http = inject(HttpClient);
  private readonly runs = inject(Runs);
  readonly list = signal<Project[]>([]);
  readonly loaded = signal(false);
  readonly activeId = signal<string | null>(storage.get('project'));
  /** Testo scritto e non ancora inviato, per progetto. */
  readonly drafts = signal<Record<string, string>>(readDrafts());

  readonly views = computed((): ProjectView[] => {
    const byKey = new Map<string, RunSummary[]>();
    for (const r of this.runs.list()) {
      const key = folderKey(r.cwd);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), r]);
    }
    return this.list().map((p) => {
      const runs = [...(byKey.get(folderKey(p.path) ?? '') ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      const open = runs
        .filter(isOpen)
        .sort((a, b) => (OPEN_ORDER[a.status] ?? 9) - (OPEN_ORDER[b.status] ?? 9));
      return {
        ...p,
        open,
        closed: runs.filter((r) => !isOpen(r)),
        waiting: open.filter((r) => r.status === 'waiting').length,
        last: runs[0]?.createdAt ?? p.createdAt,
      };
    });
  });

  readonly active = computed(
    () => this.views().find((p) => p.id === this.activeId()) ?? this.views()[0] ?? null,
  );

  /** Modelli predefiniti di claude visti nei task (dal server). */
  private readonly claudeModels = signal<ClaudeModels>({ byFolder: {}, last: null });

  /** Modello predefinito di claude nella cartella: quello visto lì, o l'ultimo visto. */
  defaultModel(path: string | null | undefined): string | undefined {
    const m = this.claudeModels();
    const key = folderKey(path);
    return (key && m.byFolder[key]) || m.last || undefined;
  }

  /** Run di creazione ancora aperte: il loro progetto non c'è ancora. */
  readonly creating = computed(() => this.runs.list().filter((r) => !r.cwd && isOpen(r)));

  constructor() {
    const rt = inject(Realtime);
    this.reload();
    rt.onReconnect(() => this.reload());
    rt.on((msg) => {
      if (msg.type === 'claude.models') return this.claudeModels.set(msg.models);
      if (msg.type !== 'project.added') return;
      this.list.update((ps) => [...ps.filter((p) => p.id !== msg.project.id), msg.project]);
      this.activeId.set(msg.project.id);
    });
    effect(() => {
      const id = this.activeId();
      if (id) storage.set('project', id);
    });
    effect(() => storage.set('drafts', JSON.stringify(this.drafts())));
  }

  reload(): void {
    this.http.get<Project[]>('/api/projects').subscribe({
      next: (ps) => {
        this.list.set(ps);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  /** Progetto di una run, dalla sua cartella. */
  of(run: RunSummary | undefined): ProjectView | undefined {
    const key = folderKey(run?.cwd);
    return key ? this.views().find((p) => folderKey(p.path) === key) : undefined;
  }

  setDraft(projectId: string, text: string): void {
    this.drafts.update((d) => {
      const next = { ...d, [projectId]: text };
      if (!text) delete next[projectId];
      return next;
    });
  }

  async add(p: CreateProject): Promise<Project> {
    const project = await firstValueFrom(this.http.post<Project>('/api/projects', p));
    this.list.update((ps) => [...ps, project]);
    this.activeId.set(project.id);
    return project;
  }

  /** Workflow che guida i task del progetto; null = il predefinito. */
  async setWorkflow(id: string, workflow: string | null): Promise<void> {
    const project = await firstValueFrom(
      this.http.patch<Project>(`/api/projects/${id}`, { workflow }),
    );
    this.list.update((ps) => ps.map((p) => (p.id === id ? project : p)));
  }

  /** Esclusioni dal contesto di claude per le run del progetto. */
  async setExclusions(id: string, exclude: ContextExclusions): Promise<void> {
    const project = await firstValueFrom(
      this.http.patch<Project>(`/api/projects/${id}`, { exclude }),
    );
    this.list.update((ps) => ps.map((p) => (p.id === id ? project : p)));
  }

  /** Ragionamento e modello predefiniti dei task del progetto; `{}` = quelli di claude. */
  async setAgent(id: string, agent: AgentChoice): Promise<void> {
    const project = await firstValueFrom(
      this.http.patch<Project>(`/api/projects/${id}`, { agent }),
    );
    this.list.update((ps) => ps.map((p) => (p.id === id ? project : p)));
  }

  /** Ultima modifica dei preferiti: le risposte di quelle precedenti non contano più. */
  private favoritesSeq = 0;

  /** Preferiti nell'ordine dato; si vedono subito, il server conferma. */
  async setFavorites(ids: string[]): Promise<void> {
    const seq = ++this.favoritesSeq;
    const pos = new Map(ids.map((id, i) => [id, i]));
    this.list.update((ps) =>
      ps.map((p) => {
        const { favorite: _old, ...rest } = p;
        const favorite = pos.get(p.id);
        return favorite === undefined ? rest : { ...rest, favorite };
      }),
    );
    try {
      const saved = await firstValueFrom(
        this.http.put<Project[]>('/api/projects/favorites', { ids }),
      );
      if (seq === this.favoritesSeq) this.list.set(saved);
    } catch (e) {
      // Non salvato: si torna a quello che ha il server.
      if (seq === this.favoritesSeq) this.reload();
      throw e;
    }
  }

  /** Id dei preferiti, nel loro ordine. */
  favoriteIds(): string[] {
    return this.list()
      .filter((p) => p.favorite !== undefined)
      .sort((a, b) => (a.favorite ?? 0) - (b.favorite ?? 0))
      .map((p) => p.id);
  }

  /** Aggiunge in fondo ai preferiti o li toglie. */
  toggleFavorite(id: string): Promise<void> {
    const ids = this.favoriteIds();
    return this.setFavorites(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  /** Toglie il progetto dall'elenco: la cartella resta com'è. */
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/projects/${id}`));
    this.list.update((ps) => ps.filter((p) => p.id !== id));
    this.setDraft(id, '');
    if (this.activeId() === id) this.activeId.set(this.list()[0]?.id ?? null);
  }
}
