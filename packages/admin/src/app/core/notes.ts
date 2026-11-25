import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import type { CreateNote, Note, UpdateNote } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';
import { Projects } from './projects';
import { storage } from './storage';

/** Chiave delle note senza progetto: diventano la richiesta di un progetto nuovo. */
export const NEW_PROJECT = '_new';

function readPending(): Record<string, string[]> {
  try {
    return JSON.parse(storage.get('notes.pending') ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

/**
 * Note (idee e problemi), con o senza progetto. "Crea task" mette il testo nella chat del
 * progetto (o nella richiesta di un progetto nuovo): le note restano in attesa finché il task
 * non parte, poi si legano a lui.
 */
@Injectable({ providedIn: 'root' })
export class Notes {
  private readonly http = inject(HttpClient);
  private readonly projects = inject(Projects);
  readonly list = signal<Note[]>([]);
  readonly loaded = signal(false);
  /** Note ancora da trasformare in task. */
  readonly todo = computed(() => this.list().filter((n) => !n.runId));
  /** Note messe in una chat e non ancora diventate un task, per progetto (o `NEW_PROJECT`). */
  readonly pending = signal<Record<string, string[]>>(readPending());

  constructor() {
    effect(() => storage.set('notes.pending', JSON.stringify(this.pending())));
  }

  load(): void {
    this.http.get<Note[]>('/api/notes').subscribe({
      next: (notes) => {
        this.list.set(notes);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  async add(body: CreateNote): Promise<void> {
    const note = await firstValueFrom(this.http.post<Note>('/api/notes', body));
    this.list.update((l) => [note, ...l]);
  }

  async update(note: Note, body: UpdateNote): Promise<void> {
    const saved = await firstValueFrom(this.http.patch<Note>(`/api/notes/${note.id}`, body));
    this.list.update((l) => l.map((n) => (n.id === saved.id ? saved : n)));
  }

  async remove(note: Note): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/notes/${note.id}`));
    this.list.update((l) => l.filter((n) => n.id !== note.id));
    const key = note.projectId ?? NEW_PROJECT;
    const ids = (this.pending()[key] ?? []).filter((x) => x !== note.id);
    if (ids.length) this.pending.update((p) => ({ ...p, [key]: ids }));
    else this.dropPending(key);
  }

  isPending(note: Note): boolean {
    return (this.pending()[note.projectId ?? NEW_PROJECT] ?? []).includes(note.id);
  }

  /**
   * Mette la nota in attesa di diventare un task. Con un progetto il testo va nella sua chat,
   * in fondo a quello già scritto; senza, lo prende la pagina del nuovo progetto.
   */
  toTask(note: Note): void {
    const key = note.projectId ?? NEW_PROJECT;
    if (!this.isPending(note)) {
      this.pending.update((p) => ({ ...p, [key]: [...(p[key] ?? []), note.id] }));
      if (note.projectId) {
        const draft = (this.projects.drafts()[note.projectId] ?? '').trim();
        this.projects.setDraft(note.projectId, draft ? `${draft}\n\n${note.body}` : note.body);
      }
    }
    if (note.projectId) this.projects.activeId.set(note.projectId);
  }

  /** Testo delle note in attesa di un progetto nuovo. */
  newProjectRequest(): string {
    const ids = this.pending()[NEW_PROJECT] ?? [];
    return this.list()
      .filter((n) => ids.includes(n.id))
      .map((n) => n.body)
      .join('\n\n');
  }

  /** La chat è stata svuotata (o lasciata): le note tornano da fare. */
  dropPending(key: string): void {
    if (!this.pending()[key]) return;
    this.pending.update((p) => {
      const { [key]: _gone, ...rest } = p;
      return rest;
    });
  }

  /** Il task è partito: le note in attesa si legano a lui. */
  linkRun(key: string, runId: string): void {
    const ids = this.pending()[key] ?? [];
    this.dropPending(key);
    for (const id of ids) {
      this.http.patch<Note>(`/api/notes/${id}`, { runId }).subscribe({
        next: (saved) => this.list.update((l) => l.map((n) => (n.id === id ? saved : n))),
        error: () => undefined,
      });
    }
  }
}
