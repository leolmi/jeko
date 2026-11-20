import { Injectable, signal } from '@angular/core';
import type { AdminMessage } from '@jeko/shared';

type Listener = (msg: AdminMessage) => void;

/**
 * Canale in sola lettura dal server (/ws/admin), con riconnessione automatica.
 * Alla riconnessione chi ascolta ricarica lo stato: i messaggi persi non vengono reinviati.
 */
@Injectable({ providedIn: 'root' })
export class Realtime {
  /** Socket col server aperto. */
  readonly online = signal(false);
  readonly runner = signal<{ connected: boolean; runnerId?: string }>({ connected: false });

  private readonly listeners = new Set<Listener>();
  private readonly reconnects = new Set<() => void>();
  private started = false;
  private everOpen = false;

  start(): void {
    if (this.started || typeof WebSocket === 'undefined') return;
    this.started = true;
    this.connect();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Chiamata a ogni riconnessione dopo la prima. */
  onReconnect(fn: () => void): () => void {
    this.reconnects.add(fn);
    return () => this.reconnects.delete(fn);
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/admin`);
    ws.onopen = () => {
      this.online.set(true);
      if (this.everOpen) for (const fn of this.reconnects) fn();
      this.everOpen = true;
    };
    ws.onmessage = (e) => {
      let msg: AdminMessage;
      try {
        msg = JSON.parse(String(e.data)) as AdminMessage;
      } catch {
        return;
      }
      if (msg.type === 'runner')
        this.runner.set({
          connected: msg.connected,
          ...(msg.runnerId !== undefined && { runnerId: msg.runnerId }),
        });
      for (const fn of this.listeners) fn(msg);
    };
    ws.onclose = () => {
      this.online.set(false);
      this.runner.set({ connected: false });
      setTimeout(() => this.connect(), 2000);
    };
  }
}
