import { describe, expect, it } from 'vitest';
import { knowledgePrompt, parseCommands } from './knowledge.js';

describe('commands.yaml', () => {
  it('accetta stringhe e liste di argomenti', () => {
    expect(parseCommands('test: npm test\nlint: [npx, eslint, "src dir"]\n')).toEqual({
      test: ['npm', 'test'],
      lint: ['npx', 'eslint', 'src dir'],
    });
    expect(parseCommands('')).toEqual({});
  });

  it('rifiuta nomi e comandi non validi', () => {
    expect(() => parseCommands('- npm test')).toThrow('nome: comando');
    expect(() => parseCommands('Test: npm test')).toThrow("nome non valido 'Test'");
    expect(() => parseCommands('test: ""')).toThrow("comando non valido per 'test'");
    expect(() => parseCommands('test: [npm, 1]')).toThrow("comando non valido per 'test'");
  });
});

describe('contesto per claude', () => {
  it('mette insieme project.md, comandi e note', () => {
    const text = knowledgePrompt({
      project: '# Jeko\nMonorepo npm.',
      commands: { test: ['npm', 'test'] },
      notes: [{ name: 'windows.md', text: 'Niente shell.' }],
    });
    expect(text).toContain('## project.md\n\n# Jeko\nMonorepo npm.');
    expect(text).toContain('- test: `npm test`');
    expect(text).toContain('## notes/windows.md\n\nNiente shell.');
  });

  it('segnala un commands.yaml da correggere', () => {
    const text = knowledgePrompt({ notes: [], commands: {}, commandsError: 'rotto' });
    expect(text).toContain('Non valido, va corretto: rotto');
  });
});
