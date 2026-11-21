import type { ErrorObject } from 'ajv';
import { LineCounter, parseDocument, stringify } from 'yaml';
import { validator } from '../validation.js';
import {
  ExprError,
  KNOWN_FUNCTIONS,
  parseExpr,
  parseTemplate,
  references,
  type Node,
} from './expr.js';
import {
  AgentStepSchema,
  AskStepSchema,
  CheckStepSchema,
  GateStepSchema,
  WorkflowSchema,
  type Step,
  type Workflow,
} from './schema.js';

export type IssuePath = (string | number)[];

export interface Issue {
  path: IssuePath;
  message: string;
  /** Riga e colonna (da 1) nel testo YAML, quando note. */
  line?: number;
  col?: number;
}

export type WorkflowResult = { ok: true; workflow: Workflow } | { ok: false; issues: Issue[] };

/** Variabili sempre disponibili nelle espressioni. */
export const CONTEXT_VARS = ['request', 'jeko', 'steps'] as const;

const STEP_SCHEMAS = {
  agent: AgentStepSchema,
  ask: AskStepSchema,
  gate: GateStepSchema,
  check: CheckStepSchema,
} as const;

// ---------- errori di schema ----------

function ajvMessage(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'required':
      return `manca '${String(p['missingProperty'])}'`;
    case 'additionalProperties':
      return `proprietà non ammessa '${String(p['additionalProperty'])}'`;
    case 'pattern':
      return 'formato non valido';
    case 'const':
    case 'enum':
      return 'valore non ammesso';
    case 'type':
      return `deve essere di tipo ${String(p['type'])}`;
    case 'minItems':
      return `servono almeno ${String(p['limit'])} elementi`;
    case 'minLength':
      return 'non può essere vuoto';
    default:
      return e.message ?? 'non valido';
  }
}

