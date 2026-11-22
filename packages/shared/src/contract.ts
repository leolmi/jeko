import { Type, type Static } from '@sinclair/typebox';
import { AgentChoiceSchema } from './workflow/schema.js';

export const Id = Type.String({ format: 'uuid' });
export const Timestamp = Type.String({ format: 'date-time' });

/**
 * Cosa togliere dal contesto di claude nelle run del progetto, per non gonfiare il budget
 * iniziale: strumenti integrati e server MCP (`--disallowedTools`), plugin (`enabledPlugins`
 * a false nelle impostazioni) e, in blocco, skill e comandi (`--disable-slash-commands`).
 */
export const ContextExclusionsSchema = Type.Object(
  {
    tools: Type.Array(Type.String({ minLength: 1 })),
    mcpServers: Type.Array(Type.String({ minLength: 1 })),
    /** Come li riporta claude: `nome@marketplace`. */
    plugins: Type.Array(Type.String({ minLength: 1 })),
    skills: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ContextExclusions = Static<typeof ContextExclusionsSchema>;

/** Strumenti che servono ai workflow: non si escludono. */
export const ESSENTIAL_TOOLS = [
  'Bash',
  'PowerShell',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'ToolSearch',
] as const;

/** Nessuna esclusione da applicare. */
export const noExclusions = (e: ContextExclusions | undefined): boolean =>
  !e || (!e.tools.length && !e.mcpServers.length && !e.plugins.length && !e.skills);

/** Cosa claude carica all'avvio in una cartella (dal messaggio `init`). */
export const ContextInventorySchema = Type.Object({
  tools: Type.Array(Type.String()),
  mcpServers: Type.Array(Type.Object({ name: Type.String(), status: Type.String() })),
  plugins: Type.Array(Type.Object({ name: Type.String(), source: Type.String() })),
  skills: Type.Array(Type.String()),
});
export type ContextInventory = Static<typeof ContextInventorySchema>;

export const ProjectSchema = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    /** Cartella del progetto sul PC del runner: le run del progetto lavorano lì. */
    path: Type.String(),
    /** Workflow `develop` che guida i task del progetto; null = il predefinito. */
    workflow: Type.Union([Type.String(), Type.Null()]),
    /** Esclusioni dal contesto di claude; assente = nessuna. */
    exclude: Type.Optional(ContextExclusionsSchema),
    /** Ragionamento e modello predefiniti dei task del progetto; assente = quelli di claude. */
    agent: Type.Optional(AgentChoiceSchema),
    /** Posizione tra i preferiti; assente = non è un preferito. */
    favorite: Type.Optional(Type.Integer({ minimum: 0 })),
    createdAt: Timestamp,
  },
  { additionalProperties: false },
);
export type Project = Static<typeof ProjectSchema>;

/** Progetti preferiti, nell'ordine in cui si mostrano. */
export const SetFavoritesSchema = Type.Object(
  { ids: Type.Array(Id, { maxItems: 1000 }) },
  { additionalProperties: false },
);
export type SetFavorites = Static<typeof SetFavoritesSchema>;

export const CreateProjectSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    path: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
);
export type CreateProject = Static<typeof CreateProjectSchema>;

export const UpdateProjectSchema = Type.Object(
  {
    workflow: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    exclude: Type.Optional(ContextExclusionsSchema),
    /** `{}` torna a quelli di claude. */
    agent: Type.Optional(AgentChoiceSchema),
  },
  { additionalProperties: false },
);
export type UpdateProject = Static<typeof UpdateProjectSchema>;

/**
 * Chiave di una cartella, per confrontarle: senza distinguere maiuscole né separatori.
 * Meglio scambiare per uguali due cartelle diverse (raro) che farne lavorare due sulla stessa.
 */
export function folderKey(path: string | null | undefined): string | null {
  const key = path
    ?.trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
  return key || null;
}

/** Prompt già pronto, con un nome, per creare progetti con l'AI. */
export const ProjectTemplateSchema = Type.Object({
  name: Type.String(),
  prompt: Type.String(),
  updatedAt: Timestamp,
});
export type ProjectTemplate = Static<typeof ProjectTemplateSchema>;

export const TemplateName = Type.String({ minLength: 1, maxLength: 80, pattern: '\\S' });

export const SaveTemplateSchema = Type.Object(
  { prompt: Type.String({ minLength: 1, maxLength: 20_000 }) },
  { additionalProperties: false },
);
export type SaveTemplate = Static<typeof SaveTemplateSchema>;

/** Prompt del progetto (`.jeko/prompts/<nome>.md`), eseguito dai passi `prompt: <nome>`. */
export const PromptName = Type.String({ pattern: '^[a-z][a-z0-9-]*$', maxLength: 80 });

export const ProjectPromptSchema = Type.Object({ name: PromptName, text: Type.String() });
export type ProjectPrompt = Static<typeof ProjectPromptSchema>;

export const SaveProjectPromptSchema = Type.Object(
  { text: Type.String({ minLength: 1, maxLength: 20_000 }) },
  { additionalProperties: false },
);

export const HealthSchema = Type.Object({
  status: Type.Literal('ok'),
  /** Per riconoscere il servizio di Jeko sulla porta (pagina d'avvio, seconda istanza). */
  app: Type.Literal('jeko'),
  version: Type.String(),
  runner: Type.Boolean(),
});
export type Health = Static<typeof HealthSchema>;

/**
 * Opzioni dell'utente, salvate sul server e modificabili dalla web-app; il runner le riceve
 * con ogni run. La prima volta si impostano nel wizard.
 */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF'] as const;
export const CurrencySchema = Type.Union([
  Type.Literal('USD'),
  Type.Literal('EUR'),
  Type.Literal('GBP'),
  Type.Literal('CHF'),
]);
export type Currency = (typeof CURRENCIES)[number];
const rate = Type.Number({ exclusiveMinimum: 0 });

/** Come la web-app mostra date, ore e costi (claude dà i costi in USD). */
export const FormatsSchema = Type.Object(
  {
    date: Type.Optional(
      Type.Union([
        Type.Literal('auto'),
        Type.Literal('dmy'),
        Type.Literal('mdy'),
        Type.Literal('ymd'),
      ]),
    ),
    time: Type.Optional(
      Type.Union([Type.Literal('auto'), Type.Literal('h24'), Type.Literal('h12')]),
    ),
    currency: Type.Optional(CurrencySchema),
    /** Cambi: quanto vale 1 USD in ciascuna valuta. */
    rates: Type.Optional(
      Type.Object(
        {
          USD: Type.Optional(rate),
          EUR: Type.Optional(rate),
          GBP: Type.Optional(rate),
          CHF: Type.Optional(rate),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type Formats = Static<typeof FormatsSchema>;
export type DateFormat = NonNullable<Formats['date']>;
export type TimeFormat = NonNullable<Formats['time']>;

export const UserSettingsSchema = Type.Object(
  {
    /** Cartella in cui nascono i progetti nuovi (`jeko.projectsDir` nei workflow). */
    projectsDir: Type.Optional(Type.String({ minLength: 1, maxLength: 260 })),
    formats: Type.Optional(FormatsSchema),
  },
  { additionalProperties: false },
);
export type UserSettings = Static<typeof UserSettingsSchema>;
