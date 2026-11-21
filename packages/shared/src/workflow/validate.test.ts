import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { creationWorkflow, templateIssues } from './creation.js';
import { directWorkflow } from './direct.js';
import {
  formatIssue,
  parseWorkflow,
  stringifyWorkflow,
  validateWorkflow,
  type WorkflowResult,
} from './validate.js';

const builtinDir = new URL('../../workflows/', import.meta.url);
const builtin = readdirSync(builtinDir).map((f) => readFileSync(new URL(f, builtinDir), 'utf8'));
const example = readFileSync(new URL('sviluppo.yaml', builtinDir), 'utf8');

const messages = (r: WorkflowResult) => (r.ok ? [] : r.issues.map(formatIssue));

const base = `
name: prova
kind: develop
version: 1
steps:
`;

describe('workflow', () => {
  it('accetta i workflow di serie', () => {
    for (const yaml of builtin) expect(messages(parseWorkflow(yaml))).toEqual([]);
  });

  it('i workflow scritti sono solo di sviluppo', () => {
    const r = parseWorkflow(example.replace('kind: develop', 'kind: create'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]).toMatchObject({ path: ['kind'], line: 2 });
  });

  it('un passo agent vuole istruzioni o un prompt del progetto, non entrambi', () => {
    const steps = (s: string) => messages(parseWorkflow(base + s));
    expect(steps('  - { id: a, type: agent, prompt: end-develop }\n')).toEqual([]);
    for (const bad of [
      '  - { id: a, type: agent }\n',
      '  - { id: a, type: agent, prompt: x, instructions: y }\n',
    ]) {
      const issues = steps(bad);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("un passo agent vuole 'instructions' o 'prompt'");
    }
  });

  it('il workflow diretto è valido', () => {
    expect(messages(validateWorkflow(directWorkflow()))).toEqual([]);
  });

  it('costruisce il workflow di creazione da un template', () => {
    expect(messages(validateWorkflow(creationWorkflow()))).toEqual([]);
    const wf = creationWorkflow('Usa {{ name }} in {{ dir }}');
    const crea = wf.steps.find((s) => s.id === 'crea');
    expect(crea?.type === 'agent' && crea.instructions).toContain('Usa {{ name }} in {{ dir }}');
    expect(templateIssues('Usa {{ name }}')).toEqual([]);
    expect(templateIssues('Usa {{ boh }}').map((i) => i.message)).toEqual([
      "variabile non definita 'boh'",
    ]);
  });

  it('va e torna da YAML senza perdite', () => {
    const r = parseWorkflow(example);
    if (!r.ok) throw new Error('atteso valido');
    const again = parseWorkflow(stringifyWorkflow(r.workflow));
    expect(again).toEqual(r);
  });

  it('segnala errori YAML con la riga', () => {
    const r = parseWorkflow('name: [aperta\n');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]?.line).toBeTypeOf('number');
  });

  it('segnala errori di schema sul passo giusto', () => {
    const r = parseWorkflow(`${base}  - id: a\n    type: gate\n    mesage: ciao\n`);
    expect(messages(r)).toEqual([
      "6:5 steps[0]: manca 'message'",
      "8:13 steps[0].mesage: proprietà non ammessa 'mesage'",
    ]);
  });

  it('segnala tipi di passo sconosciuti', () => {
    const r = parseWorkflow(`${base}  - id: a\n    type: magia\n`);
    expect(messages(r)[0]).toMatch(/steps\[0\]\.type: tipo di passo non valido/);
  });

  it('controlla variabili, funzioni e ordine', () => {
    const r = parseWorkflow(`${base}
  - id: uno
    type: gate
    message: '{{ risposta }}'
  - id: chiedi
    type: ask
    question: Come va?
    into: risposta
  - id: due
    type: check
    expect: magia(risposta)
`);
    expect(messages(r)).toEqual([
      "9:14 steps[0].message: variabile non definita 'risposta'",
      "16:13 steps[2].expect: funzione sconosciuta 'magia'",
    ]);
  });

  it('goto solo verso passi precedenti e id unici', () => {
    const r = parseWorkflow(`${base}
  - id: a
    type: check
    expect: 'true'
    onFail: { goto: b, retries: 1 }
  - id: a
    type: check
    exec: [[npm, test]]
`);
    expect(messages(r)).toEqual([
      "10:21 steps[0].onFail.goto: 'b' deve essere un passo precedente",
      "11:9 steps[1].id: id ripetuto 'a'",
    ]);
  });

  it('un check vuole exec, commands o expect', () => {
    const r = parseWorkflow(`${base}  - id: a\n    type: check\n`);
    expect(messages(r)).toEqual(["6:5 steps[0]: un check vuole 'exec', 'commands' o 'expect'"]);
    expect(parseWorkflow(`${base}  - id: a\n    type: check\n    commands: [test]\n`).ok).toBe(
      true,
    );
  });
});
