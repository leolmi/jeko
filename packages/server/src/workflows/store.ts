import { parseWorkflow, type Issue, type Workflow, type WorkflowRecord } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso, json } from '../db/sql.js';

/** Workflow di serie già caricati una volta: se l'utente li elimina, non tornano. */
const SEEDED = 'workflows.seeded';

const COLUMNS = `name, version, kind, description, yaml, ${iso('created_at')} AS "createdAt"`;

type Row = Omit<WorkflowRecord, 'description'> & { description: string | null };

const toRecord = ({ description, ...r }: Row): WorkflowRecord => ({
  ...r,
  ...(description !== null && { description }),
});

export type SaveResult = { ok: true; record: WorkflowRecord } | { ok: false; issues: Issue[] };

export class WorkflowStore {
  constructor(private readonly db: Db) {}

  /** Salva una nuova versione: il numero lo assegna il server, non lo YAML. */
  async save(yaml: string): Promise<SaveResult> {
    const parsed = parseWorkflow(yaml);
    if (!parsed.ok) return parsed;
    const wf = parsed.workflow;
    const { rows } = await this.db.query<Row>(
      `INSERT INTO workflows (name, version, kind, description, yaml, definition)
       SELECT $1, coalesce(max(version), 0) + 1, $2, $3, $4, $5::jsonb
       FROM workflows WHERE name = $1
       RETURNING ${COLUMNS}`,
      [wf.name, wf.kind, wf.description ?? null, yaml, json(wf)],
    );
    return { ok: true, record: toRecord(rows[0]!) };
  }

  /**
   * Carica i workflow di serie una volta sola: non quelli che hanno già una versione (le
   * versioni dell'utente non si toccano) né quelli già caricati e poi eliminati.
   * Restituisce i nomi aggiunti.
   */
  async seed(yamls: string[]): Promise<string[]> {
    const { rows } = await this.db.query<{ value: string[] }>(
      `SELECT value FROM settings WHERE key = $1`,
      [SEEDED],
    );
    const seeded = new Set(rows[0]?.value ?? []);
    const added: string[] = [];
    for (const yaml of yamls) {
      const parsed = parseWorkflow(yaml);
      if (!parsed.ok) throw new Error(`Workflow di serie non valido: ${parsed.issues[0]?.message}`);
      const { name } = parsed.workflow;
      if (seeded.has(name)) continue;
      seeded.add(name);
      if ((await this.versions(name)).length) continue;
      await this.save(yaml);
      added.push(name);
    }
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SEEDED, json([...seeded].sort())],
    );
    return added;
  }

  /** Elimina il workflow con tutte le sue versioni; false se non c'era. */
  async remove(name: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `DELETE FROM workflows WHERE name = $1 AND kind = 'develop' RETURNING version`,
      [name],
    );
    return rows.length > 0;
  }

  /** Ultima versione di ogni workflow di sviluppo (quelli di creazione di prima restano nascosti). */
  async list(): Promise<WorkflowRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT DISTINCT ON (name) ${COLUMNS} FROM workflows WHERE kind = 'develop'
       ORDER BY name, version DESC`,
    );
    return rows.map(toRecord);
  }

  /** Workflow predefinito di un tipo: il primo per nome. */
  async defaultOf(kind: Workflow['kind']): Promise<string | null> {
    return (await this.list()).find((w) => w.kind === kind)?.name ?? null;
  }

  async versions(name: string): Promise<WorkflowRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM workflows WHERE name = $1 AND kind = 'develop'
       ORDER BY version DESC`,
      [name],
    );
    return rows.map(toRecord);
  }

  /** Definizione eseguibile; senza versione, l'ultima. */
  async definition(
    name: string,
    version?: number,
  ): Promise<{ version: number; workflow: Workflow } | null> {
    const { rows } = await this.db.query<{ version: number; definition: Workflow }>(
      `SELECT version, definition FROM workflows
       WHERE name = $1 AND ($2::int IS NULL OR version = $2)
       ORDER BY version DESC LIMIT 1`,
      [name, version ?? null],
    );
    const row = rows[0];
    return row
      ? { version: row.version, workflow: { ...row.definition, version: row.version } }
      : null;
  }
}
