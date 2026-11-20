import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n, type Lang } from '../core/i18n';
import { Theme, type ThemePref } from '../core/theme';
import { Segmented, type SegmentOption } from './segmented';

/** Lingua e tema, nell'intestazione e nel primo avvio. */
@Component({
  selector: 'jk-prefs',
  imports: [Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-2' },
  template: `
    <jk-segmented [label]="i18n.t('lang.label')" [options]="langs" [(value)]="i18n.lang" />
    <jk-segmented [label]="i18n.t('theme.label')" [options]="themes()" [(value)]="theme.pref" />
  `,
})
export class Prefs {
  protected readonly i18n = inject(I18n);
  protected readonly theme = inject(Theme);
  protected readonly langs: SegmentOption<Lang>[] = [
    { value: 'it', label: 'IT', hint: 'Italiano' },
    { value: 'en', label: 'EN', hint: 'English' },
  ];
  protected readonly themes = computed((): SegmentOption<ThemePref>[] => [
    { value: 'light', label: '', icon: 'light_mode', hint: this.i18n.t('theme.light') },
    { value: 'system', label: '', icon: 'contrast', hint: this.i18n.t('theme.system') },
    { value: 'dark', label: '', icon: 'dark_mode', hint: this.i18n.t('theme.dark') },
  ]);
}
