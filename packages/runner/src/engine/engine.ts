import { createHash } from 'node:crypto';
import {
  evalExpr,
  renderTemplate,
  truthy,
  type CheckStep,
  type Functions,
  type GateLevel,
  type Policy,
  type PolicyAction,
  type RunEvent,
  type RunMode,
  type RunState,
  type RunStatus,
  type Step,
  type UserSettings,
  type Workflow,
} from '@jeko/shared';
import { classifyCommand, classifyTool, gateLevel, gateStops } from './policy.js';

// ---------- host: tutto ciò che il motore non fa da sé ----------

export interface AskRequest {
  stepId: string;
  question: string;
  enum?: string[];
  default?: string;
  required: boolean;
  /** Domanda di claude (AskUserQuestion): scelte suggerite, ma la risposta è libera. */
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** Una domanda di claude (strumento AskUserQuestion). */
export type AgentQuestion = Pick<AskRequest, 'question' | 'header' | 'options' | 'multiSelect'>;

export interface ApproveRequest {
  stepId: string;
  message: string;
  reason: 'gate' | 'policy';
  actions?: PolicyAction[];
}

export interface AgentRequest {
  stepId: string;
  instructions: string;
  cwd?: string;
  tools?: string[];
  sessionId?: string;
  /** Identifica il turno anche dopo un riavvio del runner: un turno finito non si riesegue. */
  turnKey: string;
  /** Annulla il turno (run annullata). */
  signal?: AbortSignal;
  /** Policy e modalità: servono all'hook di claude per sapere quando chiedere. */
  gates: { policies: Policy[]; mode: RunMode };
  /** Da chiamare quando claude chiede il permesso per uno strumento. */
  authorize: (tool: string, input: unknown) => Promise<boolean>;
  /** Domanda di claude all'utente; null se l'utente non risponde. Assente in headless. */
  askUser?: (q: AgentQuestion) => Promise<string | null>;
  /** Avanzamento del turno: testo di claude o strumento usato. */
  onActivity?: (a: { kind: 'text' | 'tool'; tool?: string; text: string }) => void;
}

export interface AgentResult {
  ok: boolean;
  output: string;
  sessionId?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Review = { ok: true } | { ok: false; feedback: string };

export interface Host {
  ask(req: AskRequest): Promise<string | null>;
  approve(req: ApproveRequest): Promise<{ approved: boolean; note?: string }>;
  /** Solo in modalità interactive, dopo ogni passo agent. */
  review(req: { stepId: string; output: string }): Promise<Review>;
  agent(req: AgentRequest): Promise<AgentResult>;
  exec(argv: string[], cwd?: string): Promise<ExecResult>;
  /** Comandi del progetto (`.jeko/commands.yaml`) per i check con `commands`. */
  projectCommands?(cwd?: string): Promise<Record<string, string[]>>;
  functions: Functions;
  emit(event: RunEvent): void;
}

export interface RunOptions {
  runId: string;
  workflow: Workflow;
  request: string;
  mode: RunMode;
  /** Valori degli input già ricavati dalla richiesta. */
  inputs?: Record<string, string>;
  /** Per riprendere una run interrotta. */
  state?: RunState;
  /** Opzioni dell'utente (dal server): `projectsDir` diventa `jeko.projectsDir`. */
  settings?: UserSettings;
  /** Annulla la run: si ferma prima del passo successivo o mentre attende l'utente. */
  signal?: AbortSignal;
}

export interface RunOutcome {
  status: RunStatus;
  state: RunState;
  error?: string;
}

const MAX_ASK_ATTEMPTS = 3;
const MAX_REVIEW_ROUNDS = 5;

class Stop extends Error {
  constructor(
    readonly status: Exclude<RunStatus, 'done'>,
    message: string,
  ) {
    super(message);
  }
}

// ---------- motore ----------

export async function runWorkflow(opts: RunOptions, host: Host): Promise<RunOutcome> {
  const { runId, workflow: wf, mode } = opts;
  const resumed = opts.state !== undefined;
  const state: RunState = opts.state
    ? structuredClone(opts.state)
    : { stepIndex: 0, values: {}, retries: {}, steps: {} };

  const emit = (e: DistributiveOmit<RunEvent, 'runId'>) => host.emit({ ...e, runId } as RunEvent);
  const ctx = () => ({
    vars: {
      ...state.values,
      request: opts.request,
      steps: state.steps,
      jeko: {
        mode,
        runId,
        lastFailure: state.lastFailure ?? null,
        projectsDir: opts.settings?.projectsDir ?? null,
      },
    },
    functions: host.functions,
  });
  const render = (tpl: string) => renderTemplate(tpl, ctx());
  const test = (expr: string) => truthy(evalExpr(expr, ctx()));

  /** Applica le policy a un comando: true se si può procedere. */
  const authorize = async (stepId: string, actions: PolicyAction[], command: string) => {
    const level = gateLevel(actions, wf.policies);
    if (!level || !gateStops(level, mode)) return true;
    const { approved } = await host.approve({
      stepId,
      message: `Il passo vuole eseguire: ${command}`,
      reason: 'policy',
      actions,
    });
    emit({ type: 'policy.gate', stepId, actions, command, approved });
    return approved;
  };

  const finish = (status: RunStatus, error?: string): RunOutcome => {
    emit({ type: 'run.finished', status, ...(error !== undefined && { error }) });
    return { status, state, ...(error !== undefined && { error }) };
  };

  emit({ type: 'run.started', workflow: wf.name, version: wf.version, mode });

  try {
    if (!resumed) {
      await collectInputs();
      for (const [name, tpl] of Object.entries(wf.vars ?? {})) state.values[name] = render(tpl);
      emit({ type: 'state', state });
    }

    while (state.stepIndex < wf.steps.length) {
      if (opts.signal?.aborted) throw new Stop('cancelled', 'Run annullata');
      const step = wf.steps[state.stepIndex]!;
      const title = step.title !== undefined && { title: step.title };
      emit({ type: 'step.started', stepId: step.id, index: state.stepIndex, ...title });

      if (step.when && !test(step.when)) {
        emit({ type: 'step.skipped', stepId: step.id, ...title });
        state.stepIndex++;
        continue;
      }

      const jump = await runStep(step);
      state.stepIndex = jump ?? state.stepIndex + 1;
      emit({ type: 'state', state });
    }
    return finish('done');
  } catch (e) {
    if (e instanceof Stop) return finish(e.status, e.message);
    if (opts.signal?.aborted) return finish('cancelled', 'Run annullata');
    return finish('failed', e instanceof Error ? e.message : String(e));
  }

  // ---------- input ----------

  async function collectInputs(): Promise<void> {
    for (const [name, input] of Object.entries(wf.inputs ?? {})) {
      if (input.when && !test(input.when)) {
        state.values[name] = null;
        continue;
      }
      let value: string | null = opts.inputs?.[name] ?? null;
      if (value === null && input.default !== undefined && mode === 'headless')
        value = input.default;
      for (let attempt = 0; value === null || !allowed(value, input.enum); attempt++) {
        if (attempt >= MAX_ASK_ATTEMPTS) throw new Stop('failed', `Input '${name}' non valido`);
        value = await host.ask({
          stepId: `input:${name}`,
          question: input.prompt,
          required: input.required ?? false,
          ...(input.enum && { enum: input.enum }),
          ...(input.default !== undefined && { default: input.default }),
        });
        if (value === null || value === '') {
          if (input.default !== undefined) value = input.default;
          else if (!input.required) break;
          else value = null;
        }
      }
      state.values[name] = value;
    }
  }

  // ---------- passi ----------

  /** Esegue un passo; restituisce l'indice a cui saltare, se diverso dal successivo. */
  async function runStep(step: Step): Promise<number | undefined> {
    switch (step.type) {
      case 'agent':
        return void (await agentStep(step));
      case 'ask':
        return void (await askStep(step));
      case 'gate':
        return void (await gateStep(step.id, render(step.message), step.level ?? 'interactive'));
      case 'check':
        return checkStep(step);
    }
  }

  async function agentStep(step: Extract<Step, { type: 'agent' }>): Promise<void> {
    let instructions = render(step.instructions);
    if (state.lastFailure) {
      instructions += `\n\nAttenzione, il controllo precedente è fallito:\n${state.lastFailure}`;
    }
    const cwd = step.cwd ? render(step.cwd) : undefined;

    for (let round = 0; ; round++) {
      // Lo stato si salva a fine passo: dopo un riavvio i turni del passo hanno le stesse chiavi.
      const n = state.turns ?? 0;
      state.turns = n + 1;
      const hash = createHash('sha256').update(instructions).digest('hex').slice(0, 8);
      const res = await host.agent({
        stepId: step.id,
        instructions,
        turnKey: `${step.id}-${n}-${hash}`,
        ...(opts.signal && { signal: opts.signal }),
        ...(cwd !== undefined && { cwd }),
        ...(step.tools && { tools: step.tools }),
        ...(state.sessionId !== undefined && { sessionId: state.sessionId }),
        gates: { policies: wf.policies ?? [], mode },
        authorize: async (tool, input) => {
          const { actions, command } = classifyTool(tool, input);
          return authorize(step.id, actions, command);
        },
        // In headless la run si ferma solo ai gate `always`: claude decide da sé.
        ...(mode !== 'headless' && {
          askUser: (q: AgentQuestion) => host.ask({ stepId: step.id, required: false, ...q }),
        }),
        onActivity: (a) => emit({ type: 'agent.activity', stepId: step.id, ...a }),
      });
      if (res.sessionId) state.sessionId = res.sessionId;
      record(step.id, res.ok, res.output);
      if (!res.ok) throw new Stop('failed', `Il passo '${step.id}' è fallito`);

      if (mode !== 'interactive') return;
      const review = await host.review({ stepId: step.id, output: res.output });
      if (review.ok) return;
      if (round + 1 >= MAX_REVIEW_ROUNDS) {
        throw new Stop('failed', `Troppe revisioni per il passo '${step.id}'`);
      }
      instructions = review.feedback;
    }
  }

  async function askStep(step: Extract<Step, { type: 'ask' }>): Promise<void> {
    const question = render(step.question);
    for (let attempt = 0; attempt < MAX_ASK_ATTEMPTS; attempt++) {
      const answer = await host.ask({
        stepId: step.id,
        question,
        required: step.required ?? false,
        ...(step.enum && { enum: step.enum }),
      });
      const empty = answer === null || answer === '';
      if (empty && step.required) continue;
      if (!empty && !allowed(answer, step.enum)) continue;
      state.values[step.into] = empty ? null : answer;
      record(step.id, true, answer ?? '');
      return;
    }
    throw new Stop('failed', `Nessuna risposta valida per '${step.id}'`);
  }

  async function gateStep(stepId: string, message: string, level: GateLevel): Promise<void> {
    if (!gateStops(level, mode)) {
      record(stepId, true, 'saltato (headless)');
      return;
    }
    const { approved, note } = await host.approve({ stepId, message, reason: 'gate' });
    record(stepId, approved, note ?? (approved ? 'approvato' : 'rifiutato'));
    if (!approved) throw new Stop('rejected', note ?? `Gate '${stepId}' rifiutato`);
  }

  async function checkStep(step: CheckStep): Promise<number | undefined> {
    const failure = await runCheck(step);
    if (failure === null) {
      delete state.lastFailure;
      record(step.id, true, 'ok');
      return undefined;
    }
    record(step.id, false, failure);

    const onFail = step.onFail ?? 'stop';
    if (onFail === 'stop') throw new Stop('failed', `Controllo '${step.id}' fallito: ${failure}`);

    const used = state.retries[step.id] ?? 0;
    if (used >= onFail.retries) {
      throw new Stop('failed', `Controllo '${step.id}' fallito dopo ${used} tentativi: ${failure}`);
    }
    state.retries[step.id] = used + 1;
    state.lastFailure = `[${step.id}] ${failure}`;
    return wf.steps.findIndex((s) => s.id === onFail.goto);
  }

  /** null se il controllo passa, altrimenti il motivo. */
  async function runCheck(step: CheckStep): Promise<string | null> {
    const cwd = step.cwd ? render(step.cwd) : undefined;
    const argvs: string[][] = [];
    if (step.commands?.length) {
      let known: Record<string, string[]>;
      try {
        known = (await host.projectCommands?.(cwd)) ?? {};
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      // Un comando che il progetto non definisce si salta: non tutti hanno lint o typecheck.
      for (const name of step.commands) if (known[name]) argvs.push(known[name]);
    }
    for (const cmd of step.exec ?? []) argvs.push(cmd.map(render));
    for (const argv of argvs) {
      const line = argv.join(' ');
      if (!(await authorize(step.id, classifyCommand(line), line))) {
        throw new Stop('rejected', `Comando non approvato: ${line}`);
      }
      const res = await host.exec(argv, cwd);
      if (res.code !== 0) {
        const out = (res.stderr || res.stdout).trim();
        return `'${line}' è uscito con codice ${res.code}${out ? `\n${tail(out)}` : ''}`;
      }
    }
    if (step.expect && !test(step.expect)) return `condizione falsa: ${step.expect}`;
    return null;
  }

  function record(stepId: string, ok: boolean, output: string): void {
    state.steps[stepId] = { ok, output };
    emit({ type: 'step.finished', stepId, ok, output });
  }
}

function allowed(value: string | null, values: string[] | undefined): boolean {
  return value !== null && (!values || values.includes(value));
}

function tail(text: string, lines = 30): string {
  const all = text.split('\n');
  return all.length > lines ? ['…', ...all.slice(-lines)].join('\n') : text;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
