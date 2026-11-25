# Piano: agenti diversi da Claude Code

## Obiettivo

Jeko usa un agente scelto per progetto o task (Claude Code, Codex CLI, …) senza perdere ciò che
funziona oggi. Workflow, knowledge `.jeko/`, prompt, gate, chat e accesso remoto restano uguali.

## Cosa è già generico

- `Host.agent(req)` del motore ([engine.ts](packages/runner/src/engine/engine.ts)): istruzioni,
  sessione, strumenti, modello, impegno → uscita e consumi.
- Turni durevoli ([turn.ts](packages/runner/src/turn.ts)): processo staccato, uscita su file,
  riaggancio e ripresa. Sono legati a claude solo tramite `claudeArgs` e `parseStream`.
- Policy sui comandi di shell (`classifyCommand`): regole sulla riga di comando, valgono per
  qualsiasi agente.

## Cosa è legato a claude

| Punto | File |
|---|---|
| Argomenti, stream-json, attività, consumi | `runner/src/claude.ts` |
| Sessione con id scelto da Jeko (`--session-id`), `--resume`, `--fork-session` | `turn.ts`, `claude.ts` |
| Permessi: `--permission-prompt-tool` (MCP `approve`) + hook PreToolUse via `--settings` | `permissions/bridge.ts`, `hook.ts`, `mcp.ts` |
| Domande: formato di AskUserQuestion | `permissions/bridge.ts` |
| Nomi degli strumenti (`Bash`, `PowerShell`, `WebFetch`, `mcp__…`) | `engine/policy.ts` (`classifyTool`), `claude.ts` |
| `tools` dei passi agent con sintassi claude (`Bash(npm test:*)`) | `shared/workflow/schema.ts` |
| Esclusioni dal contesto (plugin, skill, server MCP) e analisi dell'`init` | `claude.ts`, `context-probe.ts` |
| Modelli (`opus`, `sonnet`…), impegno, modello predefinito per cartella | `shared/workflow/schema.ts`, `server/settings/claude-models.ts`, `admin/ui/agent-choice.ts` |
| Risposte solo testo (`assist`), diagnostica (versione, login) | `assist.ts`, `diagnostics.ts` |
| Nota di sistema del turno (`TURN_NOTE`, nome `mcp__jeko__start_process`) | `claude.ts` |
| Testi e messaggi ("claude", `JEKO_CLAUDE_BIN`) | `admin/core/i18n.ts`, vari |

## Fasi

### 1. Interfaccia `AgentDriver` (solo rifattorizzazione, Claude resta l'unico) — fatta

Fatto: `agents/driver.ts` (interfaccia e tipi comuni), `agents/claude/` (`cli.ts`, `assist.ts`,
`context-probe.ts`, `index.ts` con `claudeDriver`). `durableTurn`, node-host, runner e diagnostica
usano il driver; le policy ricevono un `ToolCall` (`shell`/`web`/`other`) tradotto dal driver.
Resta da fare: `permissions/` (bridge e hook sono di claude) resta dov'è.

### Fatto dopo

- Opzioni › Agente: scelta dell'agente, comando (vuoto = predefinito) e sue verifiche. Il
  server manda la scelta al runner (`agents.config`); le run usano quella in `settings`.
- `turn.ts` gestisce la sessione scelta dall'agente (`sessionOf`) e la nota del turno in testa
  alla richiesta (`preparePrompt`) per chi non ha un prompt di sistema.
- Driver in ANTEPRIMA, non provati con le CLI vere (scritti dalla documentazione):
  `agents/codex.ts`, `agents/cursor.ts`, `agents/gemini.ts`. Visibili solo con
  `JEKO_AGENTS_PREVIEW=1`. Senza blocco per azione (`gate: 'none'`), senza MCP di Jeko
  (niente `start_process`), senza copia della sessione. Da verificare per ciascuno: argomenti,
  eventi dell'uscita, ripresa, permessi in modalità non interattiva (fase 3).
