import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  CURRENCIES,
  Formats,
  type Currency,
  type DateFormat,
  type TimeFormat,
} from '../core/formats';
import type { Formats as FormatPrefs } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';

/** Formati di data, ora e valuta, col cambio da USD per i costi. */
@Component({
  selector: 'jk-format-settings',
  imports: [Segmented, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block rounded-xl border border-line bg-surface p-4' },
  template: `
    <p class="text-sm font-medium">{{ i18n.t('formats.title') }}</p>
    <p class="mt-0.5 text-xs text-faint">{{ i18n.t('formats.hint') }}</p>

    <div class="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
      <span class="jk-label">{{ i18n.t('formats.date') }}</span>
      <jk-segmented
        [label]="i18n.t('formats.date')"
        [options]="dates()"
        [value]="f.date()"
        (valueChange)="save({ date: $event })"
      />

      <span class="jk-label">{{ i18n.t('formats.time') }}</span>
      <jk-segmented
        [label]="i18n.t('formats.time')"
        [options]="times()"
        [value]="f.time()"
        (valueChange)="save({ time: $event })"
      />

      <span class="jk-label">{{ i18n.t('formats.currency') }}</span>
      <jk-segmented
        [label]="i18n.t('formats.currency')"
        [options]="currencies"
        [value]="f.currency()"
        (valueChange)="setCurrency($event)"
      />

      @if (f.currency() !== 'USD') {
        <span class="jk-label">{{ i18n.t('formats.rate') }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <input
            class="jk-input w-28 text-right tabular-nums"
            type="number"
            min="0"
            step="0.0001"
            [attr.aria-label]="i18n.t('formats.rate') + ' ' + f.currency()"
            [value]="f.rates()[f.currency()] ?? ''"
            (change)="setRate($any($event.target).valueAsNumber)"
          />
          <span class="text-sm text-muted">{{ f.currency() }}</span>
          <button
            type="button"
            class="jk-btn-outline"
            [disabled]="fetching()"
            (click)="fetchRate()"
          >
            <jk-icon name="refresh" [size]="16" [class]="fetching() ? 'animate-spin' : ''" />
            {{ i18n.t('formats.rate.fetch') }}
          </button>
          @if (rateError()) {
            <span class="text-xs text-red-600 dark:text-red-400">{{
              i18n.t('formats.rate.error')
            }}</span>
          } @else if (!f.rates()[f.currency()]) {
            <span class="text-xs text-faint">{{ i18n.t('formats.rate.missing') }}</span>
          }
        </div>
      }
    </div>

    <p class="mt-3 text-xs text-faint tabular-nums">{{ example() }}</p>
    @if (saveError()) {
      <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ i18n.t('settings.error') }}</p>
    }
  `,
})
export class FormatSettings {
  protected readonly i18n = inject(I18n);
  protected readonly f = inject(Formats);
  protected readonly fetching = signal(false);
  protected readonly rateError = signal(false);
  protected readonly saveError = signal(false);

  protected readonly dates = computed((): SegmentOption<DateFormat>[] => {
    const [d, y] = this.i18n.lang() === 'it' ? ['gg', 'aaaa'] : ['dd', 'yyyy'];
    return [
      { value: 'auto', label: this.i18n.t('formats.auto') },
      { value: 'dmy', label: `${d}/mm/${y}` },
      { value: 'mdy', label: `mm/${d}/${y}` },
      { value: 'ymd', label: `${y}-mm-${d}` },
    ];
  });
  protected readonly times = computed((): SegmentOption<TimeFormat>[] => [
    { value: 'auto', label: this.i18n.t('formats.auto') },
    { value: 'h24', label: this.i18n.t('formats.h24') },
    { value: 'h12', label: this.i18n.t('formats.h12') },
  ]);
  protected readonly currencies: SegmentOption<Currency>[] = CURRENCIES.map((c) => ({
    value: c,
    label: c,
  }));

  /** Anteprima con l'ora attuale e un costo di 12,50 USD. */
  protected readonly example = computed(() => {
    const now = new Date();
    return this.i18n.t('formats.example', {
      date: this.i18n.date(now),
      time: this.i18n.time(now),
      cost: this.i18n.money(12.5),
    });
  });

  protected save(patch: FormatPrefs): void {
    this.saveError.set(false);
    this.f.set(patch).catch(() => this.saveError.set(true));
  }

  protected async setCurrency(c: Currency): Promise<void> {
    this.rateError.set(false);
    this.save({ currency: c });
    if (c !== 'USD' && !this.f.rates()[c]) await this.fetchRate();
  }

  protected setRate(n: number): void {
    this.rateError.set(false);
    this.saveError.set(false);
    this.f.setRate(this.f.currency(), n).catch(() => this.saveError.set(true));
  }

  protected async fetchRate(): Promise<void> {
    const c = this.f.currency();
    if (c === 'USD') return;
    this.fetching.set(true);
    this.rateError.set(false);
    try {
      await this.f.fetchRate(c);
    } catch {
      this.rateError.set(true);
    } finally {
      this.fetching.set(false);
    }
  }
}
