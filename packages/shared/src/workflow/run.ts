import { Type, type Static } from '@sinclair/typebox';
import { PolicyActionSchema, RunModeSchema } from './schema.js';

export const RunStatusSchema = Type.Union([
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

/** Consumo di un turno di claude (dal messaggio `result` dello stream-json), o la somma di più turni. */
export const AgentUsageSchema = Type.Object({
  /** Durata del lavoro di claude (ms). */
  durationMs: Type.Number({ minimum: 0 }),
  inputTokens: Type.Number({ minimum: 0 }),
  outputTokens: Type.Number({ minimum: 0 }),
  cacheReadTokens: Type.Number({ minimum: 0 }),
  cacheWriteTokens: Type.Number({ minimum: 0 }),
  /** Costo stimato da claude (USD), se lo indica. */
  costUsd: Type.Optional(Type.Number({ minimum: 0 })),
  /** Turni di claude sommati. */
  turns: Type.Integer({ minimum: 0 }),
});
export type AgentUsage = Static<typeof AgentUsageSchema>;

/** Somma di due consumi (`a` può mancare). */
export function addUsage(a: AgentUsage | undefined, b: AgentUsage): AgentUsage {
  if (!a) return b;
  const cost =
    a.costUsd !== undefined || b.costUsd !== undefined
      ? { costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) }
      : {};
  return {
    durationMs: a.durationMs + b.durationMs,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    ...cost,
    turns: a.turns + b.turns,
  };
}

/** Token totali di un consumo (input, cache e output). */
export const totalTokens = (u: AgentUsage) =>
  u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

export const StepResultSchema = Type.Object({ ok: Type.Boolean(), output: Type.String() });
export type StepResult = Static<typeof StepResultSchema>;

/** Stato di una run: basta per riprenderla dal passo in cui si era fermata. */
export const RunStateSchema = Type.Object({
  stepIndex: Type.Integer({ minimum: 0 }),
  values: Type.Record(Type.String(), Type.Unknown()),
  retries: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  steps: Type.Record(Type.String(), StepResultSchema),
  sessionId: Type.Optional(Type.String()),
  /** Turni di claude avviati: con il passo identifica un turno anche dopo un riavvio. */
  turns: Type.Optional(Type.Integer({ minimum: 0 })),
  lastFailure: Type.Optional(Type.String()),
  /** Consumo dei turni di claude della run, sommato. */
  usage: Type.Optional(AgentUsageSchema),
});
export type RunState = Static<typeof RunStateSchema>;

const runId = { runId: Type.String({ minLength: 1 }) };

export const RunEventSchema = Type.Union([
  Type.Object({
    ...runId,
    type: Type.Literal('run.started'),
    workflow: Type.String(),
    version: Type.Integer(),
    mode: RunModeSchema,
  }),
  Type.Object({
    ...runId,
    type: Type.Literal('step.started'),
    stepId: Type.String(),
    index: Type.Integer(),
    /** Titolo del passo nel workflow, se c'è: è ciò che si mostra nel filo. */
    title: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...runId,
    type: Type.Literal('step.skipped'),
    stepId: Type.String(),
    title: Type.Optional(Type.String()),
    /** Perché si salta, se non è la condizione `when` (es. prompt del progetto assente). */
    note: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...runId,
    type: Type.Literal('step.finished'),
    stepId: Type.String(),
    ok: Type.Boolean(),
    output: Type.String(),
    /** Passi agent: consumo dei turni di claude del passo. */
    usage: Type.Optional(AgentUsageSchema),
    /** Passi agent senza modello scelto: quello predefinito di claude (dall'`init`). */
    defaultModel: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...runId,
    type: Type.Literal('policy.gate'),
    stepId: Type.String(),
    actions: Type.Array(PolicyActionSchema),
    command: Type.String(),
    approved: Type.Boolean(),
  }),
  /** Avanzamento di un passo agent: testo di claude o strumento usato (con un riassunto). */
  Type.Object({
    ...runId,
    type: Type.Literal('agent.activity'),
    stepId: Type.String(),
    kind: Type.Union([Type.Literal('text'), Type.Literal('tool')]),
    tool: Type.Optional(Type.String()),
    text: Type.String(),
  }),
  Type.Object({ ...runId, type: Type.Literal('state'), state: RunStateSchema }),
  Type.Object({
    ...runId,
    type: Type.Literal('run.finished'),
    status: RunStatusSchema,
    error: Type.Optional(Type.String()),
  }),
]);
export type RunEvent = Static<typeof RunEventSchema>;
