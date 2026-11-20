import type {
  Answer,
  Prompt,
  PromptRecord,
  RunDetail,
  RunEvent,
  RunEventRecord,
  RunMode,
  RunRowStatus,
  RunState,
  RunSummary,
} from '@jeko/shared';
import type { Db } from '../db/db.js';
import { iso, json } from '../db/sql.js';

const RUN_COLUMNS = `id, workflow_name AS workflow, workflow_version AS version, request, mode,
  status, error, cwd, ${iso('created_at')} AS "createdAt", ${iso('updated_at')} AS "updatedAt"`;

const PROMPT_COLUMNS = `id, run_id AS "runId", prompt, answer, status, ${iso('created_at')} AS "createdAt"`;

export interface NewRun {
  workflow: string;
  version: number;
  request: string;
  mode: RunMode;
  inputs?: Record<string, string> | undefined;
  cwd?: string | undefined;
}

/** Dati per (ri)avviare una run sul runner. */
export interface RunLaunch {
  id: string;
  workflow: string;
  version: number;
  request: string;
  mode: RunMode;
  status: RunRowStatus;
  inputs: Record<string, string> | null;
  cwd: string | null;
  state: RunState | null;
}

export class RunStore {
  constructor(private readonly db: Db) {}

  async create(run: NewRun): Promise<RunSummary> {
    const { rows } = await this.db.query<RunSummary>(
      `INSERT INTO runs (workflow_name, workflow_version, request, mode, inputs, cwd, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'queued') RETURNING ${RUN_COLUMNS}`,
      [run.workflow, run.version, run.request, run.mode, json(run.inputs), run.cwd ?? null],
    );
    return rows[0]!;
  }

  async list(limit = 200): Promise<RunSummary[]> {
    const { rows } = await this.db.query<RunSummary>(
      `SELECT ${RUN_COLUMNS} FROM runs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async get(id: string): Promise<RunSummary | null> {
    const { rows } = await this.db.query<RunSummary>(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async detail(id: string): Promise<RunDetail | null> {
    const run = await this.get(id);
    if (!run) return null;
    const events = await this.db.query<RunEventRecord>(
      `SELECT seq::int AS seq, event, ${iso('created_at')} AS at
       FROM run_events WHERE run_id = $1 ORDER BY seq`,
      [id],
    );
    const prompts = await this.db.query<PromptRecord>(
      `SELECT ${PROMPT_COLUMNS} FROM run_prompts WHERE run_id = $1 ORDER BY created_at`,
      [id],
    );
    return { ...run, events: events.rows, prompts: prompts.rows };
  }

  /** Run da avviare o riprendere quando un runner si collega. */
  async launchable(): Promise<RunLaunch[]> {
    const { rows } = await this.db.query<RunLaunch>(
      `SELECT id, workflow_name AS workflow, workflow_version AS version, request, mode, status,
              inputs, cwd, state
       FROM runs WHERE status IN ('queued', 'running', 'waiting') ORDER BY created_at`,
    );
    return rows;
  }

  /** Valori della run (input e variabili) dall'ultimo stato salvato. */
  async values(id: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query<{ state: RunState | null }>(
      `SELECT state FROM runs WHERE id = $1`,
      [id],
    );
    return rows[0]?.state?.values ?? {};
  }

  async setStatus(id: string, status: RunRowStatus, error: string | null = null): Promise<void> {
    await this.db.query(
      `UPDATE runs SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
      [id, status, error],
    );
  }

  async saveState(id: string, state: RunState): Promise<void> {
    await this.db.query(`UPDATE runs SET state = $2::jsonb, updated_at = now() WHERE id = $1`, [
      id,
      json(state),
    ]);
  }

  /** Salva l'evento; null se quel numero del giornale del runner c'era già (reinvio). */
  async addEvent(id: string, runnerSeq: number, event: RunEvent): Promise<RunEventRecord | null> {
    const { rows } = await this.db.query<RunEventRecord>(
      `INSERT INTO run_events (run_id, runner_seq, event) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (run_id, runner_seq) DO NOTHING
       RETURNING seq::int AS seq, event, ${iso('created_at')} AS at`,
      [id, runnerSeq, json(event)],
    );
    return rows[0] ?? null;
  }

  /** Registra una richiesta; se esiste già (runner riconnesso) restituisce quella salvata. */
  async addPrompt(
    runId: string,
    promptId: string,
    prompt: Prompt,
  ): Promise<{ record: PromptRecord; created: boolean }> {
    const inserted = await this.db.query<PromptRecord>(
      `INSERT INTO run_prompts (id, run_id, prompt) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING ${PROMPT_COLUMNS}`,
      [promptId, runId, json(prompt)],
    );
    if (inserted.rows[0]) return { record: inserted.rows[0], created: true };
    const existing = await this.getPrompt(promptId);
    return { record: existing!, created: false };
  }

  async getPrompt(promptId: string): Promise<PromptRecord | null> {
    const { rows } = await this.db.query<PromptRecord>(
      `SELECT ${PROMPT_COLUMNS} FROM run_prompts WHERE id = $1`,
      [promptId],
    );
    return rows[0] ?? null;
  }

  /** Salva la risposta solo se la richiesta è ancora in attesa. */
  async answerPrompt(promptId: string, answer: Answer): Promise<PromptRecord | null> {
    const { rows } = await this.db.query<PromptRecord>(
      `UPDATE run_prompts SET answer = $2::jsonb, status = 'answered', answered_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING ${PROMPT_COLUMNS}`,
      [promptId, json(answer)],
    );
    return rows[0] ?? null;
  }

  async pendingCount(runId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM run_prompts WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Le richieste in attesa di una run ripartita da zero non hanno più senso. */
  async supersedePending(runId: string): Promise<void> {
    await this.db.query(
      `UPDATE run_prompts SET status = 'superseded' WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
  }
}
