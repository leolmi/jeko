import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18n } from '../core/i18n';

/** Schermata di caricamento: logo, indicatore sottile e, se serve, il motivo dell'attesa. */
@Component({
  selector: 'jk-splash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed inset-0 flex flex-col items-center justify-center bg-bg' },
  styles: `
    .bar {
      animation: slide 1.4s ease-in-out infinite;
    }
    @keyframes slide {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(250%);
      }
    }
    .logo {
      animation: rise 0.6s ease-out both;
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
  `,
  template: `
    <div class="logo flex items-baseline gap-2">
      <span class="font-mono text-3xl font-semibold tracking-tight">jeko</span>
      <span class="size-2 rounded-full bg-sky-500"></span>
    </div>
    <div
      class="mt-6 h-0.5 w-40 overflow-hidden rounded-full bg-subtle"
      role="progressbar"
      [attr.aria-label]="i18n.t('splash.loading')"
    >
      <div class="bar h-full w-2/5 rounded-full bg-fg/60"></div>
    </div>
    <p class="mt-4 h-5 text-sm text-muted" aria-live="polite">
      {{ offline() ? i18n.t('splash.offline') : i18n.t('splash.loading') }}
    </p>
    @if (offline()) {
      <p class="mt-1 font-mono text-xs text-faint">{{ i18n.t('splash.offline.hint') }}</p>
    }
  `,
})
export class Splash {
  protected readonly i18n = inject(I18n);
  readonly offline = input(false);
}
