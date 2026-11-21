import { computed, inject, Injectable } from '@angular/core';
import type { Currency, DateFormat, Formats as FormatPrefs, TimeFormat } from '@jeko/shared';
import { Settings } from './settings';

export { CURRENCIES, type Currency, type DateFormat, type TimeFormat } from '@jeko/shared';

/**
 * Formati di data, ora e valuta scelti nelle Opzioni, salvati sul server con le altre
 * opzioni. I costi si convertono da USD col cambio della valuta: senza cambio restano in USD.
 */
@Injectable({ providedIn: 'root' })
export class Formats {
  private readonly settings = inject(Settings);
  private readonly prefs = computed((): FormatPrefs => this.settings.value()?.formats ?? {});
  readonly date = computed((): DateFormat => this.prefs().date ?? 'auto');
  readonly time = computed((): TimeFormat => this.prefs().time ?? 'auto');
  readonly currency = computed((): Currency => this.prefs().currency ?? 'USD');
  readonly rates = computed(() => this.prefs().rates ?? {});

  /** Cambia subito i formati e li salva; se il salvataggio fallisce torna a quelli del server. */
  async set(patch: FormatPrefs): Promise<void> {
    const current = this.settings.value() ?? {};
    const next = { ...current, formats: { ...current.formats, ...patch } };
    this.settings.value.set(next);
    try {
      await this.settings.save(next);
    } catch (e) {
      await this.settings.load().catch(() => undefined);
      throw e;
    }
  }

  async setRate(c: Currency, rate: number): Promise<void> {
    if (!(rate > 0 && Number.isFinite(rate))) return;
    await this.set({ rates: { ...this.rates(), [c]: rate } });
  }

  /** Valuta e fattore con cui mostrare un importo in USD. */
  money(): { currency: Currency; rate: number } {
    const c = this.currency();
    const rate = c === 'USD' ? 1 : this.rates()[c];
    return rate ? { currency: c, rate } : { currency: 'USD', rate: 1 };
  }

  /** Cambio aggiornato dalla BCE (frankfurter.dev): 1 USD in `c`. */
  async fetchRate(c: Currency): Promise<number> {
    const res = await fetch(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${c}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rate = ((await res.json()) as { quote: string; rate: number }[]).find(
      (r) => r.quote === c,
    )?.rate;
    if (!rate) throw new Error('rate');
    await this.setRate(c, rate);
    return rate;
  }
}

/** Data in cifre secondo il formato: "21/11/2026", "11/21/2026", "2026-11-21". */
export function formatDate(d: Date, fmt: DateFormat, lang: string): string {
  if (fmt === 'auto') {
    return new Intl.DateTimeFormat(lang, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return fmt === 'dmy'
    ? `${dd}/${mm}/${y}`
    : fmt === 'mdy'
      ? `${mm}/${dd}/${y}`
      : `${y}-${mm}-${dd}`;
}

/** Giorno e mese brevi, nell'ordine del formato: "21 nov", "Nov 21", "11-21". */
export function formatDayMonth(d: Date, fmt: DateFormat, lang: string): string {
  if (fmt === 'auto')
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d);
  if (fmt === 'ymd') {
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const month = new Intl.DateTimeFormat(lang, { month: 'short' }).format(d);
  return fmt === 'dmy' ? `${d.getDate()} ${month}` : `${month} ${d.getDate()}`;
}

/** Ora e minuti: a 24 ore, a 12 o come vuole la lingua. */
export function formatTime(d: Date, fmt: TimeFormat, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
    ...(fmt === 'auto' ? {} : { hour12: fmt === 'h12' }),
  }).format(d);
}
