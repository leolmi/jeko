import { describe, expect, it } from 'vitest';
import { assistPrompt, assistWorkflow, parseProposal } from './assist.js';

const VALID = `name: demo
kind: develop
version: 1
steps:
  - { id: lavoro, type: agent, instructions: 'Fai {{ request }}' }
`;
const INVALID = `name: demo
kind: develop
version: 1
steps:
  - { id: lavoro, type: agente, instructions: x }
`;
const reply = (yaml: string, summary = 'Fatto') => `SUMMARY: ${summary}\n\`\`\`yaml\n${yaml}\`\`\``;

describe('assistenza ai workflow', () => {
  it('legge riassunto e YAML dalla risposta', () => {
    expect(parseProposal(`Ecco.\n${reply(VALID, 'Aggiunto un passo')}\nCiao`)).toEqual({
      summary: 'Aggiunto un passo',
      yaml: VALID,
    });
    expect(parseProposal('niente yaml')).toBeNull();
  });

  it('il prompt contiene YAML, richiesta ed eventuali errori', () => {
    const p = assistPrompt(VALID, 'aggiungi i test', [
      { path: ['steps', 0, 'type'], message: 'tipo sconosciuto', line: 5 },
    ]);
    expect(p).toContain(VALID.trim());
    expect(p).toContain('aggiungi i test');
    expect(p).toContain('riga 5');
    expect(p).toContain('"steps"');
  });

  it('accetta subito una proposta valida', async () => {
    const prompts: string[] = [];
    const res = await assistWorkflow(
      async (p) => (prompts.push(p), reply(VALID)),
      VALID,
      'rinomina',
    );
    expect(res).toEqual({ yaml: VALID, summary: 'Fatto', issues: [] });
    expect(prompts).toHaveLength(1);
  });

  it('rimanda gli errori a claude finché la proposta non è valida', async () => {
    const answers = [reply(INVALID, 'Primo tentativo'), reply(VALID, '')];
    const prompts: string[] = [];
    const res = await assistWorkflow(
      async (p) => (prompts.push(p), answers.shift()!),
      VALID,
      'cambia',
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('non è valida');
    expect(res).toEqual({ yaml: VALID, summary: 'Primo tentativo', issues: [] });
  });

  it('dopo tre tentativi restituisce la proposta con gli errori', async () => {
    let calls = 0;
    const res = await assistWorkflow(async () => (calls++, reply(INVALID)), VALID, 'x');
    expect(calls).toBe(3);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.issues[0]?.line).toBe(5);
  });

  it('fallisce se claude non dà YAML', async () => {
    await expect(assistWorkflow(async () => 'boh', VALID, 'x')).rejects.toThrow('senza YAML');
  });
});
