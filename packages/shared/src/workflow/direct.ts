import type { Workflow } from './schema.js';

/** Nome delle run dirette: non è un workflow salvato, si costruisce al volo. */
export const DIRECT_WORKFLOW = 'diretto';

/**
 * Richiesta del messaggio seguente di un task diretto: la risposta è un nuovo turno di claude
 * nella stessa sessione; nessuna risposta chiude il task.
 */
export const DIRECT_FOLLOW_UP = 'seguito';

/**
 * Task diretto, senza il workflow di sviluppo: claude esegue la richiesta così com'è nella
 * cartella del progetto, senza piano, gate né controlli (es. "fai commit e push"). Dopo la
 * risposta resta aperto come una conversazione, finché l'utente non lo chiude.
 */
export function directWorkflow(): Workflow {
  return {
    name: DIRECT_WORKFLOW,
    kind: 'develop',
    version: 1,
    description: 'Esegue la richiesta direttamente, senza il workflow di sviluppo',
    steps: [{ id: 'diretto', type: 'agent', title: 'Task diretto', instructions: '{{ request }}' }],
  };
}
