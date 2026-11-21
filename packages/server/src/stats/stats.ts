import {
  DIRECT_WORKFLOW,
  folderKey,
  totalTokens,
  type AgentUsage,
  type Project,
  type RunDetail,
  type Stats,
  type UsageTotals,
} from '@jeko/shared';

const empty = (): UsageTotals => ({ runs: 0, durationMs: 0, tokens: 0, costUsd: 0 });

/** Aggiunge al totale un consumo (o solo la run, se non l'ha registrato). */
function add(t: UsageTotals, u: AgentUsage | null | undefined): void {
  t.runs += 1;
  if (!u) return;
  t.durationMs += u.durationMs;
  t.tokens += totalTokens(u);
  t.costUsd += u.costUsd ?? 0;
}

/** Giorno locale di un istante, YYYY-MM-DD. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Giorni da `from` a `to` compresi. */
function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  for (const day = new Date(y, m - 1, d); localDay(day) <= to; day.setDate(day.getDate() + 1))
    out.push(localDay(day));
  return out;
}

/** Il più caro prima: costo, poi token. */
const byCost = (a: { usage: UsageTotals }, b: { usage: UsageTotals }) =>
  b.usage.costUsd - a.usage.costUsd || b.usage.tokens - a.usage.tokens;

export interface StatsQuery {
  /** Solo le run di questo progetto. */
  project?: Project;
  /** Ultimi N giorni, oggi compreso; assente = tutto. */
  days?: number;
  now?: Date;
}

/**
 * Statistiche delle run presenti: totali, andamento giorno per giorno diviso fra segui
 * workflow e richiesta libera, consumo per progetto e per passo agent (dagli eventi).
 */
export function computeStats(
  all: readonly RunDetail[],
  projects: readonly Project[],
  q: StatsQuery = {},
): Stats {
  const now = q.now ?? new Date();
  const to = localDay(now);
  const start = q.days
    ? localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (q.days - 1)))
    : null;
  const key = q.project ? folderKey(q.project.path) : null;
  const runs = all.filter(
    (r) =>
      (!start || localDay(new Date(r.createdAt)) >= start) && (!key || folderKey(r.cwd) === key),
  );

  const totals: Stats['totals'] = {
    runs: runs.length,
    byStatus: {},
    plan: empty(),
    direct: empty(),
  };
  const first = runs.reduce<string | null>((min, r) => {
    const d = localDay(new Date(r.createdAt));
    return !min || d < min ? d : min;
  }, null);
  const days = new Map(
    dayRange(start ?? first ?? to, to).map((day) => [day, { day, plan: empty(), direct: empty() }]),
  );
  const projectOf = new Map(projects.map((p) => [folderKey(p.path), p]));
  const perProject = new Map<string | null, Stats['projects'][number]>();
  const perStep = new Map<string, Stats['steps'][number]>();

  for (const r of runs) {
    const kind = r.workflow === DIRECT_WORKFLOW ? 'direct' : 'plan';
    totals.byStatus[r.status] = (totals.byStatus[r.status] ?? 0) + 1;
    add(totals[kind], r.usage);
    const day = days.get(localDay(new Date(r.createdAt)));
    if (day) add(day[kind], r.usage);

    const p = projectOf.get(folderKey(r.cwd)) ?? null;
    const pid = p?.id ?? null;
    const row = perProject.get(pid) ?? {
      id: pid,
      name: p?.name ?? '',
      runs: 0,
      done: 0,
      failed: 0,
      usage: empty(),
    };
    row.runs += 1;
    if (r.status === 'done') row.done += 1;
    if (r.status === 'failed') row.failed += 1;
    add(row.usage, r.usage);
    row.usage.runs = row.runs;
    perProject.set(pid, row);

    const titles = new Map<string, string>();
    for (const { event } of r.events) {
      if (event.type === 'step.started' && event.title) titles.set(event.stepId, event.title);
      if (event.type !== 'step.finished' || !event.usage) continue;
      const k = `${r.workflow}\u0000${event.stepId}`;
      const s = perStep.get(k) ?? {
        workflow: r.workflow,
        stepId: event.stepId,
        title: titles.get(event.stepId) ?? event.stepId,
        runs: 0,
        usage: empty(),
      };
      add(s.usage, event.usage);
      s.runs = s.usage.runs;
      perStep.set(k, s);
    }
  }

  return {
    from: start,
    to,
    totals,
    days: [...days.values()],
    projects: [...perProject.values()].sort(byCost),
    steps: [...perStep.values()].sort(byCost),
  };
}
