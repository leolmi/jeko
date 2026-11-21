import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorkflow, type Issue, type Workflow, type WorkflowRecord } from '@jeko/shared';
import { now, readJson, writeAtomic, writeJson, type SettingsFile } from '../data/files.js';

/** Workflow di serie già caricati una volta: se l'utente li elimina, non tornano. */
const SEEDED = 'workflows.seeded';

/** Una versione nell'indice `workflows.json`; lo YAML sta in `workflows/<nome>/<versione>.yaml`. */
export type WorkflowEntry = Omit<WorkflowRecord, 'yaml'>;

export type SaveResult = { ok: true; record: WorkflowRecord } | { ok: false; issues: Issue[] };

const newestFirst = (a: WorkflowEntry, b: WorkflowEntry) => b.version - a.version;

/** File YAML di una versione. */
export const workflowFile = (dataDir: string, name: string, version: number) =>
  join(dataDir, 'workflows', name, `${version}.yaml`);

/**
 * Workflow versionati: ogni salvataggio è una versione nuova, con il suo file YAML.
 * L'indice sta in memoria; lo YAML si legge quando serve.
 */
export class WorkflowStore {
  private readonly index: string;
  private entries: WorkflowEntry[];

  constructor(
    private readonly dataDir: string,
    private readonly settings: SettingsFile,
  ) {
    this.index = join(dataDir, 'workflows.json');
    this.entries = readJson<WorkflowEntry[]>(this.index, []);
  }

  /** Salva una nuova versione: il numero lo assegna il server, non lo YAML. */
  async save(yaml: string): Promise<SaveResult> {
    const parsed = parseWorkflow(yaml);
    if (!parsed.ok) return parsed;
    const wf = parsed.workflow;
    const version = Math.max(0, ...this.of(wf.name).map((e) => e.version)) + 1;
    const entry: WorkflowEntry = {
      name: wf.name,
      version,
      kind: wf.kind,
      ...(wf.description !== undefined && { description: wf.description }),
      createdAt: now(),
    };
    writeAtomic(workflowFile(this.dataDir, wf.name, version), yaml);
    this.write([...this.entries, entry]);
    return { ok: true, record: { ...entry, yaml } };
  }

  /**
   * Carica i workflow di serie una volta sola: non quelli che hanno già una versione (le
   * versioni dell'utente non si toccano) né quelli già caricati e poi eliminati.
   * Restituisce i nomi aggiunti.
   */
  async seed(yamls: string[]): Promise<string[]> {
    const seeded = new Set(this.settings.get<string[]>(SEEDED) ?? []);
    const added: string[] = [];
    for (const yaml of yamls) {
      const parsed = parseWorkflow(yaml);
      if (!parsed.ok) throw new Error(`Workflow di serie non valido: ${parsed.issues[0]?.message}`);
      const { name } = parsed.workflow;
      if (seeded.has(name)) continue;
      seeded.add(name);
      if (this.of(name).length) continue;
      await this.save(yaml);
      added.push(name);
    }
    const list = [...seeded].sort();
    if (JSON.stringify(list) !== JSON.stringify(this.settings.get(SEEDED) ?? []))
      this.settings.set(SEEDED, list);
    return added;
  }

  /** Elimina il workflow con tutte le sue versioni; false se non c'era. */
  async remove(name: string): Promise<boolean> {
    if (!this.of(name).some((e) => e.kind === 'develop')) return false;
    this.write(this.entries.filter((e) => e.name !== name));
    rmSync(join(this.dataDir, 'workflows', name), { recursive: true, force: true });
    return true;
  }

  /** Ultima versione di ogni workflow di sviluppo (quelli di creazione di prima restano nascosti). */
  async list(): Promise<WorkflowRecord[]> {
    return this.names().map((name) => this.record(this.of(name)[0]!));
  }

  /** Numero di workflow di sviluppo. */
  get count(): number {
    return this.names().length;
  }

  /** Workflow predefinito di un tipo: il primo per nome. */
  async defaultOf(kind: Workflow['kind']): Promise<string | null> {
    return (await this.list()).find((w) => w.kind === kind)?.name ?? null;
  }

  async versions(name: string): Promise<WorkflowRecord[]> {
    return this.of(name)
      .filter((e) => e.kind === 'develop')
      .map((e) => this.record(e));
  }

  /** Definizione eseguibile; senza versione, l'ultima. */
  async definition(
    name: string,
    version?: number,
  ): Promise<{ version: number; workflow: Workflow } | null> {
    const entry = this.of(name).find((e) => version === undefined || e.version === version);
    if (!entry) return null;
    const parsed = parseWorkflow(this.yaml(entry));
    return parsed.ok
      ? { version: entry.version, workflow: { ...parsed.workflow, version: entry.version } }
      : null;
  }

  private names(): string[] {
    const develop = this.entries.filter((e) => e.kind === 'develop').map((e) => e.name);
    return [...new Set(develop)].sort();
  }

  /** Versioni di un workflow, dalla più recente. */
  private of(name: string): WorkflowEntry[] {
    return this.entries.filter((e) => e.name === name).sort(newestFirst);
  }

  private yaml(e: WorkflowEntry): string {
    return readFileSync(workflowFile(this.dataDir, e.name, e.version), 'utf8');
  }

  private record(e: WorkflowEntry): WorkflowRecord {
    return { ...e, yaml: this.yaml(e) };
  }

  private write(entries: WorkflowEntry[]): void {
    writeJson(this.index, entries);
    this.entries = entries;
  }
}
