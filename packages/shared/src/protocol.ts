import { Type, type Static } from '@sinclair/typebox';
import {
  ContextExclusionsSchema,
  ContextInventorySchema,
  Id,
  ProjectPromptSchema,
  PromptName,
  Timestamp,
  UserSettingsSchema,
  type Project,
} from './contract.js';
import { StepMarkSchema, type StepMark } from './workflow/path.js';
import { AgentChoiceSchema } from './workflow/schema.js';
import { AgentUsageSchema, RunEventSchema, RunStateSchema } from './workflow/run.js';
import {
  PolicyActionSchema,
  RunModeSchema,
  WorkflowKindSchema,
  WorkflowSchema,
} from './workflow/schema.js';

// ---------- richieste all'utente durante una run ----------

/** Scelta proposta da claude (AskUserQuestion): l'utente può sempre scrivere altro. */
export const AskOptionSchema = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
});
export type AskOption = Static<typeof AskOptionSchema>;

export const PromptSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('ask'),
    stepId: Type.String(),
    question: Type.String(),
    required: Type.Boolean(),
    enum: Type.Optional(Type.Array(Type.String())),
    default: Type.Optional(Type.String()),
    /** Domanda di claude: titolo breve, scelte e se se ne possono prendere più d'una. */
    header: Type.Optional(Type.String()),
    options: Type.Optional(Type.Array(AskOptionSchema)),
    multiSelect: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    kind: Type.Literal('approve'),
    stepId: Type.String(),
    message: Type.String(),
    reason: Type.Union([Type.Literal('gate'), Type.Literal('policy')]),
    actions: Type.Optional(Type.Array(PolicyActionSchema)),
    /** Gate: uscita dell'ultimo passo agent (es. il piano da approvare). */
    output: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal('review'),
    stepId: Type.String(),
    output: Type.String(),
  }),
]);
export type Prompt = Static<typeof PromptSchema>;
export type PromptKind = Prompt['kind'];

export const AnswerSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('ask'), value: Type.Union([Type.String(), Type.Null()]) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('approve'),
      approved: Type.Boolean(),
      note: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('review'),
      ok: Type.Boolean(),
      feedback: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
]);
export type Answer = Static<typeof AnswerSchema>;

// ---------- verifiche dell'ambiente (primo avvio) ----------

/** Esito di una verifica: `error` blocca il primo avvio, `warn` è solo un avviso. */
export const CheckSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  ok: Type.Boolean(),
  severity: Type.Union([Type.Literal('error'), Type.Literal('warn')]),
  detail: Type.Optional(Type.String()),
});
export type Check = Static<typeof CheckSchema>;

// ---------- processi lasciati attivi da un task ----------

/** Processo avviato da claude con `start_process`: resta attivo fino alla chiusura del task. */
export const TaskProcessSchema = Type.Object({
  pid: Type.Integer(),
  command: Type.String(),
  cwd: Type.String(),
  log: Type.String(),
  startedAt: Timestamp,
  alive: Type.Boolean(),
});
export type TaskProcess = Static<typeof TaskProcessSchema>;

// ---------- WebSocket runner ↔ server ----------

