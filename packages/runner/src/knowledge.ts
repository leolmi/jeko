import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JEKO_DIR, parseCommands, type Knowledge } from '@jeko/shared';

const readIf = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);

/** Legge `.jeko/` dalla cartella del progetto; null se non c'è. */
export function loadKnowledge(projectDir: string): Knowledge | null {
  const dir = join(projectDir, JEKO_DIR);
  if (!existsSync(dir)) return null;
  const project = readIf(join(dir, 'project.md'));
  const commandsText = readIf(join(dir, 'commands.yaml'));
  const notesDir = join(dir, 'notes');
  const notes = existsSync(notesDir)
    ? readdirSync(notesDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((name) => ({ name, text: readFileSync(join(notesDir, name), 'utf8') }))
    : [];
  let commands: Record<string, string[]> = {};
  let commandsError: string | undefined;
  try {
    if (commandsText !== undefined) commands = parseCommands(commandsText);
  } catch (e) {
    commandsError = e instanceof Error ? e.message : String(e);
  }
  return {
    ...(project !== undefined && { project }),
    notes,
    commands,
    ...(commandsError !== undefined && { commandsError }),
  };
}
