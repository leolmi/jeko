import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeDriver } from './agents/claude/index.js';
import { createNodeHost } from './engine/node-host.js';
import { loadKnowledge } from './knowledge.js';

const fake = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'jeko-knowledge-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function project(files: Record<string, string>): string {
  const dir = tmp();
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, '.jeko', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

describe('.jeko/', () => {
  it('legge project.md, commands.yaml e le note in ordine', () => {
    const dir = project({
      'project.md': '# P',
      'commands.yaml': 'test: npm test',
      'notes/b.md': 'B',
      'notes/a.md': 'A',
      'notes/x.txt': 'ignorata',
    });
    expect(loadKnowledge(dir)).toEqual({
      project: '# P',
      commands: { test: ['npm', 'test'] },
      notes: [
        { name: 'a.md', text: 'A' },
        { name: 'b.md', text: 'B' },
      ],
    });
  });

  it('null senza .jeko/, errore leggibile con un commands.yaml rotto', () => {
    expect(loadKnowledge(tmp())).toBeNull();
    const k = loadKnowledge(project({ 'commands.yaml': 'test: [1]' }));
    expect(k?.commands).toEqual({});
    expect(k?.commandsError).toContain("comando non valido per 'test'");
  });

  it("l'host dà i comandi del progetto e segnala commands.yaml rotto", async () => {
    const host = (cwd: string) =>
      createNodeHost({
        cwd,
        turnsDir: tmp(),
        ask: async () => null,
        approve: async () => ({ approved: true }),
        review: async () => ({ ok: true }),
        emit: () => undefined,
      });
    const ok = project({ 'commands.yaml': 'lint: npm run lint' });
    expect(await host(ok).projectCommands?.()).toEqual({ lint: ['npm', 'run', 'lint'] });
    expect(await host(tmp()).projectCommands?.()).toEqual({});
    const bad = project({ 'commands.yaml': '- x' });
    await expect(host(bad).projectCommands?.()).rejects.toThrow('nome: comando');
  });

  it('claude riceve la conoscenza nel primo turno della run, non nei successivi', async () => {
    const dir = project({ 'project.md': 'Progetto di prova' });
    const host = createNodeHost({
      cwd: dir,
      turnsDir: tmp(),
      agent: claudeDriver([process.execPath, fake]),
      ask: async () => null,
      approve: async () => ({ approved: true }),
      review: async () => ({ ok: true }),
      emit: () => undefined,
    });
    const turn = (turnKey: string) =>
      host.agent({
        stepId: 's',
        instructions: 'Fai il lavoro',
        turnKey,
        gates: { policies: [], mode: 'headless' },
        authorize: async () => true,
      });
    const first = await turn('t1');
    expect(first.output).toContain('# Conoscenza del progetto (.jeko/)');
    expect(first.output).toContain('Progetto di prova');
    expect(first.output).toContain('Fai il lavoro');
    expect((await turn('t2')).output).toBe('eco: Fai il lavoro');
  });
});
