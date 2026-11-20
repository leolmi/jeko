import { Type, type Static } from '@sinclair/typebox';
import { PolicyActionSchema } from './schema.js';

/**
 * Modalità di esecuzione:
 * - headless: si ferma solo ai gate `always` (e se manca un input obbligatorio);
 * - checkpoint: si ferma a tutti i gate e ai passi `ask`;
 * - interactive: come checkpoint, e dopo ogni passo `agent` chiede una revisione.
 */
export const RunModeSchema = Type.Union([
  Type.Literal('headless'),
  Type.Literal('checkpoint'),
  Type.Literal('interactive'),
]);
export type RunMode = Static<typeof RunModeSchema>;

export const RunStatusSchema = Type.Union([
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

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
  }),
  Type.Object({
    ...runId,
    type: Type.Literal('step.finished'),
    stepId: Type.String(),
    ok: Type.Boolean(),
    output: Type.String(),
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
