import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { folderKey, type CreateProject, type Project, type UpdateProject } from '@jeko/shared';
import { now, readJson, writeJson } from '../data/files.js';

/** Progetti gestiti: un nome e la cartella in cui lavorano le sue run. In `projects.json`. */
export class ProjectStore {
  private readonly file: string;
  private items: Project[];

  constructor(dataDir: string) {
    this.file = join(dataDir, 'projects.json');
    this.items = readJson<Project[]>(this.file, []);
  }

  async list(): Promise<Project[]> {
    return [...this.items];
  }

  /** Aggiunge un progetto; null se la sua cartella è già di un altro progetto. */
  async add(p: CreateProject): Promise<Project | null> {
    if (await this.byPath(p.path)) return null;
    const project: Project = {
      id: randomUUID(),
      name: p.name.trim(),
      path: p.path.trim(),
      workflow: null,
      createdAt: now(),
    };
    this.save([...this.items, project]);
    return project;
  }

  /** Progetto di una cartella, confrontata come `folderKey`. */
  async byPath(path: string | null | undefined): Promise<Project | null> {
    const key = folderKey(path);
    if (!key) return null;
    return this.items.find((p) => folderKey(p.path) === key) ?? null;
  }

  async update(id: string, p: UpdateProject): Promise<Project | null> {
    const current = this.items.find((x) => x.id === id);
    if (!current) return null;
    const updated = { ...current, workflow: p.workflow };
    this.save(this.items.map((x) => (x.id === id ? updated : x)));
    return updated;
  }

  /** Il workflow non c'è più: i progetti che lo seguivano tornano al predefinito. */
  async forgetWorkflow(name: string): Promise<void> {
    if (!this.items.some((p) => p.workflow === name)) return;
    this.save(this.items.map((p) => (p.workflow === name ? { ...p, workflow: null } : p)));
  }

  async remove(id: string): Promise<boolean> {
    if (!this.items.some((p) => p.id === id)) return false;
    this.save(this.items.filter((p) => p.id !== id));
    return true;
  }

  private save(items: Project[]): void {
    writeJson(this.file, items);
    this.items = items;
  }
}
