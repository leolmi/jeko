import { effect, Injectable, signal } from '@angular/core';
import { storage } from './storage';

export type Lang = 'it' | 'en';

const it = {
  'app.tagline': 'SDLC locale',
  'nav.chat': 'Chat',
  'nav.projects': 'Progetti',
  'runner.on': 'Runner collegato',
  'runner.off': 'Runner non collegato',
  'server.off': 'Server non raggiungibile',
  'theme.light': 'Tema chiaro',
  'theme.dark': 'Tema scuro',
  'theme.system': 'Tema di sistema',
  'theme.label': 'Tema',
  'lang.label': 'Lingua',

  'runs.new': 'Nuova richiesta',
  'runs.history': 'Cronologia',
  'runs.empty': 'Nessuna richiesta finora.',

  'status.queued': 'In coda',
  'status.running': 'In corso',
  'status.waiting': 'Attende te',
  'status.done': 'Fatto',
  'status.failed': 'Fallito',
  'status.rejected': 'Rifiutato',
  'status.cancelled': 'Annullato',

  'composer.title': 'Cosa facciamo?',
  'composer.subtitle': 'Descrivi la richiesta: Jeko segue il workflow e ti chiede ciò che serve.',
  'composer.kind': 'Tipo',
  'composer.kind.create': 'Nuovo progetto',
  'composer.kind.develop': 'Sviluppo',
  'composer.workflow': 'Workflow',
  'composer.noWorkflow': 'Nessun workflow di questo tipo.',
  'composer.request': 'Richiesta',
  'composer.request.create': 'Es. un gestionale delle ferie in Angular con backend Node…',
  'composer.request.develop': 'Es. aggiungi l’esportazione CSV alla lista ordini…',
  'composer.cwd': 'Cartella del progetto',
  'composer.mode': 'Controllo',
  'composer.mode.headless': 'Autonomo',
  'composer.mode.headless.hint': 'Si ferma solo ai gate obbligatori',
  'composer.mode.checkpoint': 'Checkpoint',
  'composer.mode.checkpoint.hint': 'Si ferma a tutti i gate e alle domande',
  'composer.mode.interactive': 'Interattivo',
  'composer.mode.interactive.hint': 'Come checkpoint, e rivedi ogni passo dell’agente',
  'composer.send': 'Avvia',
  'composer.shortcut': 'Ctrl+Invio per avviare',
  'composer.queued': 'Il runner non è collegato: la richiesta resta in coda.',
  'composer.error': 'Non è stato possibile avviare la richiesta.',

  'thread.notFound': 'Richiesta non trovata.',
  'thread.cancel': 'Annulla',
  'thread.you': 'Tu',
  'thread.step.running': 'In corso',
  'thread.step.skipped': 'saltato',
  'thread.output': 'Uscita',
  'thread.activity': 'Attività',
  'thread.policy': 'Azione sensibile',
  'thread.policy.approved': 'consentita',
  'thread.policy.denied': 'bloccata',
  'thread.finished.done': 'Completato',
  'thread.finished.failed': 'Interrotto per errore',
  'thread.finished.rejected': 'Fermato da un rifiuto',
  'thread.finished.cancelled': 'Annullato',

  'prompt.input': 'Dato richiesto',
  'prompt.ask': 'Domanda',
  'prompt.gate': 'Approvazione',
  'prompt.policy': 'Permesso',
  'prompt.review': 'Revisione',
  'prompt.answer': 'Rispondi',
  'prompt.skip': 'Salta',
  'prompt.other': 'Altro…',
  'prompt.default': 'Predefinito: {value}',
  'prompt.approve': 'Approva',
  'prompt.reject': 'Rifiuta',
  'prompt.note': 'Nota (facoltativa)',
  'prompt.ok': 'Va bene',
  'prompt.changes': 'Chiedi modifiche',
  'prompt.feedback': 'Cosa va cambiato?',
  'prompt.answered': 'Risposto',
  'prompt.skipped': 'nessuna risposta',
  'prompt.approved': 'Approvato',
  'prompt.rejected': 'Rifiutato',
  'prompt.reviewOk': 'Approvato',
  'prompt.reviewChanges': 'Modifiche richieste',
  'prompt.superseded': 'Non più valida',
  'prompt.error': 'Risposta non inviata, riprova.',

  'projects.title': 'Progetti',
  'projects.name': 'Nome del progetto',
  'projects.create': 'Crea',
  'projects.empty': 'Nessun progetto.',

  'splash.loading': 'Avvio in corso…',
  'splash.offline': 'Server non raggiungibile, riprovo…',
  'splash.offline.hint': 'Avvialo con npm run dev:server',

  'setup.title': 'Configurazione iniziale',
  'setup.step.welcome': 'Benvenuto',
  'setup.step.server': 'Server',
  'setup.step.runner': 'Runner',
  'setup.step.env': 'Ambiente',
  'setup.step.done': 'Fine',
  'setup.reopen': 'Rifai il primo avvio',
  'setup.close': 'Chiudi il primo avvio',
  'setup.next': 'Avanti',
  'setup.back': 'Indietro',
  'setup.recheck': 'Ricontrolla',
  'setup.checking': 'Verifica in corso…',
  'setup.start': 'Inizia a usare Jeko',
  'setup.blocked': 'Risolvi i punti in rosso per continuare.',
  'setup.warnings': 'Puoi continuare: i punti in giallo sono solo avvisi.',
  'setup.welcome.title': 'Benvenuto in Jeko',
  'setup.welcome.body':
    'In pochi passi verifichiamo che server, runner e claude siano pronti. Intanto scegli lingua e tema.',
  'setup.server.title': 'Server e database',
  'setup.server.body': 'Il server conserva workflow, richieste e cronologia.',
  'setup.runner.title': 'Collega il runner',
  'setup.runner.body':
    'Il runner gira sul tuo PC e lancia claude. Si collega lui al server: nessuna porta da aprire.',
  'setup.runner.install': 'Installa il runner',
  'setup.runner.installBody':
    "L'installer copia il runner nel tuo profilo, lo avvia e lo fa ripartire a ogni accesso. Contiene un token nuovo: quello di un installer precedente smette di valere.",
  'setup.runner.download': 'Scarica installer',
  'setup.runner.downloadError': "Non è stato possibile creare l'installer.",
  'setup.runner.run': 'Poi, in PowerShell:',
  'setup.runner.dev': 'Oppure, in sviluppo',
  'setup.runner.devToken':
    "Il runner di sviluppo usa il token scritto dall'installer (o JEKO_RUNNER_TOKEN).",
  'setup.runner.how': 'In un terminale, dalla cartella di Jeko:',
  'setup.runner.waiting': 'In attesa del runner…',
  'setup.runner.connected': 'Collegato: {id}',
  'setup.env.title': 'Ambiente del runner',
  'setup.env.body': 'Strumenti e permessi che servono a claude per lavorare in sicurezza.',
  'setup.env.waiting': 'In attesa delle verifiche dal runner…',
  'setup.done.title': 'Tutto pronto',
  'setup.done.body':
    'Puoi iniziare con una nuova richiesta: un progetto da creare o uno sviluppo su un progetto esistente.',
  'setup.copy': 'Copia',
  'setup.copied': 'Copiato',

  'check.server.api.title': 'API del server',
  'check.server.api.fix': 'Avvia il server con npm run dev:server.',
  'check.server.database.title': 'Database',
  'check.server.database.fix': 'Controlla DATABASE_URL e che Postgres sia avviato.',
  'check.server.workflows.title': 'Workflow disponibili',
  'check.server.workflows.fix': 'Nessun workflow: riavvia il server per caricare quelli di serie.',
  'check.node.title': 'Node.js 22 o successivo',
  'check.node.fix': 'Aggiorna Node.js alla versione 22.',
  'check.git.title': 'Git',
  'check.git.fix': 'Installa Git e verifica che sia nel PATH.',
  'check.claude.title': 'Claude Code installato',
  'check.claude.fix': 'Installa Claude Code oppure indica il comando in JEKO_CLAUDE_BIN.',
  'check.claude.auth.title': 'Accesso di Claude Code',
  'check.claude.auth.fix': 'Esegui claude una volta e fai il login (o imposta ANTHROPIC_API_KEY).',
  'check.dataDir.title': 'Cartella dati del runner',
  'check.dataDir.fix': 'La cartella deve essere scrivibile (JEKO_RUNNER_DATA per cambiarla).',
  'check.permissions.endpoint.title': 'Canale dei permessi',
  'check.permissions.endpoint.fix': 'Riavvia il runner: la named pipe dei permessi non è attiva.',
  'check.permissions.scripts.title': 'Server MCP e hook dei permessi',
  'check.permissions.scripts.fix':
    'Ricompila il runner (npm run build) o avvialo con npm run dev:runner.',
};

