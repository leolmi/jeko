import { folderKey, type CreateProject, type Project } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso } from '../db/sql.js';

const COLUMNS = `id, name, path, ${iso('created_at')} AS "createdAt"`;

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
    const key = folderKey(p.path);
    if ((await this.list()).some((x) => folderKey(x.path) === key)) return null;
    const { rows } = await this.db.query<Project>(
      `INSERT INTO projects (name, path) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [p.name.trim(), p.path.trim()],
    );
    return rows[0]!;
  }

  async remove(id: string): Promise<boolean> {
    const { rows } = await this.db.query(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }
}