- Da fare: una run ripresa dopo un cambio di agente usa il nuovo agente (andrebbe fissato
  l'agente nella run).

Bozza iniziale:

Nuova cartella `packages/runner/src/agents/`:

```ts
interface AgentDriver {
  id: string;                       // 'claude', 'codex', …
  label: string;
  caps: {
    resume: boolean;  fork: boolean;
    ownSessionId: boolean;          // l'id lo sceglie Jeko (claude) o l'agente (lo legge dall'uscita)
    effort: readonly string[];      // [] se non c'è
    models: readonly string[];      // alias proposti nel menu
    gate: 'per-tool' | 'none';      // può fermare la singola azione?
    questions: boolean;             // domande all'utente nella chat
    mcp: boolean;                   // start_process e permessi via MCP
    contextProbe: boolean;  usage: boolean;  cost: boolean;
  };
  command(): string[];              // es. JEKO_CLAUDE_BIN o 'claude'
  turn(input: TurnInput): { args: string[]; env?: Record<string, string> };
  parseStream(text: string): TurnOutput | null;   // anche sessionId e modello
  parseActivity(line: string): Activity[];
  permissions?: PermissionBridge;   // solo se gate === 'per-tool'
  canonicalTool(name: string): 'shell' | 'web' | 'ask' | 'process' | 'other';
  assist(prompt: string): Promise<string>;
  probe?(cwd: string): Promise<ContextInventory>;
  diagnose(): Promise<Check[]>;
}
```

- `agents/claude/` raccoglie `claude.ts`, bridge, hook, MCP, context-probe, assist e i controlli
  di claude in `diagnostics.ts`.
- `durableTurn` riceve il driver al posto di `command` + `claudeArgs`. `TurnMeta.sessionId`
  può arrivare anche dopo l'avvio (`ownSessionId: false`).
- `classifyTool` lavora sul nome canonico.
- Fatto quando: tutti i test esistenti passano senza modifiche al comportamento.

### 2. Scelta dell'agente

- `AgentChoice` prende `agent?: string` (progetto e task), con Claude come predefinito.
- Il runner dichiara gli agenti disponibili e le loro `caps` (nella diagnostica / all'avvio).
- UI: in `agent-choice` si sceglie l'agente, poi modelli e impegno di quell'agente. Si nasconde
  ciò che le `caps` non hanno (impegno, esclusioni dal contesto, costo nelle statistiche).
- `ClaudeModelStore` → modello predefinito per agente e cartella.
- Testi: "claude" → nome dell'agente dove serve.
- `tools` dei passi: per Claude restano com'è; per gli altri agenti si ignorano con un avviso
  (oppure si traducono, se l'agente ha un concetto simile).
- Una run usa un solo agente: la sessione non passa da un agente all'altro.

### 3. Permessi quando l'agente non ferma la singola azione

Se `gate === 'none'` e una policy della run vuole fermare un'azione nella modalità scelta:
- l'agente lavora in sola lettura / sandbox se lo permette, oppure
- Jeko rifiuta di avviare la run spiegando perché, oppure
- avvisa e prosegue (solo in modalità autonoma).

Le domande all'utente senza `questions`: l'agente decide da solo (come oggi in autonomia).

### 4. Secondo driver

Candidato: Codex CLI (`codex exec --json`, ripresa della sessione, server MCP, sandbox).
Prima di scriverlo, verificare le opzioni della versione attuale. Da verificare anche se
le richieste di approvazione si possono passare a uno strumento MCP: in quel caso il
`gate` sarebbe `per-tool`. Poi eventualmente Gemini CLI e OpenCode.

- Script finto (come `fixtures/fake-claude.mjs`) per i test dei turni e delle riprese.
- Test e2e con il nuovo agente scelto nel progetto.

## Decisioni per Leo

1. Quale secondo agente (Codex CLI?).
2. Comportamento della fase 3 quando le policy chiedono uno stop che l'agente non sa fare.
