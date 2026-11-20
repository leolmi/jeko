import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  formatIssue,
  type Issue,
  type Workflow,
  type WorkflowCheck,
  type WorkflowProposal,
  type WorkflowRecord,
} from '@jeko/shared';
import { firstValueFrom } from 'rxjs';
import { I18n, type I18nKey } from '../core/i18n';
import { Realtime } from '../core/realtime';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';
import { diffLines } from './diff';
import { YamlEditor } from './editor';
import { WorkflowPreview } from './preview';

/** Chiave del workflow nuovo, non ancora salvato. */
const NEW = '';
const TEMPLATE = `name: nuovo-workflow
kind: develop
version: 1
description: A cosa serve questo workflow
steps:
  - id: lavoro
    type: agent
    title: Lavoro
    instructions: |
      Richiesta: {{ request }}
`;
const CHECK_DELAY_MS = 300;

/**
 * Workflow: elenco a sinistra; sopra lo YAML con l'anteprima (o la proposta dell'AI con le
 * differenze); sotto la chat per chiedere a claude una modifica. Niente si salva da solo:
 * ogni salvataggio crea una nuova versione.
 */
@Component({
  selector: 'jk-workflows-page',
  imports: [Icon, YamlEditor, WorkflowPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full' },
  template: `
    <aside class="flex w-[30%] max-w-sm min-w-56 shrink-0 flex-col border-r border-line">
      <div class="flex items-center gap-2 p-3">
        <h1 class="text-sm font-semibold">{{ i18n.t('wf.title') }}</h1>
        <span class="text-xs text-faint">{{ records().length }}</span>
        <button
          type="button"
          class="jk-btn-ghost -mr-1 ml-auto px-1.5 py-1"
          [class.bg-subtle]="key() === NEW"
          [title]="i18n.t('wf.new')"
          [attr.aria-label]="i18n.t('wf.new')"
          (click)="select(NEW)"
        >
          <jk-icon name="add" [size]="18" />
        </button>
      </div>
      <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        @if (key() === NEW) {
          <div class="mb-0.5 rounded-lg bg-subtle px-3 py-2 text-sm italic">
            {{ i18n.t('wf.new') }}
          </div>
        }
        @for (w of records(); track w.name) {
          <button
            type="button"
            class="mb-0.5 block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-subtle"
            [class.bg-subtle]="w.name === key()"
            [attr.aria-current]="w.name === key() || null"
            (click)="select(w.name)"
          >
            <span class="flex items-center gap-2">
              <span class="flex-1 truncate font-mono text-sm">{{ w.name }}</span>
              @if (drafts()[w.name] !== undefined) {
                <span class="text-xs text-faint" [title]="i18n.t('ws.draft')">✎</span>
              }
              <span class="text-xs text-faint">v{{ w.version }}</span>
            </span>
            <span class="mt-0.5 flex items-center gap-2 text-xs text-faint">
              <span class="shrink-0 rounded bg-subtle px-1 whitespace-nowrap">{{
                i18n.t(kindLabel(w.kind))
              }}</span>
              <span class="truncate">{{ w.description }}</span>
            </span>
          </button>
        }
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <section class="flex min-h-0 flex-1 flex-col px-5 pt-4 pb-3">
        @if (proposal(); as p) {
          <!-- Proposta dell'AI: differenze e anteprima, da accettare o scartare. -->
          <div class="flex flex-wrap items-center gap-3">
            <jk-icon name="code" [size]="18" class="text-sky-500" />
            <p class="min-w-0 flex-1 text-sm">
              <span class="font-medium">{{ i18n.t('wf.proposal') }}</span>
              @if (p.summary) {
                <span class="text-muted"> · {{ p.summary }}</span>
              }
            </p>
            <button type="button" class="jk-btn-ghost" (click)="proposal.set(null)">
              {{ i18n.t('wf.proposal.discard') }}
            </button>
            <button type="button" class="jk-btn-primary" (click)="accept(p)">
              <jk-icon name="check" [size]="16" />
              {{ i18n.t('wf.proposal.accept') }}
            </button>
          </div>
          @if (p.issues.length) {
            <p class="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {{ i18n.t('wf.proposal.issues', { n: p.issues.length }) }}
            </p>
          }
          <div class="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
            <div
              #diffBox
              class="min-h-0 overflow-auto rounded-xl border border-line bg-surface py-2 font-mono text-xs leading-5"
            >
              @for (l of diff(); track $index) {
                <div
                  class="flex px-3 whitespace-pre"
                  [attr.data-change]="l.kind !== 'same' || null"
                  [class]="
                    l.kind === 'add'
                      ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                      : l.kind === 'del'
                        ? 'bg-red-500/10 text-red-800 line-through decoration-red-500/40 dark:text-red-300'
                        : 'text-muted'
                  "
                >
                  <span class="w-4 shrink-0 select-none">{{
                    l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''
                  }}</span>
                  <span>{{ l.text || ' ' }}</span>
                </div>
              }
            </div>
            <div class="min-h-0 overflow-y-auto">
              @if (proposedWorkflow(); as w) {
                <jk-workflow-preview [workflow]="w" />
              }
            </div>
          </div>
        } @else {
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="font-mono text-lg font-semibold tracking-tight">
              {{ key() === NEW ? i18n.t('wf.new') : key() }}
            </h2>
            @if (versions().length > 1) {
              <select
                class="jk-input w-auto py-1 text-xs"
                [attr.aria-label]="i18n.t('wf.version')"
                (change)="loadVersion($any($event.target).value)"
              >
                @for (v of versions(); track v.version) {
                  <option [value]="v.version" [selected]="v.version === versions()[0]?.version">
                    v{{ v.version }} · {{ i18n.ago(v.createdAt) }}
                  </option>
                }
              </select>
            } @else if (latest(); as l) {
              <span class="text-xs text-faint">v{{ l.version }}</span>
            }
            @if (dirty()) {
              <span class="text-xs text-amber-700 dark:text-amber-400">{{
                i18n.t('wf.dirty')
              }}</span>
            }
            <span class="ml-auto flex items-center gap-2">
              @if (dirty()) {
                <button type="button" class="jk-btn-ghost" (click)="discard()">
                  {{ i18n.t('wf.discard') }}
                </button>
              }
              <button
                type="button"
                class="jk-btn-primary"
                [disabled]="!dirty() || issues().length > 0 || saving()"
                (click)="save()"
              >
                <jk-icon name="save" [size]="16" />
                {{ i18n.t('wf.save') }}
              </button>
            </span>
          </div>
          @if (saveError()) {
            <p class="mt-2 text-xs text-red-600 dark:text-red-400">{{ i18n.t('wf.saveError') }}</p>
          }

          <div class="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
            <div class="flex min-h-0 flex-col gap-2">
              <jk-yaml-editor
                class="min-h-40 flex-1"
                [label]="i18n.t('wf.yaml')"
                [issues]="issues()"
                [value]="text()"
                (valueChange)="setText($event)"
              />
              @if (issues().length) {
                <ul
                  class="max-h-24 shrink-0 overflow-y-auto rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
                >
                  @for (i of issues(); track $index) {
                    <li>
                      @if (i.line) {
                        <button
                          type="button"
                          class="text-left underline-offset-2 hover:underline"
                          [title]="i18n.t('wf.line', { n: i.line })"
                          (click)="editor()?.goTo(i.line)"
                        >
                          {{ format(i) }}
                        </button>
                      } @else {
                        {{ format(i) }}
                      }
                    </li>
                  }
                </ul>
              }
            </div>
            <div class="min-h-0 overflow-y-auto">
              @if (preview(); as w) {
                @if (issues().length) {
                  <p class="mb-2 text-xs text-faint">{{ i18n.t('wf.previewStale') }}</p>
                }
                <jk-workflow-preview [workflow]="w" />
              }
            </div>
          </div>
        }
      </section>

      <!-- Chat: modifica chiesta all'AI sul workflow aperto. -->
      <section
        class="flex h-[30%] min-h-40 shrink-0 flex-col border-t border-line bg-surface px-5 py-3"
      >
        <div
          class="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-bg focus-within:border-faint"
        >
          <textarea
            class="block min-h-0 w-full flex-1 resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed outline-none"
            [attr.aria-label]="i18n.t('wf.ask')"
            [placeholder]="i18n.t('wf.ask.placeholder')"
            [disabled]="asking()"
            [value]="ask()"
            (input)="ask.set($any($event.target).value)"
            (keydown.control.enter)="assist()"
          ></textarea>
          <div class="flex items-center gap-3 px-3 pt-1 pb-2.5">
            <span class="min-w-0 flex-1 truncate text-xs" [class]="askHintClass()">
              {{ askHint() }}
            </span>
            <button
              type="button"
              class="jk-btn-primary"
              [disabled]="!ask().trim() || asking() || !rt.runner().connected"
              (click)="assist()"
            >
              <jk-icon [name]="asking() ? 'hourglass' : 'send'" [size]="16" />
              {{ i18n.t('wf.ask.send') }}
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class WorkflowsPage {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  private readonly http = inject(HttpClient);
  protected readonly NEW = NEW;

  private readonly list = httpResource<WorkflowRecord[]>(() => '/api/workflows', {
    defaultValue: [],
  });
  protected readonly records = computed(() =>
    [...this.list.value()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  /** Workflow aperto ('' = nuovo); quello salvato l'ultima volta, o il primo dell'elenco. */
  protected readonly key = signal<string>(storage.get('workflow') ?? '?');
  private readonly versionList = httpResource<WorkflowRecord[]>(
    () => (this.key() ? `/api/workflows/${encodeURIComponent(this.key())}` : undefined),
    { defaultValue: [] },
  );
  protected readonly versions = computed(() => (this.key() ? this.versionList.value() : []));
  protected readonly latest = computed(() => this.versions()[0]);

  /** Modifiche non salvate, per workflow (NEW = quello nuovo). */
  protected readonly drafts = signal<Record<string, string>>({});
  private readonly base = computed(() => (this.key() ? (this.latest()?.yaml ?? '') : TEMPLATE));
  protected readonly text = computed(() => this.drafts()[this.key()] ?? this.base());
  protected readonly dirty = computed(() => this.key() === NEW || this.text() !== this.base());

  private readonly check = signal<WorkflowCheck | null>(null);
  private readonly lastValid = signal<Workflow | null>(null);
  /** Errori dell'ultima verifica, senza doppioni (le alternative dello schema si ripetono). */
  protected readonly issues = computed((): Issue[] => {
    const c = this.check();
    if (!c || c.ok) return [];
    const seen = new Set<string>();
    return c.issues.filter((i) => {
      const k = `${i.line}:${i.col}:${i.message}`;
      return !seen.has(k) && !!seen.add(k);
    });
  });
  protected readonly preview = computed(() => {
    const c = this.check();
    return c?.ok ? c.workflow : this.lastValid();
  });
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);
  protected readonly editor = viewChild(YamlEditor);
  private readonly diffBox = viewChild<ElementRef<HTMLElement>>('diffBox');

  protected readonly ask = signal('');
  protected readonly asking = signal(false);
  protected readonly askError = signal<I18nKey | null>(null);
  protected readonly proposal = signal<WorkflowProposal | null>(null);
  private readonly proposalCheck = signal<WorkflowCheck | null>(null);
  protected readonly proposedWorkflow = computed(() => {
    const c = this.proposalCheck();
    return c?.ok ? c.workflow : null;
  });
  protected readonly diff = computed(() => {
    const p = this.proposal();
    return p ? diffLines(this.text(), p.yaml) : [];
  });
  protected readonly askHint = computed(() => {
    const e = this.askError();
    if (e) return this.i18n.t(e);
    if (this.asking()) return this.i18n.t('wf.ask.working');
    if (!this.rt.runner().connected) return this.i18n.t('wf.ask.offline');
    return this.i18n.t('wf.ask.hint');
  });
  protected readonly askHintClass = computed(() =>
    this.askError() ? 'text-red-600 dark:text-red-400' : 'text-faint',
  );

  constructor() {
    effect(() => storage.set('workflow', this.key()));
    // Un workflow che non c'è (più): si apre il primo dell'elenco.
    effect(() => {
      const recs = this.records();
      if (!this.list.hasValue() || this.list.isLoading() || this.key() === NEW) return;
      if (!recs.some((r) => r.name === this.key())) this.key.set(recs[0]?.name ?? NEW);
    });
    // Verifica mentre si scrive, con un attimo di ritardo.
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const yaml = this.text();
      clearTimeout(timer);
      if (!yaml.trim()) return this.check.set(null);
      timer = setTimeout(
        () => void this.verify(yaml).then((c) => this.applyCheck(yaml, c)),
        CHECK_DELAY_MS,
      );
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    // Cambiando workflow l'anteprima "valida" precedente non vale più.
    effect(() => {
      this.key();
      this.lastValid.set(null);
      this.proposal.set(null);
    });
    // Le differenze si aprono sulla prima riga cambiata.
    afterRenderEffect(() => {
      this.diff();
      const box = this.diffBox()?.nativeElement;
      const first = box?.querySelector<HTMLElement>('[data-change]');
      if (box && first) box.scrollTop = Math.max(0, first.offsetTop - box.clientHeight / 3);
    });
  }

  private async verify(yaml: string): Promise<WorkflowCheck | null> {
    try {
      return await firstValueFrom(this.http.post<WorkflowCheck>('/api/workflows/check', { yaml }));
    } catch {
      return null;
    }
  }

  private applyCheck(yaml: string, c: WorkflowCheck | null): void {
    if (yaml !== this.text() || !c) return; // risposta vecchia, il testo è già cambiato
    this.check.set(c);
    if (c.ok) this.lastValid.set(c.workflow);
  }

  protected select(key: string): void {
    this.key.set(key);
    this.saveError.set(false);
  }

  protected setText(yaml: string): void {
    const key = this.key();
    this.drafts.update((d) => {
      const next = { ...d, [key]: yaml };
      if (key !== NEW && yaml === this.base()) delete next[key];
      return next;
    });
  }

  protected discard(): void {
    const key = this.key();
    this.dropDraft(key);
    if (key === NEW) this.key.set(this.records()[0]?.name ?? NEW);
  }

  private dropDraft(key: string): void {
    this.drafts.update((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  /** Carica nel testo una versione precedente: salvandola diventa la più recente. */
  protected loadVersion(version: string): void {
    const v = this.versions().find((r) => String(r.version) === version);
    if (v) this.setText(v.yaml);
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const key = this.key();
    const yaml = this.text();
    this.saving.set(true);
    this.saveError.set(false);
    try {
      const rec = await firstValueFrom(this.http.post<WorkflowRecord>('/api/workflows', { yaml }));
      this.dropDraft(key);
      this.list.reload();
      this.key.set(rec.name);
      this.versionList.reload();
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 422)
        this.check.set({ ok: false, issues: (e.error as { issues: Issue[] }).issues });
      else this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  protected async assist(): Promise<void> {
    const request = this.ask().trim();
    if (!request || this.asking()) return;
    this.asking.set(true);
    this.askError.set(null);
    try {
      const p = await firstValueFrom(
        this.http.post<WorkflowProposal>('/api/workflows/assist', { yaml: this.text(), request }),
      );
      this.proposalCheck.set(await this.verify(p.yaml));
      this.proposal.set(p);
      this.ask.set('');
    } catch (e) {
      this.askError.set(
        e instanceof HttpErrorResponse && e.status === 409 ? 'wf.ask.offline' : 'wf.ask.error',
      );
    } finally {
      this.asking.set(false);
    }
  }

  /** La proposta passa nell'editor: va ancora salvata. */
  protected accept(p: WorkflowProposal): void {
    this.setText(p.yaml);
    this.proposal.set(null);
  }

  protected format(i: Issue): string {
    return formatIssue(i);
  }
  protected kindLabel(kind: WorkflowRecord['kind']): I18nKey {
    return `composer.kind.${kind}`;
  }
}
