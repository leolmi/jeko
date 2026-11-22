import { describe, expect, it } from 'vitest';
import { gateModes, matrixPolicies, policyMatrix, setPolicies } from './policies.js';

describe('policy come matrice', () => {
  it('traduce i gate in modalità', () => {
    expect(gateModes('always')).toEqual(['headless', 'checkpoint', 'interactive']);
    expect(gateModes('interactive')).toEqual(['checkpoint', 'interactive']);
    expect(gateModes(['interactive', 'headless'])).toEqual(['headless', 'interactive']);
  });

  it('somma le policy sulla stessa azione', () => {
    const m = policyMatrix([
      { match: 'install', gate: ['interactive'] },
      { match: ['install', 'git.push'], gate: 'interactive' },
    ]);
    expect(m.install).toEqual(['checkpoint', 'interactive']);
    expect(m['git.push']).toEqual(['checkpoint', 'interactive']);
    expect(m.network).toEqual([]);
  });

  it('raggruppa le azioni con le stesse modalità', () => {
    expect(
      matrixPolicies({
        'git.commit': ['headless', 'checkpoint', 'interactive'],
        'git.push': ['headless', 'checkpoint', 'interactive'],
        install: ['checkpoint', 'interactive'],
        'fs.delete': ['interactive'],
        network: [],
      }),
    ).toEqual([
      { match: 'install', gate: 'interactive' },
      { match: ['git.commit', 'git.push'], gate: 'always' },
      { match: 'fs.delete', gate: ['interactive'] },
    ]);
  });
});

describe('setPolicies', () => {
  const yaml = `# workflow
name: x
kind: develop
version: 1
description: prova

policies:
  - match: install
    gate: always

steps:
  - id: a # commento
    type: agent
    instructions: |
      Richiesta: {{ request }}
`;

  it('sostituisce le policy e lascia il resto', () => {
    const out = setPolicies(yaml, [
      { match: ['git.commit', 'git.push'], gate: 'always' },
      { match: 'install', gate: ['interactive'] },
    ]);
    expect(out).toContain(
      'policies:\n  - match: [git.commit, git.push]\n    gate: always\n  - match: install\n    gate: [interactive]\n',
    );
    expect(out).toContain('# workflow');
    expect(out).toContain('- id: a # commento');
    expect(out).toContain('Richiesta: {{ request }}');
  });

  it('toglie la chiave senza policy', () => {
    expect(setPolicies(yaml, [])).not.toContain('policies');
  });

  it('la aggiunge dopo la descrizione', () => {
    const plain = yaml.replace('policies:\n  - match: install\n    gate: always\n\n', '');
    const out = setPolicies(plain, [{ match: 'network', gate: 'always' }]);
    expect(out.indexOf('policies:')).toBeGreaterThan(out.indexOf('description:'));
    expect(out.indexOf('policies:')).toBeLessThan(out.indexOf('steps:'));
  });
});
