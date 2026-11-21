import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { EFFORTS, MODEL_ALIASES, type AgentChoice, type Effort } from '@jeko/shared';
import { I18n } from '../core/i18n';

/** Nome mostrato di un modello: gli alias con l'iniziale maiuscola, gli altri come sono. */
const modelLabel = (m: string) =>
  (MODEL_ALIASES as readonly string[]).includes(m) ? m[0]!.toUpperCase() + m.slice(1) : m;

/**
 * Scelta di ragionamento e modello di claude. La voce vuota lascia il valore di `inherited`
 * (quello del progetto) o, senza, quello predefinito di claude.
 */
@Component({
  selector: 'jk-agent-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex flex-wrap items-center gap-2' },
  template: `
    <select
      class="jk-input w-auto"
      [class]="compact() ? 'py-1 text-xs' : 'text-sm'"
      [attr.aria-label]="i18n.t('agent.effort')"
      [title]="i18n.t('agent.effort')"
      (change)="setEffort($any($event.target).value)"
    >
      <option value="" [selected]="!value().effort">{{ empty().effort }}</option>
      @for (e of efforts; track e) {
        <option [value]="e" [selected]="value().effort === e">
          {{ effortLabel(e) }}
        </option>
      }
    </select>
    <select
      class="jk-input w-auto"
      [class]="compact() ? 'py-1 text-xs' : 'text-sm'"
      [attr.aria-label]="i18n.t('agent.model')"
      [title]="i18n.t('agent.model')"
      (change)="setModel($any($event.target).value)"
    >
      <option value="" [selected]="!value().model">{{ empty().model }}</option>
      @for (m of models(); track m) {
        <option [value]="m" [selected]="value().model === m">{{ label(m) }}</option>
      }
    </select>
  `,
})
export class AgentChoiceSelect {
  protected readonly i18n = inject(I18n);
  readonly value = model.required<AgentChoice>();
  /** Valori che la voce vuota lascia (del progetto). */
  readonly inherited = input<AgentChoice | undefined>();
  readonly compact = input(false);

  protected readonly efforts = EFFORTS;
  protected readonly label = modelLabel;
  /** Gli alias, più un modello già scelto che non lo è. */
  protected readonly models = computed(() => {
    const extra = [this.value().model, this.inherited()?.model].filter(
      (m): m is string => !!m && !(MODEL_ALIASES as readonly string[]).includes(m),
    );
    return [...MODEL_ALIASES, ...new Set(extra)];
  });
  protected readonly empty = computed(() => {
    const p = this.inherited();
    return {
      effort: p?.effort
        ? this.i18n.t('agent.inherit', { v: this.effortLabel(p.effort) })
        : this.i18n.t('agent.effort.default'),
      model: p?.model
        ? this.i18n.t('agent.inherit', { v: modelLabel(p.model) })
        : this.i18n.t('agent.model.default'),
    };
  });

  protected effortLabel(e: Effort): string {
    return this.i18n.t(`agent.effort.${e}`);
  }

  protected setEffort(v: string): void {
    const { effort: _, ...rest } = this.value();
    this.value.set(v ? { ...rest, effort: v as Effort } : rest);
  }

  protected setModel(v: string): void {
    const { model: _, ...rest } = this.value();
    this.value.set(v ? { ...rest, model: v } : rest);
  }
}
