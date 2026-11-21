export interface LifecycleOptions {
  /** Finestre dell'app collegate (pagine admin). */
  windows: () => number;
  /** Run in coda o al lavoro: quelle ferme a una domanda o a un gate non contano. */
  activeRuns: () => number;
  onIdle: () => void;
  /** Ogni quanto si guarda; si esce dopo due controlli di fila senza nulla da fare. */
  intervalMs?: number;
}

/**
 * Vita del servizio nell'app desktop: parte con l'exe e si chiude quando non ci sono più
 * finestre né task attivi. Chiusa la finestra con dei task al lavoro, resta acceso finché
 * non finiscono o si fermano a un gate; i task fermi riprendono al prossimo avvio.
 */
export class Lifecycle {
  private armed = false;
  private idleTicks = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly opts: LifecycleOptions) {
    this.timer = setInterval(() => this.tick(), opts.intervalMs ?? 2000);
    this.timer.unref();
  }

  /**
   * Da qui in poi il servizio può uscire: dopo che una finestra si è collegata (prima, mentre
   * l'app si apre, non c'è ancora nessuna finestra) o dopo che Neutralino si è chiuso.
   */
  arm(): void {
    this.armed = true;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private tick(): void {
    if (this.opts.windows() > 0) this.armed = true;
    const idle = this.armed && this.opts.windows() === 0 && this.opts.activeRuns() === 0;
    this.idleTicks = idle ? this.idleTicks + 1 : 0;
    // Due controlli di fila: una pagina che si ricarica non fa uscire il servizio.
    if (this.idleTicks >= 2) {
      this.stop();
      this.opts.onIdle();
    }
  }
}
