import { Type, type Static } from '@sinclair/typebox';

export const Id = Type.String({ format: 'uuid' });
export const Timestamp = Type.String({ format: 'date-time' });

export const ProjectSchema = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    /** Cartella del progetto sul PC del runner: le run del progetto lavorano lì. */
    path: Type.String(),
    /** Workflow `develop` che guida i task del progetto; null = il predefinito. */
    workflow: Type.Union([Type.String(), Type.Null()]),
    createdAt: Timestamp,
  },
  { additionalProperties: false },
);
export type Project = Static<typeof ProjectSchema>;

export const CreateProjectSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    path: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
);
export type CreateProject = Static<typeof CreateProjectSchema>;

export const UpdateProjectSchema = Type.Object(
  { workflow: Type.Union([Type.String({ minLength: 1 }), Type.Null()]) },
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

export const HealthSchema = Type.Object({
  status: Type.Literal('ok'),
  version: Type.String(),
  runner: Type.Boolean(),
});
export type Health = Static<typeof HealthSchema>;

/**
 * Opzioni dell'utente, salvate sul server e modificabili dalla web-app; il runner le riceve
 * con ogni run. La prima volta si impostano nel wizard.
 */
export const UserSettingsSchema = Type.Object(
  {
    /** Cartella in cui nascono i progetti nuovi (`jeko.projectsDir` nei workflow). */
    projectsDir: Type.Optional(Type.String({ minLength: 1, maxLength: 260 })),
  },
  { additionalProperties: false },
);
export type UserSettings = Static<typeof UserSettingsSchema>;
