import { folderKey, type CreateProject, type Project, type UpdateProject } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso } from '../db/sql.js';

const COLUMNS = `id, name, path, workflow, ${iso('created_at')} AS "createdAt"`;

/** Progetti gestiti: un nome e la cartella in cui lavorano le sue run. */
export class ProjectStore {
  constructor(private readonly db: Db) {}

  async list(): Promise<Project[]> {
    const { rows } = await this.db.query<Project>(
      `SELECT ${COLUMNS} FROM projects ORDER BY created_at`,
    );
    return rows;
  }

  /** Aggiunge un progetto; null se la sua cartella è già di un altro progetto. */
  async add(p: CreateProject): Promise<Project | null> {
    if (await this.byPath(p.path)) return null;
    const { rows } = await this.db.query<Project>(
      `INSERT INTO projects (name, path) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [p.name.trim(), p.path.trim()],
    );
    return rows[0]!;
  }

  /** Progetto di una cartella, confrontata come `folderKey`. */
  async byPath(path: string | null | undefined): Promise<Project | null> {
    const key = folderKey(path);
    if (!key) return null;
    return (await this.list()).find((p) => folderKey(p.path) === key) ?? null;
  }

  async update(id: string, p: UpdateProject): Promise<Project | null> {
    const { rows } = await this.db.query<Project>(
      `UPDATE projects SET workflow = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, p.workflow],
    );
    return rows[0] ?? null;
  }

  async remove(id: string): Promise<boolean> {
    const { rows } = await this.db.query(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }
}
