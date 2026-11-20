import { parseWorkflow, type Issue, type Workflow, type WorkflowRecord } from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso, json } from '../db/sql.js';

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

  /** Ultima versione di ogni workflow. */
  async list(): Promise<WorkflowRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT DISTINCT ON (name) ${COLUMNS} FROM workflows ORDER BY name, version DESC`,
    );
    return rows.map(toRecord);
  }

  async versions(name: string): Promise<WorkflowRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM workflows WHERE name = $1 ORDER BY version DESC`,
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
