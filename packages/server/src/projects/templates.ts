import { join } from 'node:path';
import { templateIssues, type ProjectTemplate } from '@jeko/shared';
import { now, readJson, writeJson, type SettingsFile } from '../data/files.js';

/** Template di serie già caricati una volta: se l'utente li elimina, non tornano. */
const SEEDED = 'templates.seeded';

export type TemplateFile = Pick<ProjectTemplate, 'name' | 'prompt'>;

/** File di un template di serie: `# Nome` sulla prima riga, poi il prompt. */
export function parseTemplateFile(text: string): TemplateFile {
  const [first = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  const name = /^#\s+(.+)$/.exec(first)?.[1]?.trim();
  const prompt = rest.join('\n').trim();
  if (!name || !prompt) throw new Error('Template di serie: serve "# Nome" e poi il prompt');
  return { name, prompt };
}

const lower = (t: ProjectTemplate) => t.name.toLowerCase();
const byName = (a: ProjectTemplate, b: ProjectTemplate) =>
  lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0;

/** Template per creare progetti con l'AI: prompt già pronti con un nome, in `templates.json`. */
export class TemplateStore {
  private readonly file: string;
  private items: ProjectTemplate[];

  constructor(
    dataDir: string,
    private readonly settings: SettingsFile,
  ) {
    this.file = join(dataDir, 'templates.json');
    this.items = readJson<ProjectTemplate[]>(this.file, []);
  }

  /**
   * Carica i template di serie una volta sola: non quelli con un nome già usato (quelli
   * dell'utente non si toccano) né quelli già caricati e poi eliminati. Restituisce i nomi aggiunti.
   */
  async seed(files: TemplateFile[]): Promise<string[]> {
    const seeded = new Set(this.settings.get<string[]>(SEEDED) ?? []);
    const added: string[] = [];
    for (const { name, prompt } of files) {
      const issues = templateIssues(prompt);
      if (issues.length) throw new Error(`Template di serie "${name}": ${issues[0]?.message}`);
      if (seeded.has(name)) continue;
      seeded.add(name);
      if (await this.get(name)) continue;
      await this.save(name, prompt);
      added.push(name);
    }
    const list = [...seeded].sort();
    if (JSON.stringify(list) !== JSON.stringify(this.settings.get(SEEDED) ?? []))
      this.settings.set(SEEDED, list);
    return added;
  }

  async list(): Promise<ProjectTemplate[]> {
    return [...this.items].sort(byName);
  }

  async get(name: string): Promise<ProjectTemplate | null> {
    return this.items.find((t) => t.name === name) ?? null;
  }

  /** Crea o sostituisce il template con quel nome. */
  async save(name: string, prompt: string): Promise<ProjectTemplate> {
    const template = { name: name.trim(), prompt, updatedAt: now() };
    this.write([...this.items.filter((t) => t.name !== template.name), template]);
    return template;
  }

  async remove(name: string): Promise<boolean> {
    if (!this.items.some((t) => t.name === name)) return false;
    this.write(this.items.filter((t) => t.name !== name));
    return true;
  }

  private write(items: ProjectTemplate[]): void {
    writeJson(this.file, items);
    this.items = items;
  }
}
