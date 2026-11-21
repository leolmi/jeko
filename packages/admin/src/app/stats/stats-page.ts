import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { DIRECT_WORKFLOW, type Stats, type UsageTotals } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { TONES } from '../ui/mode-tone';
import { Segmented, type SegmentOption } from '../ui/segmented';

type Period = '7' | '30' | '90' | 'all';
type Metric = 'cost' | 'tokens' | 'runs';

/** Il costo è già nella valuta scelta (`rate` da USD). */
const value = (u: UsageTotals, m: Metric, rate: number) =>
  m === 'cost' ? u.costUsd * rate : m === 'tokens' ? u.tokens : u.runs;

/**
 * Statistiche delle run presenti, del progetto scelto o di tutti: totali, andamento giorno
 * per giorno (segui workflow e richiesta libera), consumo per progetto e passi più cari.
 */
@Component({
  selector: 'jk-stats-page',
  imports: [Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-5xl px-6 py-5">
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-xl font-semibold tracking-tight">{{ i18n.t('stats.title') }}</h2>
          <p class="mt-0.5 text-xs text-faint">{{ i18n.t('stats.hint') }}</p>
        </div>
        <select
          class="jk-input w-auto text-sm"
          [attr.aria-label]="i18n.t('stats.project')"
          [value]="project()"
          (change)="project.set($any($event.target).value)"
        >
          <option value="">{{ i18n.t('stats.allProjects') }}</option>
          @for (p of projects.views(); track p.id) {
            <option [value]="p.id" [selected]="p.id === project()">{{ p.name }}</option>
          }
        </select>
        <jk-segmented [label]="i18n.t('stats.period')" [options]="periods()" [(value)]="period" />
      </div>

      @if (stats.error()) {
        <p class="mt-6 text-sm text-red-600 dark:text-red-400">{{ i18n.t('stats.error') }}</p>
      } @else if (data(); as s) {
        @let t = s.totals;
        @let all = sum(t.plan, t.direct);
        <!-- Totali -->
        <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="rounded-xl border border-line bg-surface p-4">
            <p class="jk-label">{{ i18n.t('stats.tasks') }}</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">{{ i18n.number(t.runs) }}</p>
            <p class="mt-1 text-xs text-faint">
              {{
                i18n.t('stats.tasks.detail', {
                  done: t.byStatus.done ?? 0,
                  failed: t.byStatus.failed ?? 0,
                  other: t.runs - (t.byStatus.done ?? 0) - (t.byStatus.failed ?? 0),
                })
              }}
            </p>
          </div>
          <div class="rounded-xl border border-line bg-surface p-4">
            <p class="jk-label">{{ i18n.t('stats.cost') }}</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">{{ usd(all.costUsd) }}</p>
            <p class="mt-1 text-xs text-faint">
              {{
                i18n.t('stats.split', { plan: usd(t.plan.costUsd), direct: usd(t.direct.costUsd) })
              }}
            </p>
          </div>
          <div class="rounded-xl border border-line bg-surface p-4">
            <p class="jk-label">{{ i18n.t('stats.tokens') }}</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">{{ i18n.compact(all.tokens) }}</p>
            <p class="mt-1 text-xs text-faint">
              {{
                i18n.t('stats.split', {
                  plan: i18n.compact(t.plan.tokens),
                  direct: i18n.compact(t.direct.tokens),
                })
              }}
            </p>
          </div>
          <div class="rounded-xl border border-line bg-surface p-4">
            <p class="jk-label">{{ i18n.t('stats.time') }}</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums">
              {{ i18n.duration(all.durationMs) }}
            </p>
            <p class="mt-1 text-xs text-faint">
              {{
                i18n.t('stats.split', {
                  plan: i18n.duration(t.plan.durationMs),
                  direct: i18n.duration(t.direct.durationMs),
                })
              }}
            </p>
          </div>
        </div>

        @if (t.runs === 0) {
          <p class="mt-6 text-sm text-faint">{{ i18n.t('stats.empty') }}</p>
        } @else {
          <!-- Andamento -->
          <section class="mt-4 rounded-xl border border-line bg-surface p-4">
            <div class="flex flex-wrap items-center gap-3">
              <p class="text-sm font-medium">{{ i18n.t('stats.trend') }}</p>
              <span class="flex items-center gap-3 text-xs text-muted">
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm" [class]="TONES.plan.swatch"></span>
                  {{ i18n.t('composer.plan') }}
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-sm" [class]="TONES.direct.swatch"></span>
                  {{ i18n.t('composer.direct') }}
                </span>
              </span>
              <jk-segmented
                class="ml-auto"
                [label]="i18n.t('stats.metric')"
                [options]="metrics()"
                [(value)]="metric"
              />
            </div>
            @let chart = trend();
            <div class="mt-4 flex gap-2">
              <div
                class="flex w-14 shrink-0 flex-col justify-between text-right font-mono text-[10px] text-faint"
              >
                <span>{{ format(chart.max) }}</span>
                <span>{{ format(chart.max / 2) }}</span>
                <span>0</span>
              </div>
              <div class="relative h-44 min-w-0 flex-1">
                <div class="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                  <span class="h-px bg-line"></span>
                  <span class="h-px bg-line/60"></span>
                  <span class="h-px bg-line"></span>
                </div>
                <div class="absolute inset-0 flex items-end gap-px" role="list">
                  @for (d of chart.days; track d.day) {
                    <div
                      class="group flex h-full min-w-0 flex-1 cursor-default flex-col-reverse gap-0.5 rounded-sm hover:bg-subtle"
                      role="listitem"
                      [title]="d.label"
                      [attr.aria-label]="d.label"
                    >
                      @if (d.plan > 0) {
                        <span
                          class="w-full shrink-0"
                          [class]="TONES.plan.swatch"
                          [class.rounded-t-sm]="d.direct === 0"
                          [style.height.%]="d.plan"
                        ></span>
                      }
                      @if (d.direct > 0) {
                        <span
                          class="w-full shrink-0 rounded-t-sm"
                          [class]="TONES.direct.swatch"
                          [style.height.%]="d.direct"
                        ></span>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
            <div class="mt-1 ml-16 flex justify-between font-mono text-[10px] text-faint">
              <span>{{ chart.first }}</span>
              <span>{{ chart.last }}</span>
            </div>
          </section>

          <!-- Per progetto -->
          @if (!project() && s.projects.length) {
            @let top = s.projects[0]!.usage;
            <section class="mt-4 overflow-x-auto rounded-xl border border-line bg-surface p-4">
              <p class="text-sm font-medium">{{ i18n.t('stats.byProject') }}</p>
              <table class="mt-3 w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-faint">
                    <th class="pb-2 font-medium">{{ i18n.t('stats.col.project') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.col.tasks') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.col.done') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.col.failed') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.time') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.tokens') }}</th>
                    <th class="pb-2 text-right font-medium">{{ i18n.t('stats.cost') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  @for (p of s.projects; track p.id) {
                    <tr>
                      <td class="py-2 pr-3">
                        <span [class.text-faint]="!p.id">{{
                          p.id ? p.name : i18n.t('stats.noProject')
                        }}</span>
                        <span class="mt-1 block h-1 rounded-full bg-subtle">
                          <span
                            class="block h-1 rounded-full bg-muted"
                            [style.width.%]="share(p.usage, top)"
                          ></span>
                        </span>
                      </td>
                      <td class="py-2 text-right tabular-nums">{{ p.runs }}</td>
                      <td class="py-2 text-right tabular-nums">{{ p.done }}</td>
                      <td class="py-2 text-right tabular-nums">{{ p.failed }}</td>
                      <td class="py-2 text-right tabular-nums">
                        {{ i18n.duration(p.usage.durationMs) }}
                      </td>
                      <td class="py-2 text-right tabular-nums">
                        {{ i18n.compact(p.usage.tokens) }}
                      </td>
                      <td class="py-2 text-right tabular-nums">{{ usd(p.usage.costUsd) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          <!-- Passi più cari -->
          @if (steps().length) {
            @let top = steps()[0]!.usage;
            <section class="mt-4 rounded-xl border border-line bg-surface p-4">
              <p class="text-sm font-medium">{{ i18n.t('stats.steps') }}</p>
              <p class="mt-0.5 text-xs text-faint">{{ i18n.t('stats.steps.hint') }}</p>
              <ul class="mt-3 flex flex-col gap-2.5">
                @for (st of steps(); track st.workflow + st.stepId) {
                  <li
                    class="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm"
                    [title]="i18n.t('stats.steps.runs', { n: st.runs })"
                  >
                    <span class="min-w-0 truncate">
                      {{ st.title }}
                      <span class="font-mono text-xs text-faint">{{ st.workflow }}</span>
                    </span>
                    <span class="h-2 rounded-full bg-subtle">
                      <span
                        class="block h-2 rounded-full"
                        [class]="st.workflow === direct ? TONES.direct.swatch : TONES.plan.swatch"
                        [style.width.%]="share(st.usage, top)"
                      ></span>
                    </span>
                    <span class="font-mono text-xs text-muted tabular-nums">
                      {{ stepValue(st.usage) }}
                    </span>
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
    </div>
  `,
})
export class StatsPage {
  protected readonly i18n = inject(I18n);
  protected readonly projects = inject(Projects);
  protected readonly TONES = TONES;
  protected readonly direct = DIRECT_WORKFLOW;

  /** Progetto scelto ('' = tutti): di partenza quello attivo. */
  protected readonly project = linkedSignal(() => this.projects.active()?.id ?? '');
  protected readonly period = signal<Period>('30');
  protected readonly periods = computed((): SegmentOption<Period>[] => [
    { value: '7', label: this.i18n.t('stats.days', { n: 7 }) },
    { value: '30', label: this.i18n.t('stats.days', { n: 30 }) },
    { value: '90', label: this.i18n.t('stats.days', { n: 90 }) },
    { value: 'all', label: this.i18n.t('stats.all') },
  ]);

  protected readonly stats = httpResource<Stats>(() => {
    const params: Record<string, string> = {};
    if (this.project()) params['project'] = this.project();
    if (this.period() !== 'all') params['days'] = this.period();
    return { url: '/api/stats', params };
  });
  protected readonly data = computed(() => (this.stats.hasValue() ? this.stats.value() : null));

  /** Senza costi registrati si parte dai token. */
  protected readonly metric = linkedSignal<Metric>(() => {
    const t = this.data()?.totals;
    return t && t.plan.costUsd + t.direct.costUsd === 0 ? 'tokens' : 'cost';
  });
  protected readonly metrics = computed((): SegmentOption<Metric>[] => [
    { value: 'cost', label: this.i18n.t('stats.metric.cost') },
    { value: 'tokens', label: this.i18n.t('stats.metric.tokens') },
    { value: 'runs', label: this.i18n.t('stats.metric.runs') },
  ]);

  /** Colonne del grafico: altezze in % del massimo, con l'etichetta per il tooltip. */
  protected readonly trend = computed(() => {
    const s = this.data();
    const m = this.metric();
    const rate = this.i18n.rate();
    const days = s?.days ?? [];
    const max = Math.max(...days.map((d) => value(d.plan, m, rate) + value(d.direct, m, rate)), 0);
    const scale = max > 0 ? niceMax(max) : 1;
    const date = (day: string) => this.i18n.dayMonth(new Date(`${day}T12:00:00`));
    return {
      max: max > 0 ? scale : 0,
      first: days[0] ? date(days[0].day) : '',
      last: days.at(-1) ? date(days.at(-1)!.day) : '',
      days: days.map((d) => {
        const plan = value(d.plan, m, rate);
        const direct = value(d.direct, m, rate);
        return {
          day: d.day,
          plan: (plan / scale) * 100,
          direct: (direct / scale) * 100,
          label:
            `${date(d.day)} — ${this.i18n.t('composer.plan')}: ${this.format(plan)} · ` +
            `${this.i18n.t('composer.direct')}: ${this.format(direct)}`,
        };
      }),
    };
  });

  /** Passi più cari, al massimo dieci. */
  protected readonly steps = computed(() => (this.data()?.steps ?? []).slice(0, 10));
  private readonly costKnown = computed(() => {
    const t = this.data()?.totals;
    return !!t && t.plan.costUsd + t.direct.costUsd > 0;
  });

  protected format(n: number): string {
    const m = this.metric();
    if (m === 'cost') return this.money(n);
    if (m === 'tokens') return this.i18n.compact(n);
    return this.i18n.number(Math.round(n * 10) / 10);
  }

  /** Importo già convertito nella valuta scelta. */
  protected money(n: number): string {
    return this.i18n.money(n / this.i18n.rate());
  }

  protected usd(n: number): string {
    return this.i18n.money(n);
  }

  protected sum(a: UsageTotals, b: UsageTotals): UsageTotals {
    return {
      runs: a.runs + b.runs,
      durationMs: a.durationMs + b.durationMs,
      tokens: a.tokens + b.tokens,
      costUsd: a.costUsd + b.costUsd,
    };
  }

  /** Quota rispetto al primo della lista (il più caro), in %. */
  protected share(u: UsageTotals, top: UsageTotals): number {
    const k = this.costKnown() ? 'costUsd' : 'tokens';
    return top[k] > 0 ? (u[k] / top[k]) * 100 : 0;
  }

  protected stepValue(u: UsageTotals): string {
    return this.costKnown() ? this.usd(u.costUsd) : this.i18n.compact(u.tokens);
  }
}

/** Massimo dell'asse arrotondato a 1, 2 o 5 per una potenza di dieci. */
function niceMax(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((k) => k * p >= n) ?? 10) * p;
}
