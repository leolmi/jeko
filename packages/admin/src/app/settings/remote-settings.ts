import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import type { RemoteInfo } from '@jeko/shared';
import qrcode from 'qrcode-generator';
import { firstValueFrom } from 'rxjs';
import { I18n } from '../core/i18n';
import { Realtime } from '../core/realtime';
import { Icon } from '../ui/icon';

/** Accesso remoto: relay, collegamento di un dispositivo col QR, dispositivi da confermare. */
@Component({
  selector: 'jk-remote-settings',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block rounded-xl border border-line bg-surface p-4' },
  template: `
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">{{ i18n.t('remote.title') }}</p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('remote.hint') }}</p>
      </div>
      @if (info(); as r) {
        <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted" role="status">
          <span
            class="size-2 rounded-full"
            [class]="
              r.status === 'online'
                ? 'bg-emerald-500'
                : r.status === 'off'
                  ? 'bg-line'
                  : r.status === 'rejected'
                    ? 'bg-red-500'
                    : 'bg-amber-500'
            "
          ></span>
          {{ statusLabel(r.status) }}
        </span>
      }
    </div>

    <form class="mt-3 flex flex-wrap items-center gap-2" (submit)="$event.preventDefault(); save()">
      <input
        class="jk-input min-w-0 flex-1 font-mono"
        type="url"
        placeholder="https://relay.example.org"
        [attr.aria-label]="i18n.t('remote.relay')"
        [value]="url()"
        (input)="url.set($any($event.target).value)"
      />
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          [checked]="enabled()"
          (change)="enabled.set($any($event.target).checked)"
        />
        {{ i18n.t('remote.enabled') }}
      </label>
      <button class="jk-btn-primary shrink-0" type="submit" [disabled]="busy()">
        <jk-icon name="save" [size]="16" /> {{ i18n.t('remote.save') }}
      </button>
      <label class="flex w-full items-center gap-2 text-sm">
        <input
          type="checkbox"
          [checked]="localRelay()"
          (change)="localRelay.set($any($event.target).checked)"
        />
        {{ i18n.t('remote.local') }}
      </label>
      @if (localRelay()) {
        <p class="w-full text-xs text-faint">{{ i18n.t('remote.local.hint') }}</p>
        @if (info()?.localRelayError; as e) {
          <p class="w-full text-xs text-red-600 dark:text-red-400">
            {{ i18n.t('remote.local.error', { e }) }}
          </p>
        }
      } @else {
        <div class="flex w-full items-center gap-2">
          <input
            class="jk-input min-w-0 flex-1 font-mono"
            type="password"
            autocomplete="new-password"
            [attr.aria-label]="i18n.t('remote.secret')"
            [placeholder]="
              info()?.hasSecret && !clearSecret()
                ? i18n.t('remote.secret.set')
                : i18n.t('remote.secret.placeholder')
            "
            [value]="secret()"
            (input)="secret.set($any($event.target).value); clearSecret.set(false)"
          />
          @if (info()?.hasSecret && !clearSecret() && !secret()) {
            <button type="button" class="jk-btn-ghost shrink-0" (click)="clearSecret.set(true)">
              <jk-icon name="close" [size]="16" /> {{ i18n.t('remote.secret.remove') }}
            </button>
          }
        </div>
        <p class="w-full text-xs text-faint">{{ i18n.t('remote.secret.hint') }}</p>
      }
    </form>
    @if (error(); as e) {
      <p class="mt-2 text-xs text-red-600 dark:text-red-400">{{ e }}</p>
    }

    @if (info()?.enabled) {
      <div class="mt-4 flex items-center gap-3">
        <p class="flex-1 text-sm font-medium">{{ i18n.t('remote.devices') }}</p>
        <button type="button" class="jk-btn-outline shrink-0" [disabled]="busy()" (click)="pair()">
          <jk-icon name="add" [size]="16" /> {{ i18n.t('remote.pair') }}
        </button>
      </div>

      @if (pairing(); as p) {
        <div class="mt-3 flex flex-wrap items-start gap-4 rounded-lg border border-line p-3">
          <img class="size-48 rounded bg-white p-1" [src]="p.qr" [alt]="i18n.t('remote.qr')" />
          <div class="min-w-0 flex-1 text-sm">
            <p>{{ i18n.t('remote.pair.hint') }}</p>
            <p class="mt-2 text-xs text-faint">{{ i18n.t('remote.pair.secret') }}</p>
            <div class="mt-3 flex gap-2">
              <button type="button" class="jk-btn-outline" (click)="copy(p.link)">
                <jk-icon name="code" [size]="16" />
                {{ i18n.t(copied() ? 'remote.copied' : 'remote.copy') }}
              </button>
              <button type="button" class="jk-btn-ghost" (click)="pairing.set(null)">
                <jk-icon name="close" [size]="16" /> {{ i18n.t('remote.pair.close') }}
              </button>
            </div>
          </div>
        </div>
      }

      <ul class="mt-2 divide-y divide-line">
        @for (d of info()?.devices ?? []; track d.id) {
          <li class="flex items-center gap-3 py-2">
            <span
              class="size-2 shrink-0 rounded-full"
              [class]="d.online ? 'bg-emerald-500' : 'bg-line'"
            ></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ d.name ?? i18n.t('remote.device.unnamed') }}</p>
              <p class="text-xs text-faint">
                @if (d.confirmed) {
                  {{ i18n.t('remote.device.active') }}
                } @else if (d.seenAt) {
                  {{ i18n.t('remote.device.toConfirm') }}
                } @else {
                  {{ i18n.t('remote.device.waiting', { t: time(d.expiresAt) }) }}
                }
              </p>
            </div>
            @if (!d.confirmed && d.seenAt) {
              <button type="button" class="jk-btn-primary shrink-0" (click)="confirm(d.id)">
                <jk-icon name="check" [size]="16" /> {{ i18n.t('remote.confirm') }}
              </button>
            }
            <button
              type="button"
              class="jk-btn-danger shrink-0"
              [attr.aria-label]="i18n.t('remote.revoke')"
              (click)="revoke(d.id, d.confirmed)"
            >
              <jk-icon name="delete" [size]="16" />
            </button>
          </li>
        } @empty {
          <li class="py-2 text-xs text-faint">{{ i18n.t('remote.devices.none') }}</li>
        }
      </ul>
    }
  `,
})
export class RemoteSettings {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly info = signal<RemoteInfo | null>(null);
  protected readonly url = signal('');
  protected readonly enabled = signal(false);
  protected readonly localRelay = signal(false);
  /** Segreto nuovo da salvare; vuoto = resta quello di prima (salvo `clearSecret`). */
  protected readonly secret = signal('');
  protected readonly clearSecret = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pairing = signal<{ id: string; link: string; qr: string } | null>(null);
  protected readonly copied = signal(false);

