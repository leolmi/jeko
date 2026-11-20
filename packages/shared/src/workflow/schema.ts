import { Type, type Static } from '@sinclair/typebox';

const Name = Type.String({ pattern: '^[a-z][a-z0-9-]*$', maxLength: 64 });
const VarName = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$', maxLength: 64 });

/** Espressione del mini-linguaggio (es. "type != 'vuoto'"). */
export const ExprSchema = Type.String({ minLength: 1, description: 'Espressione' });
/** Testo con segnaposto {{ espressione }}. */
export const TemplateSchema = Type.String({ description: 'Template' });

export const InputSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    required: Type.Optional(Type.Boolean()),
    enum: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
    default: Type.Optional(Type.String()),
    when: Type.Optional(ExprSchema),
  },
  { additionalProperties: false },
);
export type WorkflowInput = Static<typeof InputSchema>;

/** Azioni sensibili che una policy può sottoporre a gate. */
export const POLICY_ACTIONS = [
  'install',
  'git.commit',
  'git.push',
  'git.branch',
  'fs.delete',
  'network',
] as const;
export const PolicyActionSchema = Type.Union(POLICY_ACTIONS.map((a) => Type.Literal(a)));
export type PolicyAction = Static<typeof PolicyActionSchema>;

export const GateLevelSchema = Type.Union([Type.Literal('always'), Type.Literal('interactive')]);
export type GateLevel = Static<typeof GateLevelSchema>;

export const PolicySchema = Type.Object(
  {
    match: Type.Union([
      PolicyActionSchema,
      Type.Array(PolicyActionSchema, { minItems: 1, uniqueItems: true }),
    ]),
    gate: GateLevelSchema,
  },
  { additionalProperties: false },
);
export type Policy = Static<typeof PolicySchema>;

/** Quanto ragiona claude in un passo (`claude --effort`). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const EffortSchema = Type.Union(EFFORTS.map((e) => Type.Literal(e)));
export type Effort = Static<typeof EffortSchema>;

const stepBase = {
  id: Name,
  title: Type.Optional(Type.String()),
  when: Type.Optional(ExprSchema),
};

export const AgentStepSchema = Type.Object(
  {
    ...stepBase,
    type: Type.Literal('agent'),
    instructions: TemplateSchema,
    cwd: Type.Optional(TemplateSchema),
    tools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
    /** Ragionamento del passo (es. `high` per il piano); senza, quello predefinito di claude. */
    effort: Type.Optional(EffortSchema),
    /** Modello del passo (alias come `opus` o nome completo); senza, quello predefinito. */
    model: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._\\[\\]-]+$' }),
    ),
  },
  { additionalProperties: false },
);

export const AskStepSchema = Type.Object(
  {
    ...stepBase,
    type: Type.Literal('ask'),
    question: TemplateSchema,
    into: VarName,
    required: Type.Optional(Type.Boolean()),
    enum: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
  },
  { additionalProperties: false },
);

export const GateStepSchema = Type.Object(
  {
    ...stepBase,
    type: Type.Literal('gate'),
    message: TemplateSchema,
    level: Type.Optional(GateLevelSchema),
  },
  { additionalProperties: false },
);

export const OnFailSchema = Type.Union([
  Type.Literal('stop'),
  Type.Object(
    { goto: Name, retries: Type.Integer({ minimum: 1, maximum: 10 }) },
    { additionalProperties: false },
  ),
]);
export type OnFail = Static<typeof OnFailSchema>;

export const CheckStepSchema = Type.Object(
  {
    ...stepBase,
    type: Type.Literal('check'),
    /** Comandi senza shell: ogni comando è [programma, ...argomenti], tutti template. */
    exec: Type.Optional(Type.Array(Type.Array(TemplateSchema, { minItems: 1 }), { minItems: 1 })),
    /** Comandi del progetto per nome (`.jeko/commands.yaml`), prima di `exec`; i mancanti si saltano. */
    commands: Type.Optional(
      Type.Array(Type.String({ pattern: '^[a-z][a-z0-9-]*$' }), { minItems: 1, uniqueItems: true }),
    ),
    cwd: Type.Optional(TemplateSchema),
    expect: Type.Optional(ExprSchema),
    onFail: Type.Optional(OnFailSchema),
  },
  { additionalProperties: false },
);

export type AgentStep = Static<typeof AgentStepSchema>;
export type AskStep = Static<typeof AskStepSchema>;
export type GateStep = Static<typeof GateStepSchema>;
export type CheckStep = Static<typeof CheckStepSchema>;

export const StepSchema = Type.Union([
  AgentStepSchema,
  AskStepSchema,
  GateStepSchema,
  CheckStepSchema,
]);
export type Step = Static<typeof StepSchema>;
export type StepType = Step['type'];

export const WorkflowKindSchema = Type.Union([Type.Literal('create'), Type.Literal('develop')]);
export type WorkflowKind = Static<typeof WorkflowKindSchema>;

export const WorkflowSchema = Type.Object(
  {
    name: Name,
    kind: WorkflowKindSchema,
    version: Type.Integer({ minimum: 1 }),
    description: Type.Optional(Type.String()),
    inputs: Type.Optional(Type.Record(VarName, InputSchema)),
    vars: Type.Optional(Type.Record(VarName, TemplateSchema)),
    policies: Type.Optional(Type.Array(PolicySchema)),
    steps: Type.Array(StepSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type Workflow = Static<typeof WorkflowSchema>;
