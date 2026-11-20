import { computed, effect, Injectable, signal } from '@angular/core';
import { storage } from './storage';

export type ThemePref = 'light' | 'dark' | 'system';

const isPref = (v: string | null): v is ThemePref =>
  v === 'light' || v === 'dark' || v === 'system';

@Injectable({ providedIn: 'root' })
export class Theme {
  readonly pref = signal<ThemePref>(
    isPref(storage.get('theme')) ? (storage.get('theme') as ThemePref) : 'system',
  );
  private readonly systemDark = signal(false);
  readonly dark = computed(() =>
    this.pref() === 'system' ? this.systemDark() : this.pref() === 'dark',
  );

  constructor() {
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) {
      this.systemDark.set(mq.matches);
      mq.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => {
      document.documentElement.classList.toggle('dark', this.dark());
      storage.set('theme', this.pref());
    });
  }
}
