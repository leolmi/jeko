import { effect, inject, Injectable, signal } from '@angular/core';
import type { AgentUsage } from '@jeko/shared';
import { formatDate, formatDayMonth, Formats, formatTime } from './formats';
import { storage } from './storage';

export type Lang = 'it' | 'en';

const it = {
  'app.tagline': 'SDLC locale',
  'nav.projects': 'Progetti',
  'nav.workflows': 'Workflow',
  'nav.stats': 'Statistiche',
  'stats.title': 'Statistiche',
  'stats.hint': 'Sulle run ancora presenti: quelle eliminate non contano.',
  'stats.project': 'Progetto',
  'stats.allProjects': 'Tutti i progetti',
  'stats.period': 'Periodo',
  'stats.days': '{n} giorni',
  'stats.all': 'Tutto',
  'stats.tasks': 'Task',
  'stats.tasks.detail': '{done} completati · {failed} falliti · {other} altri',
  'stats.cost': 'Costo stimato',
  'stats.tokens': 'Token',
  'stats.time': 'Lavoro di claude',
  'stats.split': '{plan} segui workflow · {direct} richiesta libera',
  'stats.trend': 'Andamento',
  'stats.metric': 'Misura',
  'stats.metric.cost': 'Costo',
  'stats.metric.tokens': 'Token',
  'stats.metric.runs': 'Task',
  'stats.byProject': 'Per progetto',
  'stats.col.project': 'Progetto',
  'stats.col.tasks': 'Task',
  'stats.col.done': 'Completati',
  'stats.col.failed': 'Falliti',
  'stats.noProject': 'Fuori da un progetto',
  'stats.steps': 'Dove va il costo: i passi',
  'stats.steps.hint': 'Passi agent sommati su tutte le run del periodo, dal più caro.',
  'stats.steps.runs': '{n} esecuzioni',
  'stats.empty': 'Nessun task nel periodo.',
  'stats.error': 'Statistiche non disponibili.',
  'runner.on': 'Runner collegato',
  'runner.off': 'Runner non collegato',
  'server.off': 'Server non raggiungibile',
  'theme.light': 'Tema chiaro',
  'theme.dark': 'Tema scuro',
  'theme.system': 'Tema di sistema',
  'theme.label': 'Tema',
  'lang.label': 'Lingua',

  'ws.add': 'Nuovo progetto',
  'ws.search': 'Cerca un progetto…',
  'ws.sort': 'Ordina',
  'ws.sort.activity': 'Attività',
  'ws.sort.waiting': 'Ti aspettano',
  'ws.sort.name': 'Nome',
  'ws.noMatch': 'Nessun progetto trovato.',
  'ws.empty': 'Nessun progetto: aggiungine uno.',
  'ws.creating': 'In creazione',
  'ws.draft': 'Testo in sospeso',
  'ws.waiting': 'Ti aspettano',
  'ws.inProgress': 'Aperti',

  'tasks.empty': 'Nessun task aperto.',
  'tasks.showClosed': 'Mostra chiusi ({n})',
  'tasks.hideClosed': 'Nascondi chiusi',
  'tasks.remove': 'Togli dall’elenco',
  'tasks.terminal': 'Apri un terminale nella cartella del progetto',
  'tasks.terminal.error': 'Terminale non aperto: il runner è collegato?',
  'tasks.remove.confirm': 'Togliere «{name}» dall’elenco? La cartella e i task restano.',
  'tasks.delete': 'Elimina il task',
  'tasks.delete.confirm': 'Eliminare il task «{request}» con tutta la sua storia?',
  'tasks.deleteClosed': 'Elimina i {n} task conclusi',
  'tasks.deleteClosed.confirm': 'Eliminare i {n} task conclusi con tutta la loro storia?',
  'tasks.delete.error': 'Eliminazione non riuscita.',
  'tasks.back': 'Task del progetto',
  'tasks.none': 'Scegli o aggiungi un progetto a sinistra.',
  'tasks.noPath': 'Questo progetto non ha una cartella: aggiungilo di nuovo.',
  'tasks.workflow.hint': 'Workflow che guida i task del progetto',
  'project.settings': 'Opzioni del progetto',
  'project.settings.title': 'Opzioni di {name}',
  'project.workflow': 'Workflow di sviluppo',
  'project.workflow.hint':
    'Il percorso che il progetto segue per ogni fix o implementazione. Vale sempre l’ultima versione del workflow scelto.',
  'project.workflow.open':
    'Vale dai prossimi task: i {n} già aperti continuano col workflow con cui sono partiti.',
  'agent.title': 'Modello e impegno',
  'agent.hint':
    'Predefiniti dei task del progetto; si cambiano anche per il singolo task. I passi del workflow che li fissano tengono i loro.',
  'agent.default': 'Predefinito',
  'agent.model.default': 'Modello predefinito',
  'agent.inherit': 'progetto: {v}',
  'agent.effort': 'Impegno',
  'agent.effort.hint':
    'Più impegno vuol dire risposte più approfondite, ma più tempo e più consumo.',
  'agent.effort.low': 'Basso',
  'agent.effort.medium': 'Medio',
  'agent.effort.high': 'Alto',
  'agent.effort.xhigh': 'Molto alto',
  'agent.effort.max': 'Massimo',
  'prompts.title': 'Prompt del progetto',
  'prompts.hint':
    'In .jeko/prompts/: i passi «prompt» del workflow li eseguono; se un prompt manca, il passo si salta.',
  'prompts.add': 'Nuovo prompt',
  'prompts.empty': 'Nessun prompt.',
  'prompts.missing': 'non presente',
  'prompts.used': 'nel workflow',
  'prompts.used.hint': 'Il workflow del progetto ha un passo che lo esegue',
  'prompts.create': 'Crea',
  'prompts.edit': 'Modifica',
  'prompts.delete': 'Elimina il prompt',
  'prompts.delete.confirm': 'Eliminare il prompt «{name}» dal progetto?',
  'prompts.name': 'Nome (minuscole, cifre e trattini)',
  'prompts.text': 'Prompt',
  'prompts.text.placeholder':
    'Es. aumenta la versione (patch per un fix, minor per una funzione), fai commit e push, poi npm run release.',
  'prompts.cancel': 'Annulla',
  'prompts.offline': 'Prompt non disponibili: il runner è collegato?',
  'project.save': 'Salva',
  'project.saved': 'Salvato.',
  'context.title': 'Contesto di claude',
  'context.hint':
    'Cosa togliere dal contesto all’avvio delle run del progetto: meno strumenti, server MCP, plugin e skill vuol dire meno token a ogni turno.',
  'context.read': 'Leggi da claude',
  'context.reading': 'Lettura…',
  'context.read.hint':
    'Avvia claude un attimo nella cartella del progetto per vedere cosa carica (costo trascurabile)',
  'context.error': 'Lettura non riuscita: {message}',
  'context.empty': 'Leggi da claude per vedere cosa carica nella cartella del progetto.',
  'context.mcp': 'Server MCP',
  'context.plugins': 'Plugin',
  'context.tools': 'Strumenti',
  'context.skills': 'Skill e comandi',
  'context.skills.off': 'Disattiva tutte le skill e i comandi ({n})',
  'context.skills.note':
    'Le skill di un plugin escluso spariscono con lui; una per una non si possono togliere.',
  'context.none': 'Nessuno',
  'context.excluded': 'Escluso: clic per includerlo',
  'context.included': 'Incluso: clic per escluderlo',
  'context.essential': 'Serve ai workflow: non si esclude',
  'context.count': '{n} esclusi',
  'context.open': 'Vale dal prossimo task: quelli già partiti continuano come sono.',
  'project.save.error': 'Salvataggio non riuscito.',
  'tasks.workflow.default': 'Predefinito ({name})',
  'tasks.workflow.missing': '{name} (non trovato)',

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
  'composer.placeholder': 'Cosa facciamo su {name}?',
  'composer.enqueue': 'Metti in coda',
  'composer.busy': 'C’è già un task attivo: questo partirà dopo.',
  'composer.continue': 'Invia',
  'composer.continue.placeholder': 'Continua il task su {name}…',
  'composer.fromTask': 'Valgono quelli scelti all’avvio del task',
  'composer.fork.placeholder':
    'Questo task è chiuso: scrivi qui per avviarne uno nuovo su {name} che riparte da questa conversazione.',
  'composer.closed.placeholder':
    'Questo task è chiuso: scrivi qui per avviarne uno nuovo su {name}.',
  'composer.switch': 'Con o senza workflow',
  'composer.plan': 'Segui workflow',
  'composer.plan.hint':
    'Task con workflow: claude prepara un piano e lo esegue con gate e controlli',
  'composer.direct': 'Richiesta libera',
  'composer.direct.hint':
    'Task diretto: claude esegue la richiesta così com’è, senza piano, gate né controlli',

  'thread.notFound': 'Richiesta non trovata.',
  'thread.cancel': 'Annulla',
  'thread.processes': 'Chiudi processi ({n})',
  'thread.processes.title':
    'Processi lasciati attivi dal task (server di sviluppo e simili): chiudili tutti',
  'thread.processes.confirm': 'Chiudere i processi ancora attivi di questo task?\n\n{list}',
  'thread.processes.none': 'Nessun processo di questo task è ancora attivo.',
  'thread.processes.failed': 'Operazione non riuscita: {error}',
  'thread.you': 'Tu',
  'thread.step.running': 'In corso',
  'thread.step.skipped': 'saltato',
  'thread.output': 'Uscita',
  'thread.followUp': 'Scrivi sotto per continuare il task',
  'thread.from': 'Continua da:',
  'thread.followUp.close': 'Chiudi il task',
  'thread.activity': 'Attività',
  'thread.policy': 'Azione sensibile',
  'thread.policy.approved': 'consentita',
  'thread.policy.denied': 'bloccata',
  'usage.tokens': '{n} token',
  'breakdown.title': 'Dove va il costo',
  'breakdown.tokens': 'Dove vanno i token',
  'usage.detail':
    'Lavoro di claude: {time} · turni {turns}\nInput {input} · Output {output}\nCache letta {cacheRead} · Cache scritta {cacheWrite}',
  'usage.cost': 'Costo stimato: {cost}',
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

  'wf.title': 'Workflow',
  'wf.new': 'Nuovo workflow',
  'wf.inputs': 'Input',
  'wf.when': 'se',
  'wf.policies': 'Policy',
  'wf.steps': 'Passi',
  'wf.gate.always': 'sempre',
  'wf.gate.interactive': 'in interattivo',
  'wf.onFail': 'se fallisce, torna a «{step}» (max {n} volte)',
  'wf.onFail.stop': 'se fallisce, si ferma',
  'wf.proposal': 'Proposta dell’AI',
  'wf.proposal.discard': 'Scarta',
  'wf.proposal.accept': 'Usa questa versione',
  'wf.proposal.issues':
    'La proposta ha ancora {n} errori: correggili nell’editor prima di salvare.',
  'wf.version': 'Versione',
  'wf.dirty': 'Modifiche non salvate',
  'wf.discard': 'Annulla modifiche',
  'wf.save': 'Salva nuova versione',
  'wf.delete': 'Elimina il workflow',
  'wf.delete.confirm':
    'Eliminare «{name}» con tutte le sue versioni? I task già partiti finiscono comunque.',
  'wf.delete.confirmUsed':
    'Eliminare «{name}» con tutte le sue versioni? I {n} progetti che lo seguono useranno il predefinito; i task già partiti finiscono comunque.',
  'wf.delete.error': 'Eliminazione non riuscita.',
  'wf.saveError': 'Non è stato possibile salvare il workflow.',
  'wf.yaml': 'YAML del workflow',
  'wf.line': 'riga {n}',
  'wf.previewStale': 'Anteprima dell’ultima versione valida: ci sono errori nello YAML.',
  'wf.ask': 'Modifica con l’AI',
  'wf.ask.placeholder': 'Cosa vuoi cambiare? Es. aggiungi un gate prima del push…',
  'wf.ask.send': 'Chiedi',
  'wf.ask.working': 'claude sta preparando la proposta…',
  'wf.ask.offline': 'Serve il runner collegato per chiedere all’AI.',
  'wf.ask.hint': 'La proposta non si salva da sola: la rivedi prima. Ctrl+Invio per chiedere.',
  'wf.ask.error': 'Non è stato possibile avere una proposta, riprova.',

  'new.title': 'Nuovo progetto',
  'new.existing': 'Aggiungi una cartella esistente',
  'new.existing.hint': 'Un progetto che hai già sul PC: Jeko lavorerà lì.',
  'new.name': 'Nome',
  'new.path': 'Cartella',
  'new.add': 'Aggiungi',
  'new.duplicate': 'Questa cartella è già un progetto.',
  'new.error': 'Non è stato possibile aggiungere il progetto.',
  'new.pick': 'Scegli la cartella',
  'new.pick.offline': 'Serve il runner collegato per aprire il dialogo',
  'new.pick.title': 'Scegli la cartella del progetto',
  'new.pick.error': 'Non è stato possibile aprire il dialogo della cartella.',
  'tpl.template': 'Template',
  'tpl.none': 'Nessuno: solo la richiesta',
  'tpl.manage': 'Template dei progetti',
  'tpl.manage.hint': 'Prompt già pronti, con un nome, da usare quando Jeko crea un progetto.',
  'tpl.edit': 'Template',
  'tpl.new': 'Nuovo template…',
  'tpl.name': 'Nome',
  'tpl.prompt': 'Prompt',
  'tpl.prompt.placeholder':
    'Es. Progetto Angular con standalone components e Tailwind; backend Node + Fastify in packages/server…',
  'tpl.prompt.hint':
    'Si aggiunge alla richiesta. Segnaposto: {{ name }}, {{ dir }}, {{ request }}.',
  'tpl.saveNew': 'Salva come nuovo',
  'tpl.delete': 'Elimina',
  'tpl.delete.confirm': 'Eliminare il template «{name}»?',
  'tpl.error': 'Operazione non riuscita.',
  'new.create': 'Crea con Jeko',
  'new.create.hint':
    'Jeko crea la cartella e prepara il progetto; a fine lavoro compare nell’elenco.',

  'splash.loading': 'Avvio in corso…',
  'splash.offline': 'Server non raggiungibile, riprovo…',
  'splash.offline.hint': 'Avvialo con npm run dev:server',

  'settings.title': 'Opzioni',
  'settings.body': 'Valgono per tutte le richieste: il runner le riceve a ogni avvio.',
  'settings.projectsDir': 'Cartella dei progetti',
  'settings.projectsDir.placeholder': 'es. C:\\progetti',
  'settings.projectsDir.hint': 'Sul PC del runner: lì nascono i progetti nuovi.',
  'settings.save': 'Salva',
  'settings.saved': 'Salvato',
  'settings.error': 'Non è stato possibile leggere o salvare le opzioni.',

  'path.steps': 'Passi: {n} di {total}',
  'path.turns': 'Turni: {n}',
  'path.failed': 'falliti: {n}',
  'formats.title': 'Formati',
  'formats.hint': 'Come mostrare date, ore e costi, in tutte le finestre.',
  'formats.date': 'Data',
  'formats.time': 'Ora',
  'formats.auto': 'Lingua',
  'formats.h24': '24 ore',
  'formats.h12': '12 ore',
  'formats.currency': 'Valuta',
  'formats.rate': '1 USD =',
  'formats.rate.fetch': 'Aggiorna dalla BCE',
  'formats.rate.error': 'Cambio non disponibile: inseriscilo a mano.',
  'formats.rate.missing': 'Senza cambio i costi restano in USD.',
  'formats.example': 'Esempio: {date} {time} · {cost}',
  'update.title': 'Versione e aggiornamenti',
  'update.current': 'Jeko {v}',
  'update.available': 'disponibile la {v}',
  'update.none': 'è l’ultima versione',
  'update.error': 'controllo non riuscito: {e}',
  'update.check': 'Verifica ora',
  'update.install': 'Installa la {v}',
  'update.installing': 'Installazione…',
  'update.confirm':
    'Installare la versione {v}? Jeko si chiude e si riapre da solo; i task fermi a una domanda riprendono.',
  'update.hint': 'Jeko si chiuderà e si riaprirà da solo.',
  'update.busy':
    'Task aperti: {n}. Per aggiornare aspetta che finiscano o chiudili (i task diretti restano aperti finché non li chiudi).',
  'update.blocked.source': 'Jeko gira dai sorgenti: aggiorna con git.',
  'update.blocked.readonly': 'La cartella di Jeko non è scrivibile.',
  'update.desktopOnly': 'Gli aggiornamenti automatici ci sono solo nell’app desktop.',
  'update.prompt.title': 'Nuova versione disponibile',
  'update.prompt.body': 'È disponibile Jeko {v} (in uso la {current}).',
  'update.skip': 'Salta questa versione',
  'update.later': 'Più tardi',
  'setup.title': 'Configurazione iniziale',
  'setup.step.welcome': 'Benvenuto',
  'setup.step.server': 'Servizio',
  'setup.step.env': 'Ambiente',
  'setup.step.options': 'Opzioni',
  'setup.step.done': 'Fine',
  'setup.reopen': 'Rifai il primo avvio',
  'setup.reopen.hint':
    'Riapre il wizard iniziale per ricontrollare ambiente e opzioni. Progetti, task, workflow e opzioni restano.',
  'setup.reopen.confirm': 'Rifare il primo avvio? Si torna al wizard; i dati restano.',
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
    'In pochi passi verifichiamo che Jeko, git e claude siano pronti. Intanto scegli lingua e tema.',
  'setup.server.title': 'Servizio e dati',
  'setup.server.body':
    'Il servizio di Jeko gira sul tuo PC: conserva workflow, richieste e cronologia in file, nella cartella dei dati.',
  'setup.env.title': 'Ambiente',
  'setup.env.body': 'Strumenti e permessi che servono a claude per lavorare in sicurezza.',
  'setup.env.waiting': 'Verifica in corso…',
  'setup.options.title': 'Le tue opzioni',
  'setup.options.body': 'Dove creare i progetti nuovi. Potrai cambiarla quando vuoi da Opzioni.',
  'setup.options.blocked': 'Salva la cartella dei progetti per continuare.',
  'setup.done.title': 'Tutto pronto',
  'setup.done.body':
    'Puoi iniziare con una nuova richiesta: un progetto da creare o uno sviluppo su un progetto esistente.',

  'check.server.api.title': 'Servizio di Jeko',
  'check.server.api.fix': 'Riapri Jeko (in sviluppo: npm run dev:server).',
  'check.server.workflows.title': 'Workflow disponibili',
  'check.server.workflows.fix': 'Nessun workflow: creane uno nella pagina Workflow.',
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
  'check.permissions.endpoint.fix': 'Riapri Jeko: la named pipe dei permessi non è attiva.',
  'check.permissions.scripts.title': 'Server MCP e hook dei permessi',
  'check.permissions.scripts.fix':
    'Reinstalla Jeko (in sviluppo: npm run build -w @jeko/server o npm run dev:server).',
};

