import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JEKO_DIR, PROMPT_NAME, PROMPTS_DIR, type ProjectPrompt } from '@jeko/shared';

/** Prompt del progetto: un file `.jeko/prompts/<nome>.md` per prompt. */
const dirOf = (projectDir: string) => join(projectDir, JEKO_DIR, PROMPTS_DIR);

function fileOf(projectDir: string, name: string): string {
  if (!PROMPT_NAME.test(name)) throw new Error(`Nome di prompt non valido '${name}'`);
  return join(dirOf(projectDir), `${name}.md`);
}

/** Testo del prompt; null se il progetto non lo definisce. */
export function readPrompt(projectDir: string, name: string): string | null {
  const file = fileOf(projectDir, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function listPrompts(projectDir: string): ProjectPrompt[] {
  const dir = dirOf(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && PROMPT_NAME.test(f.slice(0, -3)))
    .sort()
    .map((f) => ({ name: f.slice(0, -3), text: readFileSync(join(dir, f), 'utf8') }));
}

export function savePrompt(projectDir: string, name: string, text: string): void {
  if (!existsSync(projectDir)) throw new Error(`Cartella inesistente: ${projectDir}`);
  const file = fileOf(projectDir, name);
  mkdirSync(dirOf(projectDir), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

export function deletePrompt(projectDir: string, name: string): void {
  rmSync(fileOf(projectDir, name), { force: true });
}
