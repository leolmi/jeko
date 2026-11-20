import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatIssue, parseWorkflow, stringifyWorkflow, type WorkflowResult } from './validate.js';

const example = readFileSync(
  new URL('../../workflows/nuovo-progetto.yaml', import.meta.url),
  'utf8',
);

const messages = (r: WorkflowResult) => (r.ok ? [] : r.issues.map(formatIssue));

const base = `
name: prova
kind: develop
version: 1
steps:
`;

describe('workflow', () => {
  it("accetta l'esempio nuovo-progetto", () => {
    const r = parseWorkflow(example);
    expect(messages(r)).toEqual([]);
    expect(r.ok && r.workflow.steps.map((s) => s.id)).toEqual([
      'check-dir',
      'scaffold',
      'git',
      'gitignore',
      'gitignore-ok',
      'commit',
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

  it('un check vuole exec o expect', () => {
    const r = parseWorkflow(`${base}  - id: a\n    type: check\n`);
    expect(messages(r)).toEqual(["6:5 steps[0]: un check vuole 'exec' o 'expect'"]);
  });
});