export const RunnerToServerSchema = Type.Union([
  Type.Object({
    type: Type.Literal('hello'),
    runnerId: Type.String({ minLength: 1 }),
    version: Type.String(),
    /** Run ancora vive nel runner (dopo una riconnessione). */
    activeRuns: Type.Array(Type.String()),
    /** Verifiche dell'ambiente del runner (claude, git, permessi…). */
    checks: Type.Optional(Type.Array(CheckSchema)),
  }),
  /** Verifiche rifatte su richiesta del server. */
  Type.Object({ type: Type.Literal('checks'), checks: Type.Array(CheckSchema) }),
  /** Evento dal giornale del runner: `seq` cresce per run, senza buchi; il server lo conferma. */
  Type.Object({
    type: Type.Literal('run.event'),
    seq: Type.Integer({ minimum: 1 }),
    event: RunEventSchema,
  }),
  /** Fine del reinvio dopo `hello`: ora il server può (ri)avviare le run. */
  Type.Object({ type: Type.Literal('ready') }),
  /** Risposta di claude a una richiesta di assistenza (`text`), o l'errore. */
  Type.Object({
    type: Type.Literal('assist.result'),
    requestId: Type.String({ minLength: 1 }),
    text: Type.Union([Type.String(), Type.Null()]),
    error: Type.Optional(Type.String()),
  }),
  /** Cartella scelta col dialogo del PC: `path` null se l'utente ha annullato. */
  Type.Object({
    type: Type.Literal('folder.picked'),
    requestId: Type.String({ minLength: 1 }),
    path: Type.Union([Type.String(), Type.Null()]),
    error: Type.Optional(Type.String()),
  }),
  /** Prompt del progetto dopo l'operazione richiesta, o l'errore. */
  Type.Object({
    type: Type.Literal('prompts.result'),
    requestId: Type.String({ minLength: 1 }),
    prompts: Type.Array(ProjectPromptSchema),
    error: Type.Optional(Type.String()),
  }),
  /** Cosa claude carica all'avvio nella cartella, o l'errore. */
  Type.Object({
    type: Type.Literal('context.result'),
    requestId: Type.String({ minLength: 1 }),
    inventory: Type.Union([ContextInventorySchema, Type.Null()]),
    error: Type.Optional(Type.String()),
  }),
  /** Terminale aperto sul PC, o l'errore. */
  Type.Object({
    type: Type.Literal('terminal.opened'),
    requestId: Type.String({ minLength: 1 }),
    error: Type.Optional(Type.String()),
  }),
  /** Processi del task (dopo l'eventuale chiusura), o l'errore. */
  Type.Object({
    type: Type.Literal('processes.result'),
    requestId: Type.String({ minLength: 1 }),
    processes: Type.Array(TaskProcessSchema),
    error: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('run.prompt'),
    runId: Type.String(),
    promptId: Id,
    prompt: PromptSchema,
  }),
]);
export type RunnerToServer = Static<typeof RunnerToServerSchema>;

export const RunStartSchema = Type.Object({
  type: Type.Literal('run.start'),
  runId: Type.String(),
  workflow: WorkflowSchema,
  request: Type.String(),
  mode: RunModeSchema,
  inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
  cwd: Type.Optional(Type.String()),
  state: Type.Optional(RunStateSchema),
  /** Opzioni dell'utente al momento dell'avvio. */
  settings: Type.Optional(UserSettingsSchema),
  /** Esclusioni dal contesto di claude, dal progetto della cartella. */
  exclude: Type.Optional(ContextExclusionsSchema),
  /** Ragionamento e modello scelti dall'utente, per i passi agent che non li fissano. */
  agent: Type.Optional(AgentChoiceSchema),
  /** Sessione di claude da cui ripartire (copiata) al primo turno: task che continua un altro. */
  forkSession: Type.Optional(Type.String({ minLength: 1 })),
});
export type RunStart = Static<typeof RunStartSchema>;

export const ServerToRunnerSchema = Type.Union([
  RunStartSchema,
  Type.Object({
    type: Type.Literal('run.answer'),
    runId: Type.String(),
    promptId: Id,
    answer: AnswerSchema,
  }),
  Type.Object({ type: Type.Literal('run.cancel'), runId: Type.String() }),
  /** Rifai le verifiche dell'ambiente e rimandale. */
  Type.Object({ type: Type.Literal('checks.request') }),
  /** Chiedi a claude, senza strumenti né progetto, una risposta testuale al prompt. */
  Type.Object({
    type: Type.Literal('assist.request'),
    requestId: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
  }),
  /** Apri sul PC il dialogo di scelta di una cartella e rimanda quella scelta. */
  Type.Object({
    type: Type.Literal('folder.pick'),
    requestId: Type.String({ minLength: 1 }),
    start: Type.Optional(Type.String()),
    title: Type.Optional(Type.String({ maxLength: 200 })),
  }),
  /** Prompt del progetto in `.jeko/prompts/`: elenco, salvataggio o eliminazione di uno. */
  Type.Object({
    type: Type.Literal('prompts.request'),
    requestId: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
    op: Type.Union([
      Type.Object({ kind: Type.Literal('list') }),
      Type.Object({ kind: Type.Literal('save'), name: PromptName, text: Type.String() }),
      Type.Object({ kind: Type.Literal('delete'), name: PromptName }),
    ]),
  }),
  /** Avvia claude un attimo nella cartella e rimanda cosa carica (strumenti, MCP, plugin…). */
  Type.Object({
    type: Type.Literal('context.request'),
    requestId: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
  }),
  /** Apri sul PC un terminale nella cartella (es. per un login o dati sensibili). */
  Type.Object({
    type: Type.Literal('terminal.open'),
    requestId: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
  }),
  /** Processi lasciati attivi da un task: elenco, o chiusura di quelli vivi e poi l'elenco. */
  Type.Object({
    type: Type.Literal('processes.request'),
    requestId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    stop: Type.Boolean(),
  }),
  /** Eventi salvati fino a `seq` compreso: il runner può toglierli dal giornale. */
  Type.Object({
    type: Type.Literal('run.ack'),
    runId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
  }),
]);
export type ServerToRunner = Static<typeof ServerToRunnerSchema>;

