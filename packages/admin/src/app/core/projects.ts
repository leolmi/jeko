import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  FINAL_STATUSES,
  folderKey,
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

  /** Run di creazione ancora aperte: il loro progetto non c'è ancora. */
  readonly creating = computed(() => this.runs.list().filter((r) => !r.cwd && isOpen(r)));

  constructor() {
    const rt = inject(Realtime);
    this.reload();
    rt.onReconnect(() => this.reload());
    rt.on((msg) => {
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

  /** Toglie il progetto dall'elenco: la cartella resta com'è. */
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/projects/${id}`));
    this.list.update((ps) => ps.filter((p) => p.id !== id));
    this.setDraft(id, '');
    if (this.activeId() === id) this.activeId.set(this.list()[0]?.id ?? null);
  }
}
