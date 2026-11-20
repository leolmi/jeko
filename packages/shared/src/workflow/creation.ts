import type { Workflow } from './schema.js';
import { validateWorkflow, type Issue } from './validate.js';

/** Nome delle run di creazione: non è un workflow salvato, si costruisce dal template. */
export const CREATION_WORKFLOW = 'nuovo-progetto';

/**
 * Workflow con cui Jeko crea un progetto: claude lavora nella cartella dei progetti seguendo
 * il prompt del template (o solo la richiesta), poi git, `.gitignore` e la conoscenza `.jeko/`.
 * Nel prompt valgono i segnaposto dei workflow: `{{ name }}`, `{{ dir }}`, `{{ request }}`…
 * A fine run il server registra il progetto dall'input `name` e dalla variabile `dir`.
 */
export function creationWorkflow(prompt?: string): Workflow {
  const guide = prompt?.trim();
  return {
    name: CREATION_WORKFLOW,
    kind: 'create',
    version: 1,
    description: 'Crea un nuovo progetto nella cartella dei progetti',
    inputs: { name: { prompt: 'Nome del progetto', required: true } },
    vars: { slug: '{{ kebab(name) }}', dir: '{{ jeko.projectsDir }}/{{ slug }}' },
    policies: [
      { match: 'install', gate: 'always' },
      { match: ['git.commit', 'git.push'], gate: 'always' },
    ],
    steps: [
      {
        id: 'projects-dir',
        type: 'check',
        title: 'Cartella dei progetti impostata nelle opzioni',
        expect: 'jeko.projectsDir',
        onFail: 'stop',
      },
      {
        id: 'check-dir',
        type: 'check',
        title: 'La cartella non deve esistere',
        expect: '!exists(dir)',
        onFail: 'stop',
      },
      {
        id: 'crea',
        type: 'agent',
        title: 'Crea il progetto',
        instructions: [
          'Crea il progetto {{ name }} nella cartella {{ dir }} (non esiste ancora: creala).',
          'Richiesta: {{ request }}',
          ...(guide ? ['', guide] : []),
          '',
          'Non inizializzare git e non fare commit.',
        ].join('\n'),
      },
      {
        id: 'git',
        type: 'check',
        title: 'Inizializza git',
        exec: [['git', 'init', '-b', 'main']],
        cwd: '{{ dir }}',
      },
      {
        id: 'gitignore',
        type: 'agent',
        title: '.gitignore',
        instructions: 'Assicurati che {{ dir }}/.gitignore contenga la riga `.idea/`.',
      },
      {
        id: 'gitignore-ok',
        type: 'check',
        title: 'Verifica .gitignore',
        expect: "fileContains(dir + '/.gitignore', '.idea/')",
        onFail: { goto: 'gitignore', retries: 2 },
      },
      {
        id: 'conoscenza',
        type: 'agent',
        title: 'Conoscenza del progetto (.jeko/)',
        cwd: '{{ dir }}',
        instructions: [
          'Crea in {{ dir }}/.jeko/ la conoscenza del progetto {{ name }}:',
          "- project.md: cos'è (richiesta: {{ request }}), stack, struttura delle cartelle, convenzioni;",
          '- commands.yaml: i comandi del progetto, uno per riga come `nome: comando` senza shell',
          '  (es. `test: npm test`), solo quelli che esistono davvero tra build, test, lint e typecheck.',
          'Sii breve. Non fare commit.',
        ].join('\n'),
      },
      {
        id: 'conoscenza-ok',
        type: 'check',
        title: 'Verifica .jeko/',
        expect: "exists(dir + '/.jeko/project.md')",
        onFail: { goto: 'conoscenza', retries: 2 },
      },
    ],
  };
}

/** Errori del prompt di un template (segnaposto o funzioni sconosciute); vuoto se va bene. */
export function templateIssues(prompt: string): Issue[] {
  const res = validateWorkflow(creationWorkflow(prompt));
  return res.ok ? [] : res.issues;
}