/** Richiesta della web-app: aprire il dialogo di scelta della cartella sul PC del runner. */
export const PickFolderSchema = Type.Object(
  {
    start: Type.Optional(Type.String({ maxLength: 1000 })),
    title: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type PickFolder = Static<typeof PickFolderSchema>;

export const IssueSchema = Type.Object({
  path: Type.Array(Type.Union([Type.String(), Type.Number()])),
  message: Type.String(),
  line: Type.Optional(Type.Integer()),
  col: Type.Optional(Type.Integer()),
});

/** Esito della verifica di uno YAML: il workflow letto, o gli errori con la riga. */
export const WorkflowCheckSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), workflow: WorkflowSchema }),
  Type.Object({ ok: Type.Literal(false), issues: Type.Array(IssueSchema) }),
]);
export type WorkflowCheck = Static<typeof WorkflowCheckSchema>;

/** Modifica di un workflow chiesta all'AI: lo YAML attuale e cosa cambiare. */
export const AssistWorkflowSchema = Type.Object(
  {
    yaml: Type.String({ maxLength: 100_000 }),
    request: Type.String({ minLength: 1, maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type AssistWorkflow = Static<typeof AssistWorkflowSchema>;

/** Proposta dell'AI: lo YAML nuovo, un riassunto e gli errori rimasti (vuoti se valido). */
export const WorkflowProposalSchema = Type.Object({
  yaml: Type.String(),
  summary: Type.String(),
  issues: Type.Array(IssueSchema),
});
export type WorkflowProposal = Static<typeof WorkflowProposalSchema>;

// ---------- REST ----------

export const WorkflowRecordSchema = Type.Object({
  name: Type.String(),
  version: Type.Integer(),
  kind: WorkflowKindSchema,
  description: Type.Optional(Type.String()),
  yaml: Type.String(),
  createdAt: Timestamp,
});
export type WorkflowRecord = Static<typeof WorkflowRecordSchema>;

export const SaveWorkflowSchema = Type.Object(
  { yaml: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const RunRowStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('waiting'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
]);
export type RunRowStatus = Static<typeof RunRowStatusSchema>;

export const FINAL_STATUSES: readonly RunRowStatus[] = ['done', 'failed', 'rejected', 'cancelled'];

export const StartRunSchema = Type.Object(
  {
    /** Senza workflow: quello del progetto della cartella, o il predefinito. */
    workflow: Type.Optional(Type.String({ minLength: 1 })),
    version: Type.Optional(Type.Integer({ minimum: 1 })),
    request: Type.String({ minLength: 1 }),
    mode: RunModeSchema,
    inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    /** Task diretto: niente workflow di sviluppo, claude esegue la richiesta così com'è. */
    direct: Type.Optional(Type.Boolean()),
    /** Ragionamento e modello del task; i campi assenti vengono dal progetto della cartella. */
    agent: Type.Optional(AgentChoiceSchema),
    /** Task diretto chiuso da cui continuare: claude riparte dalla sua conversazione. */
    from: Type.Optional(Id),
  },
  { additionalProperties: false },
);
export type StartRun = Static<typeof StartRunSchema>;

/** Nuovo progetto creato da Jeko: nome, richiesta e, se c'è, il template da seguire. */
export const CreateProjectRunSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' }),
    request: Type.String({ minLength: 1 }),
    template: Type.Optional(Type.String({ minLength: 1 })),
    mode: RunModeSchema,
  },
  { additionalProperties: false },
);
export type CreateProjectRun = Static<typeof CreateProjectRunSchema>;

export const RunSummarySchema = Type.Object({
  id: Id,
  workflow: Type.String(),
  version: Type.Integer(),
  request: Type.String(),
  mode: RunModeSchema,
  status: RunRowStatusSchema,
  error: Type.Union([Type.String(), Type.Null()]),
  /** Cartella in cui lavora: lega la run al suo progetto. */
  cwd: Type.Union([Type.String(), Type.Null()]),
  /** Consumo dei turni di claude finora (dall'ultimo stato salvato). */
  usage: Type.Union([AgentUsageSchema, Type.Null()]),
  /** Percorso per l'elenco dei task: passi del workflow o turni del task diretto. */
  path: Type.Array(StepMarkSchema),
  /** Task da cui questo continua, se c'è. */
  from: Type.Optional(Id),
  /** Ragionamento e modello scelti all'avvio (task e progetto); assente se nessuno. */
  agent: Type.Optional(AgentChoiceSchema),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type RunSummary = Static<typeof RunSummarySchema>;

export const PromptRecordSchema = Type.Object({
  id: Id,
  runId: Id,
  prompt: PromptSchema,
  answer: Type.Union([AnswerSchema, Type.Null()]),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('answered'),
    Type.Literal('superseded'),
  ]),
  createdAt: Timestamp,
});
export type PromptRecord = Static<typeof PromptRecordSchema>;

export const RunEventRecordSchema = Type.Object({
  seq: Type.Integer(),
  event: RunEventSchema,
  at: Timestamp,
});
export type RunEventRecord = Static<typeof RunEventRecordSchema>;

export type RunDetail = RunSummary & { events: RunEventRecord[]; prompts: PromptRecord[] };

/** Stato del primo avvio: servizio, runner e verifiche dell'ambiente. */
export interface SetupStatus {
  completed: boolean;
  server: { version: string; workflows: number };
  runner: {
    connected: boolean;
    runnerId?: string;
    version?: string;
    checks: Check[] | null;
    checkedAt?: string;
  };
}

/** Aggiornamento dell'app dalle release GitHub. */
export interface UpdateInfo {
  current: string;
  /** Ultima versione pubblicata; null se non si sa (nessuna release, errore). */
  latest: string | null;
  available: boolean;
  /** Perché non si può installare: avvio dai sorgenti, cartella dell'app non scrivibile. */
  blocked: 'source' | 'readonly' | null;
  checkedAt: string;
  notes?: string;
  error?: string;
}

/** Informazioni sull'app (`GET /api/app`). */
export interface AppInfo {
  version: string;
  /** Gira come app desktop (Neutralino): solo lì ci sono gli aggiornamenti. */
  desktop: boolean;
  /** Ultimo controllo degli aggiornamenti, se fatto. */
  update: UpdateInfo | null;
  /** Task in coda o al lavoro: finché ci sono non si aggiorna. */
  active: number;
}

// ---------- WebSocket admin (solo server → admin) ----------

export type AdminMessage =
  | { type: 'runner'; connected: boolean; runnerId?: string }
  | { type: 'run.status'; runId: string; status: RunRowStatus; error: string | null }
  | { type: 'run.event'; runId: string; record: RunEventRecord }
  | { type: 'run.prompt'; runId: string; prompt: PromptRecord }
  /** Percorso aggiornato della run, per l'elenco dei task. */
  | { type: 'run.path'; runId: string; path: StepMark[] }
  /** Un workflow di creazione ha aggiunto un progetto. */
  | { type: 'project.added'; project: Project }
  /** Task conclusi eliminati dall'utente. */
  | { type: 'runs.removed'; ids: string[] }
  /** Modelli predefiniti di claude visti nei task: per cartella e l'ultimo in assoluto. */
  | { type: 'claude.models'; models: ClaudeModels };

/** Modello predefinito di claude per cartella (`folderKey`), e l'ultimo visto. */
export interface ClaudeModels {
  byFolder: Record<string, string>;
  last: string | null;
}

/** Task conclusi da eliminare: quelli ancora aperti restano. */
export const RemoveRunsSchema = Type.Object(
  { ids: Type.Array(Id, { minItems: 1, maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false },
);

// ---------- statistiche ----------

/** Consumo sommato di un gruppo di run (solo quelle che l'hanno registrato). */
export interface UsageTotals {
  runs: number;
  durationMs: number;
  tokens: number;
  costUsd: number;
}

/** Statistiche delle run ancora presenti, di un progetto o di tutti, da una data. */
export interface Stats {
  /** Inizio del periodo (giorno locale, YYYY-MM-DD); null = dalla prima run. */
  from: string | null;
  to: string;
  totals: {
    runs: number;
    byStatus: Partial<Record<RunRowStatus, number>>;
    /** Segui workflow e richiesta libera. */
    plan: UsageTotals;
    direct: UsageTotals;
  };
  /** Un giorno per riga, dal primo del periodo a oggi. */
  days: { day: string; plan: UsageTotals; direct: UsageTotals }[];
  /** Per progetto (null = run fuori da un progetto), dal più caro. */
  projects: {
    id: string | null;
    name: string;
    runs: number;
    done: number;
    failed: number;
    usage: UsageTotals;
  }[];
  /** Passi agent sommati per workflow e passo, dal più caro. */
  steps: { workflow: string; stepId: string; title: string; runs: number; usage: UsageTotals }[];
}
