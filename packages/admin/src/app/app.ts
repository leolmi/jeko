import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { I18n } from './core/i18n';
import { Realtime } from './core/realtime';
import { Setup } from './core/setup';
import { Theme } from './core/theme';
import { Splash } from './setup/splash';
import { Wizard } from './setup/wizard';
import { Icon } from './ui/icon';
import { Prefs } from './ui/prefs';

/** Splash minimo, per non far lampeggiare la schermata di caricamento. */
const SPLASH_MS = 600;

@Component({
  selector: 'jk-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Splash, Wizard, Prefs, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (phase()) {
      @case ('splash') {
        <jk-splash [offline]="setup.offline()" />
      }
      @case ('setup') {
        <!-- A wizard concluso lo stato diventa "completed" e si passa all'app. -->
        <jk-wizard />
      }
      @default {
        <div class="flex h-screen flex-col">
          <header
            class="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-surface px-4"
          >
            <a routerLink="/" class="flex items-baseline gap-1.5">
              <span class="font-mono text-lg font-semibold tracking-tight">jeko</span>
              <span class="hidden text-xs text-faint sm:inline">{{ i18n.t('app.tagline') }}</span>
            </a>
            <nav class="flex gap-1 text-sm">
              <a
                routerLink="/"
                class="rounded-md px-2.5 py-1 text-muted transition-colors hover:text-fg"
                [class.bg-subtle]="section() === 'projects'"
                [class.!text-fg]="section() === 'projects'"
                >{{ i18n.t('nav.projects') }}</a
              >
              <a
                routerLink="/workflow"
                class="rounded-md px-2.5 py-1 text-muted transition-colors hover:text-fg"
                routerLinkActive="bg-subtle !text-fg"
                >{{ i18n.t('nav.workflows') }}</a
              >
            </nav>
            <span class="ml-auto flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <span
                class="size-2 rounded-full"
                [class]="
                  !rt.online()
                    ? 'bg-red-500'
                    : rt.runner().connected
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                "
              ></span>
              <span class="hidden sm:inline">{{ connection() }}</span>
            </span>
            <jk-prefs />
            <a
              routerLink="/opzioni"
              class="jk-btn-ghost -mr-1 px-2"
              routerLinkActive="bg-subtle !text-fg"
              [title]="i18n.t('settings.title')"
              [attr.aria-label]="i18n.t('settings.title')"
            >
              <jk-icon name="settings" [size]="18" />
            </a>
          </header>
          <main class="min-h-0 flex-1">
            <router-outlet />
          </main>
        </div>
      }
    }
  `,
})
export class App {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  protected readonly setup = inject(Setup);
  private readonly minDelay = signal(true);
  protected readonly phase = computed(() => {
    const s = this.setup.status();
    if (!s || this.minDelay()) return 'splash';
    return s.completed ? 'ready' : 'setup';
  });
  private readonly url = toSignal(
    inject(Router).events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: inject(Router).url },
  );
  /** Sezione attiva: la pagina dei progetti (task, chat, nuovo progetto) o quella dei workflow. */
  protected readonly section = computed(() =>
    /^\/(workflow|opzioni)(\/|$|\?)/.test(this.url()) ? 'other' : 'projects',
  );
  protected readonly connection = computed(() =>
    this.i18n.t(
      !this.rt.online() ? 'server.off' : this.rt.runner().connected ? 'runner.on' : 'runner.off',
    ),
  );

  constructor() {
    inject(Theme);
    this.rt.start();
    setTimeout(() => this.minDelay.set(false), SPLASH_MS);
    void this.boot();
  }

  /** Riprova finché il server non risponde. */
  private async boot(): Promise<void> {
    while (!(await this.setup.load())) await new Promise((r) => setTimeout(r, 3000));
  }
}
