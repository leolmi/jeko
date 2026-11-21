import {
  DIRECT_FOLLOW_UP,
  FINAL_STATUSES,
  type PolicyAction,
  type PromptRecord,
  type RunDetail,
  type RunStatus,
} from '@jeko/shared';

/** Cosa ha fatto claude durante un passo agent. */
export interface Activity {
  key: string;
  kind: 'text' | 'tool';
  tool?: string;
  text: string;
}

export type TimelineItem =
  | { kind: 'request'; key: string; text: string; at: string }
  | {
      kind: 'step';
      key: string;
      stepId: string;
      title?: string;
      state: 'running' | 'ok' | 'failed' | 'skipped';
      output?: string;
      activity: Activity[];
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
  | { kind: 'prompt'; key: string; record: PromptRecord; stepTitle?: string; at: string }
  | { kind: 'finished'; key: string; status: RunStatus; error?: string; at: string };

type StepItem = Extract<TimelineItem, { kind: 'step' }>;

/**
 * Racconto di una run in ordine di tempo: la richiesta, i passi (avvio e fine nella stessa
 * voce, con l'attività di claude), i permessi, le richieste all'utente e la conclusione. Gli eventi `state` non si vedono.
 */
export function buildTimeline(run: RunDetail): TimelineItem[] {
  const items: TimelineItem[] = [
    { kind: 'request', key: 'request', text: run.request, at: run.createdAt },
  ];
  /** Voce del passo ancora aperto, per stepId. */
  const open = new Map<string, StepItem>();
  /** Titoli dei passi visti negli eventi, per le richieste all'utente. */
  const titles = new Map<string, string>();
  for (const { event } of run.events) {
    if ((event.type === 'step.started' || event.type === 'step.skipped') && event.title)
      titles.set(event.stepId, event.title);
  }
  const title = (stepId: string) => {
    const t = titles.get(stepId);
    return t !== undefined ? { title: t } : {};
  };

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
              ...title(event.stepId),
              state: 'running',
              activity: [],
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
                ...title(event.stepId),
                state: event.ok ? 'ok' : 'failed',
                ...(event.output && { output: event.output }),
                activity: [],
                at,
              });
            }
            return;
          }
          case 'step.skipped': {
            // Il passo può essere già partito (es. prompt del progetto assente): si chiude lì.
            const note = event.note !== undefined && { output: event.note };
            const item = open.get(event.stepId);
            if (item) {
              item.state = 'skipped';
              Object.assign(item, note);
              open.delete(event.stepId);
              return;
            }
            items.push({
              kind: 'step',
              key,
              stepId: event.stepId,
              ...title(event.stepId),
              state: 'skipped',
              ...note,
              activity: [],
              at,
            });
            return;
          }
          case 'agent.activity':
            open.get(event.stepId)?.activity.push({
              key,
              kind: event.kind,
              ...(event.tool !== undefined && { tool: event.tool }),
              text: event.text,
            });
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
    // Task diretto: il messaggio seguente è una richiesta dell'utente, non una domanda.
    if (record.prompt.stepId === DIRECT_FOLLOW_UP) {
      const text = record.answer?.kind === 'ask' ? record.answer.value : null;
      if (text)
        entries.push({
          at: record.createdAt,
          order: 1,
          add: () => items.push({ kind: 'request', key: record.id, text, at: record.createdAt }),
        });
      continue;
    }
    entries.push({
      at: record.createdAt,
      order: 1,
      add: () => {
        const t = titles.get(record.prompt.stepId);
        items.push({
          kind: 'prompt',
          key: record.id,
          record,
          ...(t !== undefined && { stepTitle: t }),
          at: record.createdAt,
        });
      },
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
