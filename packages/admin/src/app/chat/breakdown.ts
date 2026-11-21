import { addUsage, totalTokens, type AgentUsage } from '@jeko/shared';
import type { TimelineItem } from './timeline';

/** Quota di un passo nel consumo della run. */
export interface StepShare {
  stepId: string;
  title: string;
  /** Volte che il passo ha girato (es. correzioni ripetute). */
  runs: number;
  usage: AgentUsage;
  /** Costo (USD) o token, secondo `Breakdown.measure`. */
  value: number;
  /** 0…1 sul totale. */
  share: number;
}

export interface Breakdown {
  /** Costo stimato se claude l'ha dato per tutti i passi, altrimenti token totali. */
  measure: 'cost' | 'tokens';
  total: number;
  steps: StepShare[];
}

/**
 * Dove ha speso la run: consumo dei passi agent sommato per passo, dal più caro.
 * Null con meno di due passi da confrontare.
 */
export function buildBreakdown(items: readonly TimelineItem[]): Breakdown | null {
  const byStep = new Map<string, { title: string; runs: number; usage: AgentUsage }>();
  for (const item of items) {
    if (item.kind !== 'step' || !item.usage) continue;
    const prev = byStep.get(item.stepId);
    byStep.set(item.stepId, {
      title: item.title ?? item.stepId,
      runs: (prev?.runs ?? 0) + 1,
      usage: addUsage(prev?.usage, item.usage),
    });
  }
  if (byStep.size < 2) return null;
  const all = [...byStep.values()];
  const measure = all.every((s) => s.usage.costUsd !== undefined) ? 'cost' : 'tokens';
  const value = (u: AgentUsage) => (measure === 'cost' ? (u.costUsd ?? 0) : totalTokens(u));
  const total = all.reduce((n, s) => n + value(s.usage), 0);
  if (total <= 0) return null;
  const steps = [...byStep].map(([stepId, s]) => ({
    stepId,
    ...s,
    value: value(s.usage),
    share: value(s.usage) / total,
  }));
  steps.sort((a, b) => b.value - a.value);
  return { measure, total, steps };
}
