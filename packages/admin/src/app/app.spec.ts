import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SetupStatus } from '@jeko/shared';
import { App } from './app';
import { Realtime } from './core/realtime';
import { Setup } from './core/setup';

const status = (completed: boolean): SetupStatus => ({
  completed,
  server: { version: '0.1.0', database: true, workflows: 2 },
  runner: { connected: false, checks: null, token: false },
});

async function render(s: SetupStatus | null) {
  const setup = {
    status: signal(s),
    offline: signal(s === null),
    load: () => new Promise<null>(() => undefined),
    recheck: async () => undefined,
    complete: async () => undefined,
  };
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: Setup, useValue: setup },
      {
        provide: Realtime,
        useValue: {
          start: () => undefined,
          online: signal(true),
          runner: signal({ connected: false }),
          on: () => () => undefined,
          onReconnect: () => () => undefined,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(App);
  await new Promise((r) => setTimeout(r, 650));
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('App', () => {
  it('mostra lo splash finché il server non risponde', async () => {
    const el = await render(null);
    expect(el.querySelector('jk-splash')).not.toBeNull();
  });

  it('apre il wizard al primo avvio', async () => {
    const el = await render(status(false));
    expect(el.querySelector('jk-wizard')).not.toBeNull();
  });

  it('mostra l’app a configurazione fatta', async () => {
    const el = await render(status(true));
    expect(el.querySelector('header')?.textContent).toContain('jeko');
  });
});
