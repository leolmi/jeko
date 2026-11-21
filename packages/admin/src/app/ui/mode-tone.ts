import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DIRECT_WORKFLOW } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Icon, type IconName } from './icon';

/**
 * Colori delle due modalità dei task, segui workflow (blu) e richiesta libera (ambra):
 * bordo e pulsanti della chat, etichette e pallini dei task.
 */
export const TONES = {
  plan: {
    icon: 'account_tree' as IconName,
    label: 'composer.plan' as I18nKey,
    hint: 'composer.plan.hint' as I18nKey,
    border:
      'border-sky-300 focus-within:border-sky-500 dark:border-sky-800 dark:focus-within:border-sky-500',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
    active: 'bg-sky-600 text-white shadow-sm dark:bg-sky-500',
    dot: 'bg-sky-500',
    ring: 'ring-sky-500/40',
    ringBorder: 'border-sky-500',
    /** Segni dei grafici (tonalità verificate su sfondo chiaro e scuro). */
    fill: 'fill-sky-600',
    swatch: 'bg-sky-600',
  },
  direct: {
    icon: 'flash_on' as IconName,
    label: 'composer.direct' as I18nKey,
    hint: 'composer.direct.hint' as I18nKey,
    border:
      'border-amber-300 focus-within:border-amber-500 dark:border-amber-800 dark:focus-within:border-amber-500',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
    active: 'bg-amber-500 text-white shadow-sm dark:bg-amber-500',
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/40',
    ringBorder: 'border-amber-500',
    fill: 'fill-amber-600',
    swatch: 'bg-amber-600',
  },
} as const;

export type Tone = (typeof TONES)[keyof typeof TONES];

/** Colori del task: richiesta libera se gira sul workflow interno dei task diretti. */
export const runTone = (r: { workflow: string }): Tone =>
  r.workflow === DIRECT_WORKFLOW ? TONES.direct : TONES.plan;

/** Etichetta della modalità, con icona e colore. */
@Component({
  selector: 'jk-mode-badge',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide whitespace-nowrap uppercase"
      [class]="tone().badge"
      [title]="i18n.t(tone().hint)"
    >
      <jk-icon [name]="tone().icon" [size]="14" />
      {{ i18n.t(tone().label) }}
    </span>
  `,
})
export class ModeBadge {
  protected readonly i18n = inject(I18n);
  readonly tone = input.required<Tone>();
}
