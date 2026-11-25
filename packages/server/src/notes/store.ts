import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CreateNote, Note, UpdateNote } from '@jeko/shared';
import { now, readJson, writeJson } from '../data/files.js';

/** Note (idee e problemi), con o senza progetto, in `notes.json`. */
export class NoteStore {
  private readonly file: string;
  private items: Note[];

  constructor(dataDir: string) {
    this.file = join(dataDir, 'notes.json');
    this.items = readJson<Note[]>(this.file, []);
  }

  /** Tutte le note, le più recenti prima. */
  list(): Note[] {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  add(n: CreateNote): Note {
    const at = now();
    const note: Note = {
      id: randomUUID(),
      ...(n.projectId && { projectId: n.projectId }),
      kind: n.kind ?? 'idea',
      body: n.body.trim(),
      createdAt: at,
      updatedAt: at,
    };
    this.save([...this.items, note]);
    return note;
  }

  update(id: string, n: UpdateNote): Note | null {
    const current = this.items.find((x) => x.id === id);
    if (!current) return null;
    const updated: Note = {
      ...current,
      ...(n.body !== undefined && { body: n.body.trim() }),
      ...(n.kind !== undefined && { kind: n.kind }),
      ...(n.projectId && { projectId: n.projectId }),
      ...(n.runId && { runId: n.runId }),
      updatedAt: now(),
    };
    if (n.projectId === null) delete updated.projectId;
    if (n.runId === null) delete updated.runId;
    this.save(this.items.map((x) => (x.id === id ? updated : x)));
    return updated;
  }

  remove(id: string): boolean {
    if (!this.items.some((n) => n.id === id)) return false;
    this.save(this.items.filter((n) => n.id !== id));
    return true;
  }

  /** Il progetto è stato tolto dall'elenco: le sue note se ne vanno con lui. */
  removeProject(projectId: string): void {
    if (!this.items.some((n) => n.projectId === projectId)) return;
    this.save(this.items.filter((n) => n.projectId !== projectId));
  }

  private save(items: Note[]): void {
    writeJson(this.file, items);
    this.items = items;
  }
}
