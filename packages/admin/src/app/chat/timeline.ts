import {
  FINAL_STATUSES,
  type PolicyAction,
  type PromptRecord,
  type RunDetail,
  type RunStatus,
} from '@jeko/shared';

export type TimelineItem =
  | { kind: 'request'; key: string; text: string; at: string }
  | {
      kind: 'step';
      key: string;
      stepId: string;
      state: 'running' | 'ok' | 'failed' | 'skipped';
      output?: string;
      at: string;
    }
  | {
      kind: 'policy';
      key: string;
      stepId: string;
      actions: PolicyAction[];
      command: string;
      approved: boolean;
      at: string;
    }
  | { kind: 'prompt'; key: string; record: PromptRecord; at: string }
  | { kind: 'finished'; key: string; status: RunStatus; error?: string; at: string };

type StepItem = Extract<TimelineItem, { kind: 'step' }>;

/**
 * Racconto di una run in ordine di tempo: la richiesta, i passi (avvio e fine nella stessa
 * voce), i permessi, le richieste all'utente e la conclusione. Gli eventi `state` non si vedono.
 */
export function buildTimeline(run: RunDetail): TimelineItem[] {
  const items: TimelineItem[] = [
    { kind: 'request', key: 'request', text: run.request, at: run.createdAt },
  ];
  /** Voce del passo ancora aperto, per stepId. */
  const open = new Map<string, StepItem>();

  type Entry = { at: string; order: number; add: () => void };
  const entries: Entry[] = [];

  for (const { seq, event, at } of run.events) {
    const key = `e${seq}`;
    entries.push({
      at,
      order: 0,
      add: () => {
        switch (event.type) {
          case 'step.started': {
            const item: StepItem = {
              kind: 'step',
              key,
              stepId: event.stepId,
              state: 'running',
              at,
            };
            open.set(event.stepId, item);
            items.push(item);
            return;
          }
          case 'step.finished': {
            const item = open.get(event.stepId);
            if (item) {
              item.state = event.ok ? 'ok' : 'failed';
              if (event.output) item.output = event.output;
              open.delete(event.stepId);
            } else {
              items.push({
                kind: 'step',
                key,
                stepId: event.stepId,
                state: event.ok ? 'ok' : 'failed',
                ...(event.output && { output: event.output }),
                at,
              });
            }
            return;
          }
          case 'step.skipped':
            items.push({ kind: 'step', key, stepId: event.stepId, state: 'skipped', at });
            return;
          case 'policy.gate':
            items.push({
              kind: 'policy',
              key,
              stepId: event.stepId,
              actions: event.actions,
              command: event.command,
              approved: event.approved,
              at,
            });
            return;
          case 'run.finished':
            items.push({
              kind: 'finished',
              key,
              status: event.status,
              ...(event.error !== undefined && { error: event.error }),
              at,
            });
            return;
          default:
            return;
        }
      },
    });
  }
  // A run conclusa le richieste rimaste aperte non valgono più (il server le chiude da sé).
  const ended = FINAL_STATUSES.includes(run.status);
  for (const original of run.prompts) {
    const record =
      ended && original.status === 'pending'
        ? { ...original, status: 'superseded' as const }
        : original;
    entries.push({
      at: record.createdAt,
      order: 1,
      add: () => items.push({ kind: 'prompt', key: record.id, record, at: record.createdAt }),
    });
  }

  // Ordinamento stabile: a parità di istante prima gli eventi, poi le richieste.
  entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order || a.i - b.i)
    .forEach((e) => e.add());

  // Una richiesta di un passo arriva dopo il suo avvio: la conclusione resta in fondo.
  const fin = items.findIndex((i) => i.kind === 'finished');
  if (fin >= 0 && fin < items.length - 1) items.push(...items.splice(fin, 1));
  return items;
}