function toPath(pointer: string): IssuePath {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function schemaIssues(value: unknown): Issue[] {
  const v = validator(WorkflowSchema);
  if (v(value)) return [];
  const issues: Issue[] = [];
  const add = (prefix: IssuePath, errors: ErrorObject[] | null | undefined) => {
    for (const e of errors ?? []) {
      if (e.keyword === 'anyOf' || e.keyword === 'oneOf') continue;
      const path = [...prefix, ...toPath(e.instancePath)];
      if (e.keyword === 'additionalProperties') path.push(String(e.params['additionalProperty']));
      issues.push({ path, message: ajvMessage(e) });
    }
  };

  // Errori fuori dai passi: così come li dà Ajv.
  add(
    [],
    v.errors?.filter((e) => !/^\/steps\/\d+/.test(e.instancePath)),
  );

  // Errori dei passi: si valida ogni passo con lo schema del suo tipo, per messaggi chiari.
  const steps = (value as { steps?: unknown }).steps;
  if (Array.isArray(steps)) {
    steps.forEach((step: unknown, i) => {
      const type = (step as { type?: unknown } | null)?.type;
      const schema =
        typeof type === 'string' && Object.hasOwn(STEP_SCHEMAS, type)
          ? STEP_SCHEMAS[type as keyof typeof STEP_SCHEMAS]
          : undefined;
      if (!schema) {
        issues.push({
          path: ['steps', i, 'type'],
          message: `tipo di passo non valido: usa ${Object.keys(STEP_SCHEMAS).join(', ')}`,
        });
        return;
      }
      const sv = validator(schema);
      if (!sv(step)) add(['steps', i], sv.errors);
    });
  }
  return issues;
}

// ---------- controlli semantici ----------

function semanticIssues(wf: Workflow): Issue[] {
  const issues: Issue[] = [];
  const known = new Set<string>(CONTEXT_VARS);
  const inputNames = Object.keys(wf.inputs ?? {});

  const checkNode = (node: Node, path: IssuePath, scope: Set<string>) => {
    const refs = references(node);
    for (const f of refs.functions) {
      if (!KNOWN_FUNCTIONS.has(f)) issues.push({ path, message: `funzione sconosciuta '${f}'` });
    }
    for (const name of refs.vars) {
      if (!scope.has(name)) issues.push({ path, message: `variabile non definita '${name}'` });
    }
  };
  const checkExpr = (src: string, path: IssuePath, scope: Set<string>) => {
    try {
      checkNode(parseExpr(src), path, scope);
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      issues.push({ path, message: `espressione non valida: ${e.message}` });
    }
  };
  const checkTemplate = (src: string, path: IssuePath, scope: Set<string>) => {
    try {
      for (const part of parseTemplate(src)) {
        if ('expr' in part) checkNode(part.expr, path, scope);
      }
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      issues.push({ path, message: `template non valido: ${e.message}` });
    }
  };

  // Input: le condizioni vedono il contesto e tutti gli input.
  inputNames.forEach((n) => known.add(n));
  for (const [name, input] of Object.entries(wf.inputs ?? {})) {
    if (input.when) checkExpr(input.when, ['inputs', name, 'when'], known);
    if (input.enum && input.default !== undefined && !input.enum.includes(input.default)) {
      issues.push({
        path: ['inputs', name, 'default'],
        message: 'il default non è tra i valori ammessi',
      });
    }
  }

  // Variabili: in ordine, ognuna vede solo quelle precedenti.
  for (const [name, tpl] of Object.entries(wf.vars ?? {})) {
    if (known.has(name)) issues.push({ path: ['vars', name], message: `nome già usato '${name}'` });
    checkTemplate(tpl, ['vars', name], known);
    known.add(name);
  }

  // Passi: lineari; ogni passo vede le variabili raccolte dai passi precedenti.
  const seen = new Map<string, number>();
  wf.steps.forEach((step: Step, i) => {
    const at = (...p: IssuePath): IssuePath => ['steps', i, ...p];
    if (seen.has(step.id)) issues.push({ path: at('id'), message: `id ripetuto '${step.id}'` });
    if (step.when) checkExpr(step.when, at('when'), known);

    switch (step.type) {
      case 'agent':
        if ((step.instructions === undefined) === (step.prompt === undefined)) {
          issues.push({ path: at(), message: "un passo agent vuole 'instructions' o 'prompt'" });
        }
        if (step.instructions !== undefined)
          checkTemplate(step.instructions, at('instructions'), known);
        if (step.cwd) checkTemplate(step.cwd, at('cwd'), known);
        break;
      case 'gate':
        checkTemplate(step.message, at('message'), known);
        break;
      case 'ask':
        checkTemplate(step.question, at('question'), known);
        if (known.has(step.into)) {
          issues.push({ path: at('into'), message: `nome già usato '${step.into}'` });
        }
        break;
      case 'check':
        if (!step.exec && !step.commands && !step.expect) {
          issues.push({ path: at(), message: "un check vuole 'exec', 'commands' o 'expect'" });
        }
        step.exec?.forEach((cmd, c) =>
          cmd.forEach((arg, a) => checkTemplate(arg, at('exec', c, a), known)),
        );
        if (step.cwd) checkTemplate(step.cwd, at('cwd'), known);
        if (step.expect) checkExpr(step.expect, at('expect'), known);
        if (step.onFail && step.onFail !== 'stop') {
          const target = seen.get(step.onFail.goto);
          if (target === undefined) {
            issues.push({
              path: at('onFail', 'goto'),
              message: `'${step.onFail.goto}' deve essere un passo precedente`,
            });
          }
        }
        break;
    }

    seen.set(step.id, i);
    if (step.type === 'ask') known.add(step.into);
  });

  return issues;
}

// ---------- API ----------

export function validateWorkflow(value: unknown): WorkflowResult {
  const schema = schemaIssues(value);
  if (schema.length) return { ok: false, issues: schema };
  const wf = value as Workflow;
  const semantic = semanticIssues(wf);
  return semantic.length ? { ok: false, issues: semantic } : { ok: true, workflow: wf };
}

/** Legge un workflow da YAML: errori con riga e colonna quando possibile. */
export function parseWorkflow(text: string): WorkflowResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });

  if (doc.errors.length) {
    return {
      ok: false,
      issues: doc.errors.map((e) => {
        const pos = lineCounter.linePos(e.pos[0]);
        return { path: [], message: e.message.split('\n')[0]!, line: pos.line, col: pos.col };
      }),
    };
  }

  let result = validateWorkflow(doc.toJS());
  // I progetti nuovi nascono dai template: i workflow scritti dall'utente sono di sviluppo.
  if (result.ok && result.workflow.kind !== 'develop')
    result = {
      ok: false,
      issues: [{ path: ['kind'], message: "solo 'develop': i progetti si creano dai template" }],
    };
  if (result.ok) return result;

  return {
    ok: false,
    issues: result.issues.map((issue) => {
      // Risale il percorso fino al primo nodo che esiste nel documento.
      for (let n = issue.path.length; n >= 0; n--) {
        const node = doc.getIn(issue.path.slice(0, n), true) as
          { range?: [number, number, number] } | undefined;
        if (node?.range) {
          const pos = lineCounter.linePos(node.range[0]);
          return { ...issue, line: pos.line, col: pos.col };
        }
      }
      return issue;
    }),
  };
}

export function stringifyWorkflow(wf: Workflow): string {
  return stringify(wf, { lineWidth: 100 });
}

export function formatIssue(issue: Issue): string {
  const where = issue.path.reduce<string>(
    (s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p),
    '',
  );
  const pos = issue.line ? `${issue.line}:${issue.col ?? 1} ` : '';
  return `${pos}${where ? `${where}: ` : ''}${issue.message}`;
}
