import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'jk-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="border-b border-zinc-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <span class="font-mono text-lg font-semibold tracking-tight">jeko</span>
        <span class="text-sm text-zinc-500">SDLC locale</span>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-6">
      <router-outlet />
    </main>
  `,
})
export class App {}
