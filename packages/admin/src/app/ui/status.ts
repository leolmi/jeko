import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { RunRowStatus } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';

const LOOK: Record<RunRowStatus, { dot: string; text: string }> = {
  queued: { dot: 'bg-faint', text: 'text-muted' },
  running: { dot: 'bg-sky-500 animate-pulse', text: 'text-sky-700 dark:text-sky-400' },
  waiting: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  done: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  failed: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  rejected: { dot: 'bg-red-400', text: 'text-red-700 dark:text-red-400' },
  cancelled: { dot: 'bg-faint', text: 'text-muted' },
};

@Component({
  selector: 'jk-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap' },
  template: `
    <span class="size-1.5 rounded-full" [class]="look().dot"></span>
    <span [class]="look().text">{{ label() }}</span>
  `,
})
export class Status {
  private readonly i18n = inject(I18n);
  readonly status = input.required<RunRowStatus>();
  protected readonly look = computed(() => LOOK[this.status()]);
  protected readonly label = computed(() => this.i18n.t(`status.${this.status()}` as I18nKey));
}
