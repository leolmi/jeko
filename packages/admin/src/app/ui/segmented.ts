import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { Icon, type IconName } from './icon';

export interface SegmentOption<T extends string> {
  value: T;
  /** Vuota: solo icona (serve allora `hint`, usato anche come etichetta accessibile). */
  label: string;
  icon?: IconName;
  hint?: string;
}

/** Scelta fra poche opzioni, come gruppo di radio accessibile. */
@Component({
  selector: 'jk-segmented',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="inline-flex rounded-lg bg-subtle p-0.5"
      role="radiogroup"
      [attr.aria-label]="label()"
    >
      @for (o of options(); track o.value) {
        <button
          type="button"
          role="radio"
          class="flex items-center gap-1.5 rounded-md text-sm transition-colors"
          [class]="
            (o.label ? 'px-3 py-1.5 ' : 'p-1.5 ') +
            (o.value === value() ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')
          "
          [attr.aria-checked]="o.value === value()"
          [attr.aria-label]="o.label ? null : (o.hint ?? null)"
          [attr.title]="o.hint ?? null"
          (click)="value.set(o.value)"
        >
          @if (o.icon) {
            <jk-icon [name]="o.icon" [size]="16" />
          }
          {{ o.label }}
        </button>
      }
    </div>
  `,
})
export class Segmented<T extends string> {
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly label = input.required<string>();
  readonly value = model.required<T>();
}
