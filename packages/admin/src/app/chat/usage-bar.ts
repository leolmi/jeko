import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18n } from '../core/i18n';
import type { Breakdown, StepShare } from './breakdown';

/** Colori dei passi, nell'ordine della quota (blu e ambra restano alle modalità). */
const COLORS = [
  'bg-violet-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-indigo-400',
  'bg-teal-400',
  'bg-fuchsia-400',
  'bg-lime-500',
];
const OTHER = 'bg-zinc-400 dark:bg-zinc-500';

/** Dove ha speso la run: una barra divisa per passo, con la legenda. */
@Component({
  selector: 'jk-usage-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let b = breakdown();
    <div class="flex items-center gap-3">
      <span class="jk-label shrink-0">{{
        i18n.t(b.measure === 'cost' ? 'breakdown.title' : 'breakdown.tokens')
      }}</span>
      <div
        class="flex h-2.5 min-w-0 flex-1 gap-px overflow-hidden rounded-full bg-subtle"
        role="img"
        [attr.aria-label]="summary(b)"
      >
        @for (s of b.steps; track s.stepId; let i = $index) {
          <span
            class="h-full"
            [class]="color(i)"
            [style.width.%]="s.share * 100"
            [title]="label(s, b)"
          ></span>
        }
      </div>
      <span class="shrink-0 font-mono text-xs text-muted">{{ amount(b.total, b) }}</span>
    </div>
    <ul class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      @for (s of b.steps; track s.stepId; let i = $index) {
        <li class="flex cursor-help items-center gap-1.5" [title]="i18n.usage(s.usage).detail">
          <span class="size-2 rounded-full" [class]="color(i)"></span>
          <span class="text-fg">{{ s.title }}</span>
          @if (s.runs > 1) {
            <span class="text-faint">×{{ s.runs }}</span>
          }
          <span class="font-mono">{{ percent(s.share) }}</span>
          <span class="font-mono text-faint">{{ amount(s.value, b) }}</span>
        </li>
      }
    </ul>
  `,
})
export class UsageBar {
  protected readonly i18n = inject(I18n);
  readonly breakdown = input.required<Breakdown>();

  protected color(i: number): string {
    return COLORS[i] ?? OTHER;
  }

  protected percent(share: number): string {
    return new Intl.NumberFormat(this.i18n.lang(), {
      style: 'percent',
      maximumFractionDigits: share < 0.1 ? 1 : 0,
    }).format(share);
  }

  protected amount(n: number, b: Breakdown): string {
    return b.measure === 'cost'
      ? new Intl.NumberFormat(this.i18n.lang(), {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: n < 1 ? 3 : 2,
        }).format(n)
      : this.i18n.t('usage.tokens', { n: this.i18n.compact(n) });
  }

  protected label(s: StepShare, b: Breakdown): string {
    return `${s.title}: ${this.percent(s.share)} · ${this.amount(s.value, b)}`;
  }

  protected summary(b: Breakdown): string {
    return b.steps.map((s) => this.label(s, b)).join(', ');
  }
}