  constructor() {
    void this.load(true);
    const off = inject(Realtime).on((msg) => {
      if (msg.type !== 'remote') return;
      void this.load(false);
    });
    inject(DestroyRef).onDestroy(off);
  }

  protected time(iso: string | null): string {
    return iso ? this.i18n.time(iso) : '';
  }

  protected statusLabel(s: RemoteInfo['status']): string {
    const keys = {
      off: 'remote.status.off',
      connecting: 'remote.status.connecting',
      online: 'remote.status.online',
      offline: 'remote.status.offline',
      rejected: 'remote.status.rejected',
    } as const;
    return this.i18n.t(keys[s]);
  }

  private async load(form: boolean): Promise<void> {
    const r = await firstValueFrom(this.http.get<RemoteInfo>('/api/remote'));
    this.set(r, form);
  }

  private set(r: RemoteInfo, form: boolean): void {
    this.info.set(r);
    if (form) {
      this.url.set(r.relayUrl);
      this.enabled.set(r.enabled);
      this.localRelay.set(r.localRelay);
    }
    // Il dispositivo del QR si è collegato: il QR non serve più.
    const p = this.pairing();
    if (p && r.devices.find((d) => d.id === p.id)?.seenAt) this.pairing.set(null);
  }

  protected save(): Promise<void> {
    return this.run(async () => {
      const r = await firstValueFrom(
        this.http.put<RemoteInfo>('/api/remote', {
          enabled: this.enabled(),
          relayUrl: this.url().trim().replace(/\/+$/, ''),
          localRelay: this.localRelay(),
          ...(this.clearSecret()
            ? { secret: '' }
            : this.secret().trim() && { secret: this.secret().trim() }),
        }),
      );
      this.secret.set('');
      this.clearSecret.set(false);
      this.set(r, true);
    });
  }

  protected pair(): Promise<void> {
    return this.run(async () => {
      const res = await firstValueFrom(
        this.http.post<{ id: string; link: string }>('/api/remote/devices', {}),
      );
      const qr = qrcode(0, 'M');
      qr.addData(res.link);
      qr.make();
      this.copied.set(false);
      this.pairing.set({ ...res, qr: qr.createDataURL(6, 2) });
    });
  }

  protected confirm(id: string): Promise<void> {
    return this.run(async () => {
      this.set(
        await firstValueFrom(this.http.post<RemoteInfo>(`/api/remote/devices/${id}/confirm`, {})),
        false,
      );
    });
  }

  protected revoke(id: string, confirmed: boolean): Promise<void> {
    if (confirmed && !globalThis.confirm(this.i18n.t('remote.revoke.confirm')))
      return Promise.resolve();
    return this.run(async () => {
      if (this.pairing()?.id === id) this.pairing.set(null);
      this.set(
        await firstValueFrom(this.http.delete<RemoteInfo>(`/api/remote/devices/${id}`)),
        false,
      );
    });
  }

  protected async copy(link: string): Promise<void> {
    await navigator.clipboard.writeText(link);
    this.copied.set(true);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof HttpErrorResponse ? (e.error?.message ?? e.message) : String(e);
      this.error.set(msg);
    } finally {
      this.busy.set(false);
    }
  }
}
