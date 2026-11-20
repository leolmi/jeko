import type { ProjectTemplate } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso } from '../db/sql.js';

const COLUMNS = `name, prompt, ${iso('updated_at')} AS "updatedAt"`;

/** Template per creare progetti con l'AI: prompt già pronti, ciascuno con un nome. */
export class TemplateStore {
  constructor(private readonly db: Db) {}

  async list(): Promise<ProjectTemplate[]> {
    const { rows } = await this.db.query<ProjectTemplate>(
      `SELECT ${COLUMNS} FROM project_templates ORDER BY lower(name)`,
    );
    return rows;
  }

  async get(name: string): Promise<ProjectTemplate | null> {
    const { rows } = await this.db.query<ProjectTemplate>(
      `SELECT ${COLUMNS} FROM project_templates WHERE name = $1`,
      [name],
    );
    return rows[0] ?? null;
  }

  /** Crea o sostituisce il template con quel nome. */
  async save(name: string, prompt: string): Promise<ProjectTemplate> {
    const { rows } = await this.db.query<ProjectTemplate>(
      `INSERT INTO project_templates (name, prompt) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET prompt = EXCLUDED.prompt, updated_at = now()
       RETURNING ${COLUMNS}`,
      [name.trim(), prompt],
    );
    return rows[0]!;
  }

  async remove(name: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `DELETE FROM project_templates WHERE name = $1 RETURNING name`,
      [name],
    );
    return rows.length > 0;
  }
}