export type I18nKey = keyof typeof it;

const en: Record<I18nKey, string> = {
  'app.tagline': 'local SDLC',
  'nav.projects': 'Projects',
  'nav.workflows': 'Workflows',
  'nav.stats': 'Statistics',
  'stats.title': 'Statistics',
  'stats.hint': 'On the runs still present: deleted ones do not count.',
  'stats.project': 'Project',
  'stats.allProjects': 'All projects',
  'stats.period': 'Period',
  'stats.days': '{n} days',
  'stats.all': 'All',
  'stats.tasks': 'Tasks',
  'stats.tasks.detail': '{done} done · {failed} failed · {other} other',
  'stats.cost': 'Estimated cost',
  'stats.tokens': 'Tokens',
  'stats.time': 'Claude work',
  'stats.split': '{plan} follow workflow · {direct} free request',
  'stats.trend': 'Trend',
  'stats.metric': 'Measure',
  'stats.metric.cost': 'Cost',
  'stats.metric.tokens': 'Tokens',
  'stats.metric.runs': 'Tasks',
  'stats.byProject': 'By project',
  'stats.col.project': 'Project',
  'stats.col.tasks': 'Tasks',
  'stats.col.done': 'Done',
  'stats.col.failed': 'Failed',
  'stats.noProject': 'Outside a project',
  'stats.steps': 'Where the cost goes: steps',
  'stats.steps.hint': 'Agent steps summed over all runs in the period, most expensive first.',
  'stats.steps.runs': '{n} runs',
  'stats.empty': 'No tasks in the period.',
  'stats.error': 'Statistics unavailable.',
  'runner.on': 'Runner connected',
  'runner.off': 'Runner not connected',
  'server.off': 'Server unreachable',
  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.system': 'System theme',
  'theme.label': 'Theme',
  'lang.label': 'Language',

  'ws.add': 'New project',
  'ws.search': 'Search projects…',
  'ws.sort': 'Sort',
  'ws.sort.activity': 'Activity',
  'ws.sort.waiting': 'Waiting for you',
  'ws.sort.name': 'Name',
  'ws.noMatch': 'No matching projects.',
  'ws.empty': 'No projects yet: add one.',
  'ws.creating': 'Being created',
  'ws.draft': 'Unsent text',
  'ws.waiting': 'Waiting for you',
  'ws.inProgress': 'Open',

  'tasks.empty': 'No open tasks.',
  'tasks.showClosed': 'Show closed ({n})',
  'tasks.hideClosed': 'Hide closed',
  'tasks.remove': 'Remove from list',
  'tasks.terminal': 'Open a terminal in the project folder',
  'tasks.terminal.error': 'Terminal not opened: is the runner connected?',
  'tasks.remove.confirm': 'Remove “{name}” from the list? The folder and its tasks stay.',
  'tasks.delete': 'Delete the task',
  'tasks.delete.confirm': 'Delete the task “{request}” with all its history?',
  'tasks.deleteClosed': 'Delete the {n} finished tasks',
  'tasks.deleteClosed.confirm': 'Delete the {n} finished tasks with all their history?',
  'tasks.delete.error': 'Could not delete.',
  'tasks.back': 'Project tasks',
  'tasks.none': 'Pick or add a project on the left.',
  'tasks.noPath': 'This project has no folder: add it again.',
  'tasks.workflow.hint': 'Workflow that drives the project tasks',
  'project.settings': 'Project options',
  'project.settings.title': '{name} options',
  'project.workflow': 'Development workflow',
  'project.workflow.hint':
    'The path the project follows for every fix or feature. The latest version of the chosen workflow always applies.',
  'project.workflow.open':
    'Applies from the next tasks: the {n} already open keep the workflow they started with.',
  'agent.title': 'Model and effort',
  'agent.hint':
    'Defaults for the project tasks; they can also be changed per task. Workflow steps that set them keep their own.',
  'agent.default': 'Default',
  'agent.model.default': 'Default model',
  'agent.inherit': 'project: {v}',
  'agent.effort': 'Effort',
  'agent.effort.hint': 'More effort means more thorough answers, but more time and more usage.',
  'agent.effort.low': 'Low',
  'agent.effort.medium': 'Medium',
  'agent.effort.high': 'High',
  'agent.effort.xhigh': 'Extra high',
  'agent.effort.max': 'Max',
  'prompts.title': 'Project prompts',
  'prompts.hint':
    'In .jeko/prompts/: the workflow «prompt» steps run them; if a prompt is missing, the step is skipped.',
  'prompts.add': 'New prompt',
  'prompts.empty': 'No prompts.',
  'prompts.missing': 'missing',
  'prompts.used': 'in the workflow',
  'prompts.used.hint': 'The project workflow has a step that runs it',
  'prompts.create': 'Create',
  'prompts.edit': 'Edit',
  'prompts.delete': 'Delete the prompt',
  'prompts.delete.confirm': 'Delete the prompt «{name}» from the project?',
  'prompts.name': 'Name (lowercase, digits and dashes)',
  'prompts.text': 'Prompt',
  'prompts.text.placeholder':
    'E.g. bump the version (patch for a fix, minor for a feature), commit and push, then npm run release.',
  'prompts.cancel': 'Cancel',
  'prompts.offline': 'Prompts unavailable: is the runner connected?',
  'project.save': 'Save',
  'project.saved': 'Saved.',
  'context.title': 'Claude context',
  'context.hint':
    'What to remove from the context when the project’s runs start: fewer tools, MCP servers, plugins and skills mean fewer tokens on every turn.',
  'context.read': 'Read from claude',
  'context.reading': 'Reading…',
  'context.read.hint':
    'Starts claude briefly in the project folder to see what it loads (negligible cost)',
  'context.error': 'Read failed: {message}',
  'context.empty': 'Read from claude to see what it loads in the project folder.',
  'context.mcp': 'MCP servers',
  'context.plugins': 'Plugins',
  'context.tools': 'Tools',
  'context.skills': 'Skills and commands',
  'context.skills.off': 'Disable all skills and commands ({n})',
  'context.skills.note': 'A plugin’s skills go away with it; they cannot be removed one by one.',
  'context.none': 'None',
  'context.excluded': 'Excluded: click to include it',
  'context.included': 'Included: click to exclude it',
  'context.essential': 'Needed by workflows: cannot be excluded',
  'context.count': '{n} excluded',
  'context.open': 'Applies from the next task: those already started carry on as they are.',
  'project.save.error': 'Could not save.',
  'tasks.workflow.default': 'Default ({name})',
  'tasks.workflow.missing': '{name} (not found)',

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
  'composer.placeholder': 'What are we doing on {name}?',
  'composer.enqueue': 'Queue',
  'composer.busy': 'A task is already active: this one will start after it.',
  'composer.continue': 'Send',
  'composer.continue.placeholder': 'Continue the task on {name}…',
  'composer.fromTask': 'Set when the task started',
  'composer.fork.placeholder':
    'This task is closed: write here to start a new one on {name} that picks up this conversation.',
  'composer.closed.placeholder': 'This task is closed: write here to start a new one on {name}.',
  'composer.switch': 'With or without workflow',
  'composer.plan': 'Follow workflow',
  'composer.plan.hint': 'Workflow task: claude prepares a plan and runs it with gates and checks',
  'composer.direct': 'Free request',
  'composer.direct.hint':
    'Direct task: claude runs the request as is, with no plan, gates or checks',

  'thread.notFound': 'Request not found.',
  'thread.cancel': 'Cancel',
  'thread.processes': 'Stop processes ({n})',
  'thread.processes.title':
    'Processes the task left running (dev servers and the like): stop them all',
  'thread.processes.confirm': 'Stop the processes this task still has running?\n\n{list}',
  'thread.processes.none': 'No process of this task is still running.',
  'thread.processes.failed': 'Operation failed: {error}',
  'thread.you': 'You',
  'thread.step.running': 'Running',
  'thread.step.skipped': 'skipped',
  'thread.output': 'Output',
  'thread.followUp': 'Write below to continue the task',
  'thread.from': 'Continues from:',
  'thread.followUp.close': 'Close the task',
  'thread.activity': 'Activity',
  'thread.policy': 'Sensitive action',
  'thread.policy.approved': 'allowed',
  'thread.policy.denied': 'blocked',
  'usage.tokens': '{n} tokens',
  'breakdown.title': 'Where the cost goes',
  'breakdown.tokens': 'Where the tokens go',
  'usage.detail':
    'Claude work: {time} · turns {turns}\nInput {input} · Output {output}\nCache read {cacheRead} · Cache write {cacheWrite}',
  'usage.cost': 'Estimated cost: {cost}',
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

  'wf.title': 'Workflows',
  'wf.new': 'New workflow',
  'wf.inputs': 'Inputs',
  'wf.when': 'if',
  'wf.policies': 'Policies',
  'wf.steps': 'Steps',
  'wf.gate.always': 'always',
  'wf.gate.interactive': 'in interactive',
  'wf.onFail': 'on failure, back to “{step}” (max {n} times)',
  'wf.onFail.stop': 'on failure, it stops',
  'wf.proposal': 'AI proposal',
  'wf.proposal.discard': 'Discard',
  'wf.proposal.accept': 'Use this version',
  'wf.proposal.issues': 'The proposal still has {n} errors: fix them in the editor before saving.',
  'wf.version': 'Version',
  'wf.dirty': 'Unsaved changes',
  'wf.discard': 'Discard changes',
  'wf.save': 'Save new version',
  'wf.delete': 'Delete the workflow',
  'wf.delete.confirm': 'Delete “{name}” and all its versions? Tasks already started still finish.',
  'wf.delete.confirmUsed':
    'Delete “{name}” and all its versions? The {n} projects that follow it will use the default; tasks already started still finish.',
  'wf.delete.error': 'Could not delete.',
  'wf.saveError': 'Could not save the workflow.',
  'wf.yaml': 'Workflow YAML',
  'wf.line': 'line {n}',
  'wf.previewStale': 'Preview of the last valid version: the YAML has errors.',
  'wf.ask': 'Edit with AI',
  'wf.ask.placeholder': 'What do you want to change? E.g. add a gate before push…',
  'wf.ask.send': 'Ask',
  'wf.ask.working': 'claude is preparing the proposal…',
  'wf.ask.offline': 'The runner must be connected to ask the AI.',
  'wf.ask.hint': 'The proposal is not saved on its own: you review it first. Ctrl+Enter to ask.',
  'wf.ask.error': 'Could not get a proposal, try again.',

  'new.title': 'New project',
  'new.existing': 'Add an existing folder',
  'new.existing.hint': 'A project already on your PC: Jeko will work there.',
  'new.name': 'Name',
  'new.path': 'Folder',
  'new.add': 'Add',
  'new.duplicate': 'This folder is already a project.',
  'new.error': 'Could not add the project.',
  'new.pick': 'Choose the folder',
  'new.pick.offline': 'The runner must be connected to open the dialog',
  'new.pick.title': 'Choose the project folder',
  'new.pick.error': 'Could not open the folder dialog.',
  'tpl.template': 'Template',
  'tpl.none': 'None: just the request',
  'tpl.manage': 'Project templates',
  'tpl.manage.hint': 'Ready-made prompts, with a name, used when Jeko creates a project.',
  'tpl.edit': 'Template',
  'tpl.new': 'New template…',
  'tpl.name': 'Name',
  'tpl.prompt': 'Prompt',
  'tpl.prompt.placeholder':
    'E.g. Angular project with standalone components and Tailwind; Node + Fastify backend in packages/server…',
  'tpl.prompt.hint': 'Added to the request. Placeholders: {{ name }}, {{ dir }}, {{ request }}.',
  'tpl.saveNew': 'Save as new',
  'tpl.delete': 'Delete',
  'tpl.delete.confirm': 'Delete the template “{name}”?',
  'tpl.error': 'The operation failed.',
  'new.create': 'Create with Jeko',
  'new.create.hint':
    'Jeko creates the folder and sets up the project; it shows up in the list when done.',

  'splash.loading': 'Starting…',
  'splash.offline': 'Server unreachable, retrying…',
  'splash.offline.hint': 'Start it with npm run dev:server',

  'settings.title': 'Options',
  'settings.body': 'They apply to every request: the runner receives them on each start.',
  'settings.projectsDir': 'Projects folder',
  'settings.projectsDir.placeholder': 'e.g. C:\\projects',
  'settings.projectsDir.hint': 'On the runner PC: new projects are created there.',
  'settings.save': 'Save',
  'settings.saved': 'Saved',
  'settings.error': 'Could not read or save the options.',

  'path.steps': 'Steps: {n} of {total}',
  'path.turns': 'Turns: {n}',
  'path.failed': 'failed: {n}',
  'formats.title': 'Formats',
  'formats.hint': 'How dates, times and costs are shown, in every window.',
  'formats.date': 'Date',
  'formats.time': 'Time',
  'formats.auto': 'Language',
  'formats.h24': '24-hour',
  'formats.h12': '12-hour',
  'formats.currency': 'Currency',
  'formats.rate': '1 USD =',
  'formats.rate.fetch': 'Update from ECB',
  'formats.rate.error': 'Rate unavailable: enter it by hand.',
  'formats.rate.missing': 'Without a rate costs stay in USD.',
  'formats.example': 'Example: {date} {time} · {cost}',
  'update.title': 'Version and updates',
  'update.current': 'Jeko {v}',
  'update.available': '{v} is available',
  'update.none': 'up to date',
  'update.error': 'check failed: {e}',
  'update.check': 'Check now',
  'update.install': 'Install {v}',
  'update.installing': 'Installing…',
  'update.confirm':
    'Install version {v}? Jeko closes and reopens by itself; tasks waiting for an answer resume.',
  'update.hint': 'Jeko will close and reopen by itself.',
  'update.busy':
    'Open tasks: {n}. To update, wait for them to finish or close them (direct tasks stay open until you close them).',
  'update.blocked.source': 'Jeko runs from source: update with git.',
  'update.blocked.readonly': 'The Jeko folder is not writable.',
  'update.desktopOnly': 'Automatic updates are only available in the desktop app.',
  'update.prompt.title': 'New version available',
  'update.prompt.body': 'Jeko {v} is available (you are using {current}).',
  'update.skip': 'Skip this version',
  'update.later': 'Later',
  'setup.title': 'Initial setup',
  'setup.step.welcome': 'Welcome',
  'setup.step.server': 'Service',
  'setup.step.env': 'Environment',
  'setup.step.options': 'Options',
  'setup.step.done': 'Done',
  'setup.reopen': 'Run first-time setup again',
  'setup.reopen.hint':
    'Reopens the initial wizard to check the environment and options again. Projects, tasks, workflows and options stay.',
  'setup.reopen.confirm': 'Run first-time setup again? You go back to the wizard; your data stays.',
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
    'In a few steps we check that Jeko, git and claude are ready. Meanwhile, pick language and theme.',
  'setup.server.title': 'Service and data',
  'setup.server.body':
    'The Jeko service runs on your PC: it keeps workflows, requests and history as files in the data folder.',
  'setup.env.title': 'Environment',
  'setup.env.body': 'Tools and permissions claude needs to work safely.',
  'setup.env.waiting': 'Checking…',
  'setup.options.title': 'Your options',
  'setup.options.body': 'Where to create new projects. You can change it anytime from Options.',
  'setup.options.blocked': 'Save the projects folder to continue.',
  'setup.done.title': 'All set',
  'setup.done.body':
    'You can start with a new request: a project to create or work on an existing one.',

  'check.server.api.title': 'Jeko service',
  'check.server.api.fix': 'Reopen Jeko (during development: npm run dev:server).',
  'check.server.workflows.title': 'Available workflows',
  'check.server.workflows.fix': 'No workflows: create one in the Workflows page.',
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
  'check.permissions.endpoint.fix': 'Reopen Jeko: the permission named pipe is not active.',
  'check.permissions.scripts.title': 'Permission MCP server and hook',
  'check.permissions.scripts.fix':
    'Reinstall Jeko (during development: npm run build -w @jeko/server or npm run dev:server).',
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
  readonly formats = inject(Formats);

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

  /** "45s", "3m 20s", "1h 05m". */
  duration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  /** Numero compatto: "950", "12,3k", "1,2M". */
  compact(n: number): string {
    return new Intl.NumberFormat(this.lang(), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  }

  number(n: number): string {
    return new Intl.NumberFormat(this.lang()).format(n);
  }

  /** Riga breve del consumo di claude ("3m 20s · 12,3k token") e il dettaglio per il tooltip. */
  usage(u: AgentUsage): { short: string; detail: string } {
    const total = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
    const time = this.duration(u.durationMs);
    let detail = this.t('usage.detail', {
      time,
      turns: u.turns,
      input: this.number(u.inputTokens),
      output: this.number(u.outputTokens),
      cacheRead: this.number(u.cacheReadTokens),
      cacheWrite: this.number(u.cacheWriteTokens),
    });
    if (u.costUsd !== undefined) {
      detail += `\n${this.t('usage.cost', { cost: this.money(u.costUsd) })}`;
    }
    return { short: `${time} · ${this.t('usage.tokens', { n: this.compact(total) })}`, detail };
  }

  /** Costo da USD nella valuta scelta; le cifre piccole con tre decimali. */
  money(usd: number): string {
    const { currency, rate } = this.formats.money();
    const n = usd * rate;
    return new Intl.NumberFormat(this.lang(), {
      style: 'currency',
      currency,
      maximumFractionDigits: n > 0 && n < 1 ? 3 : 2,
    }).format(n);
  }

  /** Fattore da USD alla valuta usata da `money()`. */
  rate(): number {
    return this.formats.money().rate;
  }

  time(iso: string | Date): string {
    return formatTime(new Date(iso), this.formats.time(), this.lang());
  }

  date(iso: string | Date): string {
    return formatDate(new Date(iso), this.formats.date(), this.lang());
  }

  dayMonth(iso: string | Date): string {
    return formatDayMonth(new Date(iso), this.formats.date(), this.lang());
  }

  /** Data e ora, per i tooltip. */
  dateTime(iso: string | Date): string {
    return `${this.date(iso)} ${this.time(iso)}`;
  }
}
