import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { RunMode } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { Realtime } from '../core/realtime';
import { Runs } from '../core/runs';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';
import { ModeBadge, TONES } from '../ui/mode-tone';
import { Segmented, type SegmentOption } from '../ui/segmented';

export const MODES: RunMode[] = ['headless', 'checkpoint', 'interactive'];

/**
 * Chat in fondo alla pagina: un nuovo task sul progetto attivo, nella sua cartella.
 * Il testo non inviato resta al progetto: cambiando progetto si ritrova il suo.
 */
@Component({
  selector: 'jk-task-composer',
  imports: [Icon, Segmented, ModeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col bg-surface px-6 py-3' },
  template: `
    <div
      class="flex min-h-0 flex-1 flex-col rounded-2xl border-2 bg-bg transition-colors"
      [class]="tone().border"
      [class.opacity-60]="!project()"
    >
      <div class="flex justify-end px-3 pt-2.5">
        <jk-mode-badge [tone]="tone()" />
      </div>
      <textarea
        class="block min-h-0 w-full flex-1 resize-none bg-transparent px-4 pt-1 text-sm leading-relaxed outline-none"
        [attr.aria-label]="i18n.t('composer.request')"
        [placeholder]="
          !project()
            ? i18n.t('ws.empty')
            : i18n.t(followUp() ? 'composer.continue.placeholder' : 'composer.placeholder', {
                name: project()!.name,
              })
        "
        [disabled]="!project()?.path"
        [value]="draft()"
        (input)="setDraft($any($event.target).value)"
        (keydown.control.enter)="submit()"
      ></textarea>
      <div class="flex flex-wrap items-center gap-3 px-3 pt-1 pb-2.5">
        <!-- Continuando un task, modalità e workflow sono già quelli del task. -->
        <jk-segmented
          [label]="i18n.t('composer.mode')"
          [options]="modes()"
          [(value)]="mode"
          [class.invisible]="followUp()"
        />
        <!-- Con o senza workflow: un pulsante, l'icona evidenziata è la modalità attiva. -->
        <button
          type="button"
          class="inline-flex rounded-lg bg-subtle p-0.5"
          [class.invisible]="followUp()"
          [attr.aria-label]="i18n.t('composer.switch')"
          [attr.aria-pressed]="direct()"
          [title]="i18n.t(direct() ? 'composer.direct.hint' : 'composer.plan.hint')"
          (click)="direct.set(!direct())"
        >
          <span
            class="rounded-md p-1.5 transition-colors"
            [class]="!direct() ? TONES.plan.active : 'text-muted'"
          >
            <jk-icon name="account_tree" [size]="16" />
          </span>
          <span
            class="rounded-md p-1.5 transition-colors"
            [class]="direct() ? TONES.direct.active : 'text-muted'"
          >
            <jk-icon name="flash_on" [size]="16" />
          </span>
        </button>
        <span class="hidden min-w-0 flex-1 truncate text-xs text-faint lg:inline">
          @if (error()) {
            <span class="text-red-600 dark:text-red-400">{{ i18n.t('composer.error') }}</span>
          } @else if (!rt.runner().connected) {
            {{ i18n.t('composer.queued') }}
          } @else if (busy() && !followUp()) {
            {{ i18n.t('composer.busy') }}
          } @else {
            {{ i18n.t('composer.shortcut') }}
          }
        </span>
        <button
          type="button"
          class="jk-btn ml-auto hover:opacity-90"
          [class]="tone().active"
          [disabled]="!valid() || sending()"
          (click)="submit()"
        >
          <jk-icon name="send" [size]="16" />
          {{
            i18n.t(followUp() ? 'composer.continue' : busy() ? 'composer.enqueue' : 'composer.send')
          }}
        </button>
      </div>
    </div>
  `,
})
export class TaskComposer {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  private readonly projects = inject(Projects);
  private readonly runs = inject(Runs);
  private readonly router = inject(Router);

  protected readonly project = this.projects.active;
  protected readonly draft = computed(() => {
    const p = this.project();
    return (p && this.projects.drafts()[p.id]) ?? '';
  });
  /** Il progetto ha già un task attivo: il nuovo andrà in coda. */
  protected readonly busy = computed(() => (this.project()?.open.length ?? 0) > 0);
  protected readonly mode = signal<RunMode>(
    MODES.find((m) => m === storage.get('mode')) ?? 'checkpoint',
  );
  protected readonly modes = computed((): SegmentOption<RunMode>[] =>
    MODES.map((m) => ({
      value: m,
      label: this.i18n.t(`composer.mode.${m}`),
      hint: this.i18n.t(`composer.mode.${m}.hint`),
    })),
  );
  /** Task diretto, senza workflow di sviluppo: resta com'è, come la modalità. */
  protected readonly direct = signal(storage.get('direct') === '1');
  /** Task diretto del progetto aperto in pagina, in attesa del messaggio seguente. */
  protected readonly followUp = computed(() => {
    const f = this.runs.followUp();
    const path = this.project()?.path;
    return f && path && f.cwd?.toLowerCase() === path.toLowerCase() ? f : null;
  });
  /** Modalità mostrata in alto: continuando, è quella del task (sempre diretto). */
  protected readonly isDirect = computed(() => !!this.followUp() || this.direct());
  protected readonly TONES = TONES;
  protected readonly tone = computed(() => (this.isDirect() ? TONES.direct : TONES.plan));
  protected readonly sending = signal(false);
  protected readonly error = signal(false);
  protected readonly valid = computed(
    () => !!this.project()?.path && this.draft().trim().length > 0,
  );

  constructor() {
    effect(() => storage.set('mode', this.mode()));
    effect(() => storage.set('direct', this.direct() ? '1' : '0'));
  }

  protected setDraft(text: string): void {
    const p = this.project();
    if (p) this.projects.setDraft(p.id, text);
  }

  protected submit(): void {
    const p = this.project();
    if (!p || !this.valid() || this.sending()) return;
    this.sending.set(true);
    this.error.set(false);
    const request = this.draft().trim();
    const done = () => {
      this.sending.set(false);
      this.projects.setDraft(p.id, '');
    };
    const error = () => {
      this.sending.set(false);
      this.error.set(true);
    };
    // Task diretto aperto in pagina: il messaggio lo continua, non ne avvia uno nuovo.
    const f = this.followUp();
    if (f) {
      this.runs.continue(f.runId, f.promptId, request).subscribe({ next: done, error });
      return;
    }
    this.runs
      .start({
        request,
        mode: this.mode(),
        cwd: p.path,
        ...(this.direct() && { direct: true }),
      })
      .subscribe({
        next: (run) => {
          done();
          void this.router.navigate(['/runs', run.id]);
        },
        error,
      });
  }
}
