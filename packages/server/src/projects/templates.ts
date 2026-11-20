import { templateIssues, type ProjectTemplate } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso, json } from '../db/sql.js';

/** Template di serie già caricati una volta: se l'utente li elimina, non tornano. */
const SEEDED = 'templates.seeded';

const COLUMNS = `name, prompt, ${iso('updated_at')} AS "updatedAt"`;

export type TemplateFile = Pick<ProjectTemplate, 'name' | 'prompt'>;

/** File di un template di serie: `# Nome` sulla prima riga, poi il prompt. */
export function parseTemplateFile(text: string): TemplateFile {
  const [first = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  const name = /^#\s+(.+)$/.exec(first)?.[1]?.trim();
  const prompt = rest.join('\n').trim();
  if (!name || !prompt) throw new Error('Template di serie: serve "# Nome" e poi il prompt');
  return { name, prompt };
}

/** Template per creare progetti con l'AI: prompt già pronti, ciascuno con un nome. */
export class TemplateStore {
  constructor(private readonly db: Db) {}

  /**
   * Carica i template di serie una volta sola: non quelli con un nome già usato (quelli
   * dell'utente non si toccano) né quelli già caricati e poi eliminati. Restituisce i nomi aggiunti.
   */
  async seed(files: TemplateFile[]): Promise<string[]> {
    const { rows } = await this.db.query<{ value: string[] }>(
      `SELECT value FROM settings WHERE key = $1`,
      [SEEDED],
    );
    const seeded = new Set(rows[0]?.value ?? []);
    const added: string[] = [];
    for (const { name, prompt } of files) {
      const issues = templateIssues(prompt);
      if (issues.length) throw new Error(`Template di serie "${name}": ${issues[0]?.message}`);
      if (seeded.has(name)) continue;
      seeded.add(name);
      if (await this.get(name)) continue;
      await this.save(name, prompt);
      added.push(name);
    }
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SEEDED, json([...seeded].sort())],
    );
    return added;
  }

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