export type I18nKey = keyof typeof it;

const en: Record<I18nKey, string> = {
  'app.tagline': 'local SDLC',
  'nav.chat': 'Chat',
  'nav.projects': 'Projects',
  'runner.on': 'Runner connected',
  'runner.off': 'Runner not connected',
  'server.off': 'Server unreachable',
  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.system': 'System theme',
  'theme.label': 'Theme',
  'lang.label': 'Language',

  'runs.new': 'New request',
  'runs.history': 'History',
  'runs.empty': 'No requests yet.',

  'status.queued': 'Queued',
  'status.running': 'Running',
  'status.waiting': 'Needs you',
  'status.done': 'Done',
  'status.failed': 'Failed',
  'status.rejected': 'Rejected',
  'status.cancelled': 'Cancelled',

  'composer.title': 'What are we doing?',
  'composer.subtitle': 'Describe the request: Jeko follows the workflow and asks what it needs.',
  'composer.kind': 'Type',
  'composer.kind.create': 'New project',
  'composer.kind.develop': 'Development',
  'composer.workflow': 'Workflow',
  'composer.noWorkflow': 'No workflow of this type.',
  'composer.request': 'Request',
  'composer.request.create': 'E.g. a leave tracker in Angular with a Node backend…',
  'composer.request.develop': 'E.g. add CSV export to the orders list…',
  'composer.cwd': 'Project folder',
  'composer.mode': 'Control',
  'composer.mode.headless': 'Autonomous',
  'composer.mode.headless.hint': 'Stops only at mandatory gates',
  'composer.mode.checkpoint': 'Checkpoint',
  'composer.mode.checkpoint.hint': 'Stops at every gate and question',
  'composer.mode.interactive': 'Interactive',
  'composer.mode.interactive.hint': 'Like checkpoint, and you review every agent step',
  'composer.send': 'Start',
  'composer.shortcut': 'Ctrl+Enter to start',
  'composer.queued': 'The runner is not connected: the request stays queued.',
  'composer.error': 'Could not start the request.',

  'thread.notFound': 'Request not found.',
  'thread.cancel': 'Cancel',
  'thread.you': 'You',
  'thread.step.running': 'Running',
  'thread.step.skipped': 'skipped',
  'thread.output': 'Output',
  'thread.activity': 'Activity',
  'thread.policy': 'Sensitive action',
  'thread.policy.approved': 'allowed',
  'thread.policy.denied': 'blocked',
  'thread.finished.done': 'Completed',
  'thread.finished.failed': 'Stopped by an error',
  'thread.finished.rejected': 'Stopped by a rejection',
  'thread.finished.cancelled': 'Cancelled',

  'prompt.input': 'Input needed',
  'prompt.ask': 'Question',
  'prompt.gate': 'Approval',
  'prompt.policy': 'Permission',
  'prompt.review': 'Review',
  'prompt.answer': 'Answer',
  'prompt.skip': 'Skip',
  'prompt.other': 'Something else…',
  'prompt.default': 'Default: {value}',
  'prompt.approve': 'Approve',
  'prompt.reject': 'Reject',
  'prompt.note': 'Note (optional)',
  'prompt.ok': 'Looks good',
  'prompt.changes': 'Request changes',
  'prompt.feedback': 'What should change?',
  'prompt.answered': 'Answered',
  'prompt.skipped': 'no answer',
  'prompt.approved': 'Approved',
  'prompt.rejected': 'Rejected',
  'prompt.reviewOk': 'Approved',
  'prompt.reviewChanges': 'Changes requested',
  'prompt.superseded': 'No longer valid',
  'prompt.error': 'Answer not sent, try again.',

  'projects.title': 'Projects',
  'projects.name': 'Project name',
  'projects.create': 'Create',
  'projects.empty': 'No projects.',

  'splash.loading': 'Starting…',
  'splash.offline': 'Server unreachable, retrying…',
  'splash.offline.hint': 'Start it with npm run dev:server',

  'setup.title': 'Initial setup',
  'setup.step.welcome': 'Welcome',
  'setup.step.server': 'Server',
  'setup.step.runner': 'Runner',
  'setup.step.env': 'Environment',
  'setup.step.done': 'Done',
  'setup.reopen': 'Run first-time setup again',
  'setup.close': 'Close setup',
  'setup.next': 'Next',
  'setup.back': 'Back',
  'setup.recheck': 'Check again',
  'setup.checking': 'Checking…',
  'setup.start': 'Start using Jeko',
  'setup.blocked': 'Fix the red items to continue.',
  'setup.warnings': 'You can continue: yellow items are only warnings.',
  'setup.welcome.title': 'Welcome to Jeko',
  'setup.welcome.body':
    'In a few steps we check that server, runner and claude are ready. Meanwhile, pick language and theme.',
  'setup.server.title': 'Server and database',
  'setup.server.body': 'The server keeps workflows, requests and history.',
  'setup.runner.title': 'Connect the runner',
  'setup.runner.body':
    'The runner runs on your PC and launches claude. It connects to the server itself: no ports to open.',
  'setup.runner.install': 'Install the runner',
  'setup.runner.installBody':
    'The installer copies the runner into your profile, starts it and restarts it at every sign-in. It carries a new token: the one from any earlier installer stops working.',
  'setup.runner.download': 'Download installer',
  'setup.runner.downloadError': 'Could not create the installer.',
  'setup.runner.run': 'Then, in PowerShell:',
  'setup.runner.dev': 'Or, during development',
  'setup.runner.devToken':
    'The development runner uses the token written by the installer (or JEKO_RUNNER_TOKEN).',
  'setup.runner.how': 'In a terminal, from the Jeko folder:',
  'setup.runner.waiting': 'Waiting for the runner…',
  'setup.runner.connected': 'Connected: {id}',
  'setup.env.title': 'Runner environment',
  'setup.env.body': 'Tools and permissions claude needs to work safely.',
  'setup.env.waiting': 'Waiting for the runner checks…',
  'setup.done.title': 'All set',
  'setup.done.body':
    'You can start with a new request: a project to create or work on an existing one.',
  'setup.copy': 'Copy',
  'setup.copied': 'Copied',

  'check.server.api.title': 'Server API',
  'check.server.api.fix': 'Start the server with npm run dev:server.',
  'check.server.database.title': 'Database',
  'check.server.database.fix': 'Check DATABASE_URL and that Postgres is running.',
  'check.server.workflows.title': 'Available workflows',
  'check.server.workflows.fix': 'No workflows: restart the server to load the built-in ones.',
  'check.node.title': 'Node.js 22 or later',
  'check.node.fix': 'Upgrade Node.js to version 22.',
  'check.git.title': 'Git',
  'check.git.fix': 'Install Git and make sure it is on the PATH.',
  'check.claude.title': 'Claude Code installed',
  'check.claude.fix': 'Install Claude Code or set the command in JEKO_CLAUDE_BIN.',
  'check.claude.auth.title': 'Claude Code sign-in',
  'check.claude.auth.fix': 'Run claude once and sign in (or set ANTHROPIC_API_KEY).',
  'check.dataDir.title': 'Runner data folder',
  'check.dataDir.fix': 'The folder must be writable (JEKO_RUNNER_DATA to change it).',
  'check.permissions.endpoint.title': 'Permission channel',
  'check.permissions.endpoint.fix': 'Restart the runner: the permission named pipe is not active.',
  'check.permissions.scripts.title': 'Permission MCP server and hook',
  'check.permissions.scripts.fix':
    'Rebuild the runner (npm run build) or start it with npm run dev:runner.',
};

const DICT: Record<Lang, Record<I18nKey, string>> = { it, en };

function initialLang(): Lang {
  const saved = storage.get('lang');
  if (saved === 'it' || saved === 'en') return saved;
  return globalThis.navigator?.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Traduzioni: `t()` legge il segnale della lingua, i template si aggiornano da soli. */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(initialLang());

  constructor() {
    effect(() => {
      document.documentElement.lang = this.lang();
      storage.set('lang', this.lang());
    });
  }

  t(key: I18nKey, params?: Record<string, string | number>): string {
    let text = DICT[this.lang()][key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v));
    return text;
  }

  /** "3 minuti fa", "yesterday"… */
  ago(iso: string): string {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(this.lang(), { numeric: 'auto' });
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
      ['second', 60],
      ['minute', 60],
      ['hour', 24],
      ['day', 7],
      ['week', 4.35],
      ['month', 12],
    ];
    let value = diff;
    for (const [unit, size] of steps) {
      if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
      value /= size;
    }
    return rtf.format(Math.round(value), 'year');
  }

  time(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { timeStyle: 'short' }).format(new Date(iso));
  }
}
