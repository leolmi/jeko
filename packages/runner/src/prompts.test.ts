import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deletePrompt, listPrompts, readPrompt, savePrompt } from './prompts.js';

describe('prompt del progetto', () => {
  it('si salvano, si elencano e si eliminano in .jeko/prompts/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-prompts-'));
    expect(listPrompts(dir)).toEqual([]);
    expect(readPrompt(dir, 'end-develop')).toBeNull();

    savePrompt(dir, 'end-develop', 'Bump, commit e push');
    savePrompt(dir, 'altro', 'Altro\n');
    expect(existsSync(join(dir, '.jeko', 'prompts', 'end-develop.md'))).toBe(true);
    expect(readPrompt(dir, 'end-develop')).toBe('Bump, commit e push\n');
    expect(listPrompts(dir).map((p) => p.name)).toEqual(['altro', 'end-develop']);

    deletePrompt(dir, 'altro');
    expect(listPrompts(dir).map((p) => p.name)).toEqual(['end-develop']);
  });

  it('rifiuta i nomi che uscirebbero dalla cartella', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-prompts-'));
    expect(() => savePrompt(dir, '../fuori', 'x')).toThrow('Nome di prompt non valido');
    expect(() => readPrompt(dir, 'A B')).toThrow();
  });
});
