import type { Db } from './db.js';

const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE workflows (
     name text NOT NULL,
     version int NOT NULL,
     kind text NOT NULL,
     description text,
     yaml text NOT NULL,
     definition jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (name, version)
   )`,
  `CREATE TABLE runs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     workflow_name text NOT NULL,
     workflow_version int NOT NULL,
     request text NOT NULL,
     mode text NOT NULL,
     inputs jsonb,
     cwd text,
     status text NOT NULL,
     error text,
     state jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     FOREIGN KEY (workflow_name, workflow_version) REFERENCES workflows (name, version)
   )`,
  `CREATE TABLE run_events (
     seq bigserial PRIMARY KEY,
     run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
     event jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX run_events_run ON run_events (run_id, seq)`,
  `CREATE TABLE run_prompts (
     id uuid PRIMARY KEY,
     run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
     prompt jsonb NOT NULL,
     answer jsonb,
     status text NOT NULL DEFAULT 'pending',
     created_at timestamptz NOT NULL DEFAULT now(),
     answered_at timestamptz
   )`,
  `CREATE INDEX run_prompts_run ON run_prompts (run_id, created_at)`,
  // Numero dell'evento nel giornale del runner: un reinvio non crea doppioni.
  `ALTER TABLE run_events ADD COLUMN runner_seq int`,
  `CREATE UNIQUE INDEX run_events_runner_seq ON run_events (run_id, runner_seq)`,
  // Impostazioni dell'installazione (es. primo avvio completato).
  `CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL)`,
  // Cartella del progetto: le sue run lavorano lì.
  `ALTER TABLE projects ADD COLUMN path text NOT NULL DEFAULT ''`,
  // Workflow che guida i task del progetto (sempre l'ultima versione); null = il predefinito.
  `ALTER TABLE projects ADD COLUMN workflow text`,
  // Template per creare progetti con l'AI: prompt già pronti, con un nome.
  `CREATE TABLE project_templates (
     name text PRIMARY KEY,
     prompt text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Le run di creazione portano con sé la definizione, costruita dal template: non è salvata
  // tra i workflow, quindi il riferimento ai workflow non vale più per tutte le run.
  `ALTER TABLE runs ADD COLUMN definition jsonb`,
  `ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_workflow_name_workflow_version_fkey`,
];

export async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS _migrations (n int PRIMARY KEY)`);
  const { rows } = await db.query<{ n: number }>(
    `SELECT coalesce(max(n), -1) AS n FROM _migrations`,
  );
  const done = rows[0]?.n ?? -1;
  for (let i = done + 1; i < migrations.length; i++) {
    await db.query(migrations[i]!);
    await db.query(`INSERT INTO _migrations (n) VALUES ($1)`, [i]);
  }
}
