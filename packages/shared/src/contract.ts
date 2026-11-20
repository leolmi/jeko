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
