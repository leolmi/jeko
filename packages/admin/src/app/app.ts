import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { I18n, type I18nKey } from './core/i18n';
import { isOpen } from './core/projects';
import { Realtime } from './core/realtime';
import { Runs } from './core/runs';
import { Settings } from './core/settings';
import { Setup } from './core/setup';
import { Theme } from './core/theme';
import { UpdatePrompt } from './settings/update-prompt';
import { Splash } from './setup/splash';
import { Wizard } from './setup/wizard';
import { Icon, type IconName } from './ui/icon';
import { runTone } from './ui/mode-tone';
import { Prefs } from './ui/prefs';

/** Splash minimo, per non far lampeggiare la schermata di caricamento. */
const SPLASH_MS = 600;

@Component({
  selector: 'jk-root',
  imports: [RouterOutlet, RouterLink, Splash, Wizard, Prefs, Icon, UpdatePrompt],
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
              @if (setup.status()?.server?.version; as v) {
                <span class="font-mono text-xs text-muted">v{{ v }}</span>
              }
              <span class="hidden text-xs text-faint sm:inline">{{ i18n.t('app.tagline') }}</span>
            </a>
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
          </header>
          <div class="flex min-h-0 flex-1">
            <!-- Pagine principali: una barra di sole icone, il nome nel suggerimento. -->
            <nav
              class="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3"
              [attr.aria-label]="i18n.t('nav.label')"
            >
              @for (l of links; track l.path) {
                <a
                  class="relative flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
                  [routerLink]="l.path"
                  [class.bg-subtle]="section() === l.section"
                  [class.!text-fg]="section() === l.section"
                  [attr.aria-current]="section() === l.section ? 'page' : null"
                  [title]="linkTitle(l)"
                  [attr.aria-label]="linkTitle(l)"
                >
                  <jk-icon [name]="l.icon" [size]="22" />
                  <!-- Sui progetti, come nell'elenco: pulsa se un task lavora, cerchio se aspetta te. -->
                  @if (l.section === 'projects' && activity(); as a) {
                    <span
                      class="absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-surface"
                      [class]="a.status === 'waiting' ? 'border-[1.5px] ' + a.tone.ringBorder : ''"
                    >
                      <span
                        class="size-2 rounded-full"
                        [class]="a.tone.dot"
                        [class.animate-pulse]="a.status === 'running'"
                        [class.opacity-40]="a.status === 'queued'"
                      ></span>
                    </span>
                  }
                </a>
              }
              <!-- Le opzioni in fondo alla barra. -->
              <a
                class="mt-auto flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
                routerLink="/opzioni"
                [class.bg-subtle]="section() === 'opzioni'"
                [class.!text-fg]="section() === 'opzioni'"
                [attr.aria-current]="section() === 'opzioni' ? 'page' : null"
                [title]="i18n.t('settings.title')"
                [attr.aria-label]="i18n.t('settings.title')"
              >
                <jk-icon name="settings" [size]="22" />
              </a>
            </nav>
            <main class="min-h-0 min-w-0 flex-1">
              <router-outlet />
            </main>
          </div>
        </div>
        <jk-update-prompt />
      }
    }
  `,
})
export class App {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  protected readonly setup = inject(Setup);
  private readonly runs = inject(Runs);
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
  protected readonly links: { path: string; section: string; icon: IconName; label: I18nKey }[] = [
    { path: '/', section: 'projects', icon: 'folder', label: 'nav.projects' },
    { path: '/workflow', section: 'workflow', icon: 'account_tree', label: 'nav.workflows' },
    { path: '/note', section: 'note', icon: 'lightbulb', label: 'nav.notes' },
    { path: '/statistiche', section: 'statistiche', icon: 'bar_chart', label: 'nav.stats' },
  ];
  /**
   * Il task aperto più importante, per il pallino sui progetti: uno che aspetta l'utente,
   * altrimenti uno che lavora, altrimenti uno in coda.
   */
  protected readonly activity = computed(() => {
    const open = this.runs.list().filter(isOpen);
    for (const status of ['waiting', 'running', 'queued'] as const) {
      const run = open.find((r) => r.status === status);
      if (run) return { status, tone: runTone(run) };
    }
    return null;
  });

  protected linkTitle(l: { section: string; label: I18nKey }): string {
    const a = l.section === 'projects' ? this.activity() : null;
    const name = this.i18n.t(l.label);
    return a ? `${name} · ${this.i18n.t(`status.${a.status}`)}` : name;
  }

  /** Sezione attiva: una delle pagine principali; i task, le chat e i nuovi progetti sono "projects". */
  protected readonly section = computed(
    () => /^\/(workflow|statistiche|note|opzioni)(?=\/|$|\?)/.exec(this.url())?.[1] ?? 'projects',
  );
  protected readonly connection = computed(() =>
    this.i18n.t(
      !this.rt.online() ? 'server.off' : this.rt.runner().connected ? 'runner.on' : 'runner.off',
    ),
  );

  private readonly settings = inject(Settings);

  constructor() {
    inject(Theme);
    this.rt.start();
    setTimeout(() => this.minDelay.set(false), SPLASH_MS);
    void this.boot();
  }

  /** Riprova finché il server non risponde; poi legge le opzioni (servono i formati). */
  private async boot(): Promise<void> {
    while (!(await this.setup.load())) await new Promise((r) => setTimeout(r, 3000));
    if (!this.settings.value()) await this.settings.load().catch(() => undefined);
  }
}
