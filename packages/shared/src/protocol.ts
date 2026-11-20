import { Type, type Static } from '@sinclair/typebox';
import { Id, Timestamp } from './contract.js';
import { RunEventSchema, RunModeSchema, RunStateSchema } from './workflow/run.js';
import { PolicyActionSchema, WorkflowKindSchema, WorkflowSchema } from './workflow/schema.js';

// ---------- richieste all'utente durante una run ----------

export const PromptSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('ask'),
    stepId: Type.String(),
    question: Type.String(),
    required: Type.Boolean(),
    enum: Type.Optional(Type.Array(Type.String())),
    default: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal('approve'),
    stepId: Type.String(),
    message: Type.String(),
    reason: Type.Union([Type.Literal('gate'), Type.Literal('policy')]),
    actions: Type.Optional(Type.Array(PolicyActionSchema)),
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

// ---------- WebSocket runner ↔ server ----------

export const RunnerToServerSchema = Type.Union([
  Type.Object({
    type: Type.Literal('hello'),
    runnerId: Type.String({ minLength: 1 }),
    version: Type.String(),
    /** Run ancora vive nel runner (dopo una riconnessione). */
    activeRuns: Type.Array(Type.String()),
  }),
  /** Evento dal giornale del runner: `seq` cresce per run, senza buchi; il server lo conferma. */
  Type.Object({
    type: Type.Literal('run.event'),
    seq: Type.Integer({ minimum: 1 }),
    event: RunEventSchema,
  }),
  /** Fine del reinvio dopo `hello`: ora il server può (ri)avviare le run. */
  Type.Object({ type: Type.Literal('ready') }),
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
  /** Eventi salvati fino a `seq` compreso: il runner può toglierli dal giornale. */
  Type.Object({
    type: Type.Literal('run.ack'),
    runId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
  }),
]);
export type ServerToRunner = Static<typeof ServerToRunnerSchema>;

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
    workflow: Type.String({ minLength: 1 }),
    version: Type.Optional(Type.Integer({ minimum: 1 })),
    request: Type.String({ minLength: 1 }),
    mode: RunModeSchema,
    inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type StartRun = Static<typeof StartRunSchema>;

export const RunSummarySchema = Type.Object({
  id: Id,
  workflow: Type.String(),
  version: Type.Integer(),
  request: Type.String(),
  mode: RunModeSchema,
  status: RunRowStatusSchema,
  error: Type.Union([Type.String(), Type.Null()]),
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

// ---------- WebSocket admin (solo server → admin) ----------

export type AdminMessage =
  | { type: 'runner'; connected: boolean; runnerId?: string }
  | { type: 'run.status'; runId: string; status: RunRowStatus; error: string | null }
  | { type: 'run.event'; runId: string; record: RunEventRecord }
  | { type: 'run.prompt'; runId: string; prompt: PromptRecord };
