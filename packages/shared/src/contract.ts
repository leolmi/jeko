import { Type, type Static } from '@sinclair/typebox';

export const Id = Type.String({ format: 'uuid' });
export const Timestamp = Type.String({ format: 'date-time' });

export const ProjectSchema = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    createdAt: Timestamp,
  },
  { additionalProperties: false },
);
export type Project = Static<typeof ProjectSchema>;

export const CreateProjectSchema = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);
export type CreateProject = Static<typeof CreateProjectSchema>;

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
