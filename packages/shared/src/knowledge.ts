import { parse } from 'yaml';

/**
 * Conoscenza del progetto, nella cartella `.jeko/` alla radice:
 * - `project.md`: cos'è il progetto, stack, convenzioni;
 * - `commands.yaml`: comandi di build, test, lint… (nome → comando);
 * - `notes/*.md`: cose imparate lavorando (decisioni, trappole).
 */
export const JEKO_DIR = '.jeko';

export interface Knowledge {
  project?: string;
  notes: { name: string; text: string }[];
  commands: Record<string, string[]>;
  /** commands.yaml c'è ma non si legge. */
  commandsError?: string;
}

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * `commands.yaml`: ogni chiave è un nome (test, lint…), il valore un comando senza shell,
 * come stringa ("npm run lint", divisa sugli spazi) o come lista di argomenti.
 */
export function parseCommands(text: string): Record<string, string[]> {
  const doc: unknown = parse(text);
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('commands.yaml: serve un elenco nome: comando');
  }
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(doc)) {
    if (!COMMAND_NAME.test(name)) throw new Error(`commands.yaml: nome non valido '${name}'`);
    const argv =
      typeof value === 'string'
        ? value.trim().split(/\s+/).filter(Boolean)
        : Array.isArray(value) && value.every((a) => typeof a === 'string')
          ? (value as string[])
          : null;
    if (!argv?.length) throw new Error(`commands.yaml: comando non valido per '${name}'`);
    out[name] = argv;
  }
  return out;
}

/** Contesto per claude, da mettere prima delle istruzioni del primo turno nel progetto. */
export function knowledgePrompt(k: Knowledge): string {
  const parts = [
    `# Conoscenza del progetto (${JEKO_DIR}/)`,
    `Il progetto tiene in ${JEKO_DIR}/ quello che serve sapere per lavorarci: project.md ` +
      '(cos’è, stack, convenzioni), commands.yaml (comandi di build, test, lint…) e notes/ ' +
      '(cose imparate). Tienine conto.',
  ];
  if (k.project?.trim()) parts.push(`## project.md\n\n${k.project.trim()}`);
  const commands = Object.entries(k.commands);
  if (k.commandsError) {
    parts.push(`## commands.yaml\n\nNon valido, va corretto: ${k.commandsError}`);
  } else if (commands.length) {
    parts.push(
      `## commands.yaml\n\n${commands.map(([n, argv]) => `- ${n}: \`${argv.join(' ')}\``).join('\n')}`,
    );
  }
  for (const note of k.notes) {
    if (note.text.trim()) parts.push(`## notes/${note.name}\n\n${note.text.trim()}`);
  }
  return parts.join('\n\n');
}
