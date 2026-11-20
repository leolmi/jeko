import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { kebab, type RunMode } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { Realtime } from '../core/realtime';
import { Runs } from '../core/runs';
import { completeProjectDir, projectDirHint, Settings } from '../core/settings';
import { Templates } from '../core/templates';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';
import { MODES } from './composer';
import { TemplateEditor } from './template-editor';

/** Nome proposto dalla cartella: il suo ultimo pezzo. */
const nameOf = (path: string) =>
  path
    .trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';

/** Nuovo progetto: una cartella che c'è già, oppure un progetto da creare con Jeko. */
@Component({
  selector: 'jk-new-project',
  imports: [FormsModule, Icon, Segmented, TemplateEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-2xl px-6 py-6">
      <h2 class="text-xl font-semibold tracking-tight">{{ i18n.t('new.title') }}</h2>

      <form class="mt-5 rounded-xl border border-line bg-surface p-4" (ngSubmit)="addExisting()">
        <p class="text-sm font-medium">{{ i18n.t('new.existing') }}</p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('new.existing.hint') }}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label class="block">
            <span class="jk-label">{{ i18n.t('new.path') }}</span>
            <div class="mt-1 flex gap-2">
              <div class="relative min-w-0 flex-1">
                <jk-icon name="folder" [size]="16" class="absolute top-2.5 left-3 text-faint" />
                <input
                  class="jk-input pl-9 font-mono"
                  name="path"
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="pathHint()"
                  [(ngModel)]="path"
                  (keydown.tab)="completePath($event)"
                />
              </div>
              <button
                type="button"
                class="jk-btn-outline shrink-0 px-2.5"
                [disabled]="!rt.runner().connected || picking()"
                [title]="i18n.t(rt.runner().connected ? 'new.pick' : 'new.pick.offline')"
                [attr.aria-label]="i18n.t('new.pick')"
                (click)="pick()"
              >
                <jk-icon [name]="picking() ? 'hourglass' : 'folder'" [size]="18" />
              </button>
            </div>
          </label>
          <label class="block">
            <span class="jk-label">{{ i18n.t('new.name') }}</span>
            <input
              class="jk-input mt-1"
              name="name"
              autocomplete="off"
              [placeholder]="suggested()"
              [(ngModel)]="name"
            />
          </label>
        </div>
        <div class="mt-3 flex items-center gap-3">
          @if (addError(); as e) {
            <p class="text-sm text-red-600 dark:text-red-400">{{ i18n.t(e) }}</p>
          }
          <button class="jk-btn-primary ml-auto" type="submit" [disabled]="!canAdd() || busy()">
            <jk-icon name="add" [size]="16" />
            {{ i18n.t('new.add') }}
          </button>
        </div>
      </form>

      <form class="mt-4 rounded-xl border border-line bg-surface p-4" (ngSubmit)="create()">
        <p class="text-sm font-medium">{{ i18n.t('new.create') }}</p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('new.create.hint') }}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <label class="block">
            <span class="jk-label">{{ i18n.t('new.name') }}</span>
            <input class="jk-input mt-1" name="newName" autocomplete="off" [(ngModel)]="newName" />
            @if (newName().trim() && settings.value()?.projectsDir; as dir) {
              <span class="mt-1 block truncate font-mono text-xs text-faint"
                >{{ dir }}\\{{ slug(newName()) }}</span
              >
            }
          </label>
          <label class="block">
            <span class="jk-label">{{ i18n.t('tpl.template') }}</span>
            <select class="jk-input mt-1 text-sm" name="template" [(ngModel)]="template">
              <option value="">{{ i18n.t('tpl.none') }}</option>
              @for (t of templates.list(); track t.name) {
                <option [value]="t.name">{{ t.name }}</option>
              }
            </select>
          </label>
        </div>
        <textarea
          class="jk-input mt-3 resize-none text-sm leading-relaxed"
          rows="3"
          name="request"
          [attr.aria-label]="i18n.t('composer.request')"
          [placeholder]="i18n.t('composer.request.create')"
          [(ngModel)]="request"
          (keydown.control.enter)="create()"
        ></textarea>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <jk-segmented [label]="i18n.t('composer.mode')" [options]="modes()" [(value)]="mode" />
          <button class="jk-btn-primary ml-auto" type="submit" [disabled]="!canCreate() || busy()">
            <jk-icon name="send" [size]="16" />
            {{ i18n.t('composer.send') }}
          </button>
        </div>
        @if (createError()) {
          <p class="mt-2 text-sm text-red-600 dark:text-red-400">
            {{ i18n.t('composer.error') }}
          </p>
        }
      </form>

      <details class="mt-4 rounded-xl border border-line bg-surface p-4">
        <summary class="cursor-pointer text-sm font-medium">{{ i18n.t('tpl.manage') }}</summary>
        <p class="mt-1 text-xs text-faint">{{ i18n.t('tpl.manage.hint') }}</p>
        <jk-template-editor class="mt-3" [(selected)]="editing" />
      </details>
    </div>
  `,
})
export class NewProject {
  protected readonly i18n = inject(I18n);
  private readonly projects = inject(Projects);
  private readonly runs = inject(Runs);
  private readonly router = inject(Router);
  protected readonly settings = inject(Settings);

  protected readonly path = signal('');
  protected readonly name = signal('');
  protected readonly suggested = computed(() => nameOf(this.path()) || this.i18n.t('new.name'));
  protected readonly canAdd = computed(() => !!this.path().trim() && !!this.finalName());
  protected readonly busy = signal(false);
  protected readonly addError = signal<'new.duplicate' | 'new.error' | 'new.pick.error' | null>(
    null,
  );
  protected readonly pathHint = computed(() => projectDirHint(this.settings.value()?.projectsDir));
  protected readonly rt = inject(Realtime);
  private readonly http = inject(HttpClient);
  protected readonly picking = signal(false);

  protected readonly templates = inject(Templates);
  protected readonly newName = signal('');
  protected readonly template = signal('');
  /** Template aperto nell'editor: segue quello scelto per la creazione. */
  protected readonly editing = linkedSignal(() => this.template());
  protected readonly slug = kebab;
  protected readonly request = signal('');
  protected readonly canCreate = computed(() => !!this.newName().trim() && !!this.request().trim());
  protected readonly mode = signal<RunMode>('checkpoint');
  protected readonly modes = computed((): SegmentOption<RunMode>[] =>
    MODES.map((m) => ({
      value: m,
      label: this.i18n.t(`composer.mode.${m}`),
      hint: this.i18n.t(`composer.mode.${m}.hint`),
    })),
  );
  protected readonly createError = signal(false);

  constructor() {
    if (!this.settings.value()) void this.settings.load().catch(() => undefined);
  }

  private finalName(): string {
    return this.name().trim() || nameOf(this.path());
  }

  /** Tab inserisce la cartella dei progetti (se il campo è vuoto o ne è l'inizio). */
  protected completePath(e: Event): void {
    const done = completeProjectDir(this.path(), this.settings.value()?.projectsDir);
    if (done === null) return;
    e.preventDefault();
    (e.target as HTMLInputElement).value = done;
    this.path.set(done);
  }

  /**
   * Dialogo "Seleziona cartella" di Windows, aperto dal runner sul PC: il browser da solo
   * non può dare il percorso completo. Parte dalla cartella scritta o da quella dei progetti.
   */
  protected async pick(): Promise<void> {
    if (this.picking()) return;
    this.picking.set(true);
    this.addError.set(null);
    try {
      const start = this.path().trim() || this.settings.value()?.projectsDir || undefined;
      const { path } = await firstValueFrom(
        this.http.post<{ path: string | null }>('/api/projects/pick-folder', {
          ...(start && { start }),
          title: this.i18n.t('new.pick.title'),
        }),
      );
      if (path) this.path.set(path);
    } catch {
      this.addError.set('new.pick.error');
    } finally {
      this.picking.set(false);
    }
  }

  protected async addExisting(): Promise<void> {
    if (!this.canAdd() || this.busy()) return;
    this.busy.set(true);
    this.addError.set(null);
    try {
      await this.projects.add({ name: this.finalName(), path: this.path().trim() });
      void this.router.navigate(['/']);
    } catch (e) {
      this.addError.set(
        e instanceof HttpErrorResponse && e.status === 409 ? 'new.duplicate' : 'new.error',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected create(): void {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    this.createError.set(false);
    const template = this.template();
    const body = {
      name: this.newName().trim(),
      request: this.request().trim(),
      mode: this.mode(),
      ...(template && { template }),
    };
    this.runs.createProject(body).subscribe({
      next: (run) => {
        this.busy.set(false);
        void this.router.navigate(['/runs', run.id]);
      },
      error: () => {
        this.busy.set(false);
        this.createError.set(true);
      },
    });
  }
}
