import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { EFFORTS, MODEL_ALIASES, type AgentChoice, type Effort } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Icon } from './icon';

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Nome mostrato di un modello: `opus` → Opus, `claude-opus-5-5` → Opus 5.5 (senza date né
 * suffissi come `[1m]`); gli altri come sono.
 */
export function modelLabel(m: string): string {
  if ((MODEL_ALIASES as readonly string[]).includes(m)) return cap(m);
  const parts = m
    .replace(/^claude-/, '')
    .replace(/\[.*\]$/, '')
    .split('-')
    .filter((p) => !/^\d{8}$/.test(p));
  const [name, ...nums] = parts;
  return name && /^[a-z]+$/.test(name) && nums.length && nums.every((n) => /^\d+$/.test(n))
    ? `${cap(name)} ${nums.join('.')}`
    : m;
}

const ITEM =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-subtle';
const PANEL = 'rounded-xl border border-line bg-surface p-1 shadow-xl';

/**
 * Modello e impegno di claude in un solo pulsante: il menu elenca i modelli, il sottomenu
 * l'impegno. «Predefinito» lascia il valore di `inherited` (del progetto) o, senza, quello
 * di claude: del modello si mostra quale, se noto (`defaultModel`).
 */
@Component({
  selector: 'jk-agent-choice',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-block',
    '(document:click)': 'outside($event)',
    '(document:keydown.escape)': 'close()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg hover:bg-subtle"
      [class]="up() ? 'px-2 py-1 text-xs' : 'border border-line bg-surface px-3 py-2 text-sm'"
      aria-haspopup="menu"
      [attr.aria-expanded]="!!open()"
      [attr.aria-label]="i18n.t('agent.title')"
      [title]="i18n.t('agent.title')"
      (click)="toggle()"
    >
      <span class="font-medium">{{ shown().model }}</span>
      @if (shown().effort; as e) {
        <span class="text-faint">{{ e }}</span>
      }
      <jk-icon name="expand_more" [size]="14" class="text-faint" />
    </button>

    @if (open(); as at) {
      <!-- Fisso, calcolato dal pulsante: un contenitore che scorre non lo taglia. -->
      <div
        role="menu"
        class="fixed z-50 w-60"
        [style.left.px]="at.left"
        [style.top.px]="at.top"
        [style.bottom.px]="at.bottom"
      >
        <div [class]="PANEL">
          <button
            type="button"
            role="menuitemradio"
            [attr.aria-checked]="!value().model"
            [class]="ITEM"
            (click)="setModel('')"
          >
            <span>{{ i18n.t('agent.default') }}</span>
            <span class="truncate text-xs text-faint">{{ defaultNote().model }}</span>
            @if (!value().model) {
              <jk-icon name="check" [size]="16" class="ml-auto shrink-0 text-sky-500" />
            }
          </button>
          @for (m of models(); track m.id) {
            <button
              type="button"
              role="menuitemradio"
              [attr.aria-checked]="value().model === m.id"
              [class]="ITEM"
              (click)="setModel(m.id)"
            >
              <span class="truncate">{{ m.label }}</span>
              @if (value().model === m.id) {
                <jk-icon name="check" [size]="16" class="ml-auto shrink-0 text-sky-500" />
              }
            </button>
          }
          <div class="mx-1 my-1 h-px bg-line"></div>
          <div class="relative" (mouseenter)="sub.set(true)" (mouseleave)="sub.set(false)">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              [attr.aria-expanded]="sub()"
              [class]="ITEM"
              [class.bg-subtle]="sub()"
              (click)="sub.set(!sub())"
            >
              <span>{{ i18n.t('agent.effort') }}</span>
              <span class="ml-auto text-xs text-faint">{{ effortText() }}</span>
              <jk-icon name="chevron_right" [size]="16" class="text-faint" />
            </button>
            @if (sub()) {
              <div role="menu" class="absolute bottom-0 left-full z-50 w-64 pl-1.5">
                <div [class]="PANEL">
                  <p class="px-2.5 pt-1.5 pb-2 text-xs text-muted">
                    {{ i18n.t('agent.effort.hint') }}
                  </p>
                  <button
                    type="button"
                    role="menuitemradio"
                    [attr.aria-checked]="!value().effort"
                    [class]="ITEM"
                    (click)="setEffort('')"
                  >
                    <span>{{ i18n.t('agent.default') }}</span>
                    <span class="truncate text-xs text-faint">{{ defaultNote().effort }}</span>
                    @if (!value().effort) {
                      <jk-icon name="check" [size]="16" class="ml-auto shrink-0 text-sky-500" />
                    }
                  </button>
                  @for (e of efforts; track e) {
                    <button
                      type="button"
                      role="menuitemradio"
                      [attr.aria-checked]="value().effort === e"
                      [class]="ITEM"
                      (click)="setEffort(e)"
                    >
                      <span>{{ effortLabel(e) }}</span>
                      @if (value().effort === e) {
                        <jk-icon name="check" [size]="16" class="ml-auto shrink-0 text-sky-500" />
                      }
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class AgentChoiceSelect {
  protected readonly i18n = inject(I18n);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly value = model.required<AgentChoice>();
  /** Valori che «Predefinito» lascia (del progetto). */
  readonly inherited = input<AgentChoice | undefined>();
  /** Modello predefinito di claude, se noto. */
  readonly defaultModel = input<string | undefined>();
  /** Il menu si apre verso l'alto (es. nel composer in fondo alla pagina). */
  readonly up = input(false);

  protected readonly ITEM = ITEM;
  protected readonly PANEL = PANEL;
  protected readonly efforts = EFFORTS;
  /** Menu aperto: dove, in coordinate della finestra; null se chiuso. */
  protected readonly open = signal<{ left: number; top?: number; bottom?: number } | null>(null);
  protected readonly sub = signal(false);
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');

  constructor() {
    // Scorrendo o ridimensionando il menu resterebbe staccato dal pulsante: si chiude.
    const onScroll = (e: Event) => {
      if (this.open() && !this.el.nativeElement.contains(e.target as Node)) this.close();
    };
    const onResize = () => this.close();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    });
  }

  /** Gli alias, con la versione se è quella del predefinito; più un modello scelto fuori elenco. */
  protected readonly models = computed(() => {
    const d = this.defaultModel();
    const known = d ? modelLabel(d) : '';
    const list = MODEL_ALIASES.map((id) => ({
      id: id as string,
      label: known.startsWith(`${cap(id)} `) ? known : cap(id),
    }));
    const extra = [this.value().model, this.inherited()?.model].filter(
      (m): m is string => !!m && !list.some((x) => x.id === m),
    );
    return [...list, ...[...new Set(extra)].map((id) => ({ id, label: modelLabel(id) }))];
  });

  /** Cosa vale con «Predefinito». */
  protected readonly defaultNote = computed(() => {
    const p = this.inherited();
    const d = this.defaultModel();
    const project = (v: string) => this.i18n.t('agent.inherit', { v });
    return {
      model: p?.model ? project(this.labelOf(p.model)) : d ? modelLabel(d) : '',
      effort: p?.effort ? project(this.effortLabel(p.effort)) : '',
    };
  });

  protected readonly effortText = computed(() => {
    const e = this.value().effort ?? this.inherited()?.effort;
    return e ? this.effortLabel(e) : this.i18n.t('agent.default');
  });

  /** Testo del pulsante: il modello e l'impegno che varranno. */
  protected readonly shown = computed(() => {
    const m = this.value().model ?? this.inherited()?.model;
    const d = this.defaultModel();
    const e = this.value().effort ?? this.inherited()?.effort;
    return {
      model: m ? this.labelOf(m) : d ? modelLabel(d) : this.i18n.t('agent.model.default'),
      effort: e ? this.effortLabel(e) : '',
    };
  });

  protected effortLabel(e: Effort): string {
    return this.i18n.t(`agent.effort.${e}`);
  }

  private labelOf(id: string): string {
    return this.models().find((m) => m.id === id)?.label ?? modelLabel(id);
  }

  protected toggle(): void {
    this.sub.set(false);
    if (this.open()) return this.open.set(null);
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const gap = 6;
    this.open.set(
      this.up()
        ? { left: r.left, bottom: window.innerHeight - r.top + gap }
        : { left: r.left, top: r.bottom + gap },
    );
  }

  protected close(): void {
    this.open.set(null);
    this.sub.set(false);
  }

  protected outside(e: MouseEvent): void {
    if (this.open() && !this.el.nativeElement.contains(e.target as Node)) this.close();
  }

  protected setModel(v: string): void {
    const { model: _, ...rest } = this.value();
    this.value.set(v ? { ...rest, model: v } : rest);
    this.close();
  }

  protected setEffort(v: string): void {
    const { effort: _, ...rest } = this.value();
    this.value.set(v ? { ...rest, effort: v as Effort } : rest);
    this.close();
  }
}
