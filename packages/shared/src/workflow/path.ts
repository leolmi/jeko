import { Type, type Static } from '@sinclair/typebox';
import { DIRECT_FOLLOW_UP, DIRECT_WORKFLOW } from './direct.js';
import type { RunState } from './run.js';
import type { Workflow } from './schema.js';

/** Un pallino del percorso di una run: un passo del workflow o un turno di un task diretto. */
export const StepMarkSchema = Type.Union([
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('current'),
  Type.Literal('pending'),
]);
export type StepMark = Static<typeof StepMarkSchema>;

const ACTIVE = ['queued', 'running', 'waiting'];
const FAILED = ['failed', 'rejected'];

interface PathInput {
  workflow: string;
  status: string;
  definition: Workflow | null;
  state: RunState | null;
  /** Richieste all'utente: una domanda di seguito in attesa vuol dire nessun turno in corso. */
  prompts?: { status: string; prompt: { stepId?: string } }[];
}

/**
 * Percorso della run per l'elenco dei task. Workflow: un pallino per passo, fatto, fallito o
 * saltato fino al passo attuale e da fare dopo. Task diretto: un pallino per turno eseguito,
 * più quello in corso.
 */
export function runPath({ workflow, status, definition, state, prompts }: PathInput): StepMark[] {
  const results = state?.steps ?? {};
  const active = ACTIVE.includes(status);
  if (workflow === DIRECT_WORKFLOW) {
    const marks = Object.entries(results)
      .map(([id, r]) => ({ n: Number(id.split('-')[1] ?? 1), r }))
      .sort((a, b) => a.n - b.n)
      .map(({ r }): StepMark => (r.ok ? 'done' : 'failed'));
    const waiting = prompts?.some(
      (p) => p.status === 'pending' && p.prompt.stepId === DIRECT_FOLLOW_UP,
    );
    if (active && !waiting) marks.push('current');
    else if (FAILED.includes(status) && !marks.includes('failed')) marks.push('failed');
    return marks;
  }
  const steps = definition?.steps ?? [];
  const index = state?.stepIndex ?? 0;
  return steps.map((step, i): StepMark => {
    const r = results[step.id];
    if (i === index && active) return 'current';
    if (i === index && FAILED.includes(status) && !r?.ok) return 'failed';
    if (r) return r.ok ? 'done' : 'failed';
    return i < index ? 'skipped' : 'pending';
  });
}
