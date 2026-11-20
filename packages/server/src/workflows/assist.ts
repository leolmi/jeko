import {
  builtins,
  CONTEXT_VARS,
  EFFORTS,
  formatIssue,
  HOST_FUNCTIONS,
  parseWorkflow,
  POLICY_ACTIONS,
  WorkflowSchema,
  type Issue,
  type WorkflowProposal,
} from '@jeko/shared';

/** Tentativi di claude: la proposta, poi le correzioni degli errori trovati dalla verifica. */
export const ASSIST_ATTEMPTS = 3;

const GUIDE = `Sei l'assistente di Jeko per i workflow. Un workflow è un file YAML che descrive i passi
con cui Jeko porta avanti una richiesta su un progetto. Modifichi il workflow come chiede l'utente.

Regole del formato (lo schema JSON completo è sotto):
- "kind" è sempre develop (i progetti nuovi si creano dai template, non con un workflow);
- tipi di passo: agent (istruzioni a claude), check (comandi o espressione da verificare),
  gate (approvazione dell'utente), ask (domanda all'utente salvata in una variabile);
- un passo agent può fissare "effort" (${EFFORTS.join(', ')}) per ragionare di più, es. sul piano,
  e "model" (es. opus, sonnet); senza, valgono quelli predefiniti di claude;
- i testi possono contenere {{ espressione }}; nelle espressioni ci sono: ${CONTEXT_VARS.join(', ')},
  gli input e le vars per nome, steps.<id>.ok e steps.<id>.output;
- funzioni: ${[...Object.keys(builtins), ...HOST_FUNCTIONS].join(', ')};
- azioni delle policy: ${POLICY_ACTIONS.join(', ')};
- gli id dei passi sono unici, minuscoli con trattini; onFail.goto punta a un passo esistente;
- "version" resta com'è: il numero lo assegna Jeko al salvataggio.

Rispondi SOLO così, senza altro testo:
SUMMARY: <una frase, in italiano, su cosa hai cambiato>
\`\`\`yaml
<il workflow completo, modificato>
\`\`\``;

export function assistPrompt(yaml: string, request: string, issues: Issue[] = []): string {
  const parts = [
    GUIDE,
    `Schema JSON del workflow:\n${JSON.stringify(WorkflowSchema)}`,
    `Workflow attuale:\n\`\`\`yaml\n${yaml.trim() || '# vuoto: creane uno nuovo'}\n\`\`\``,
    `Richiesta dell'utente:\n${request}`,
  ];
  if (issues.length)
    parts.push(
      `La tua proposta precedente (quella sopra come "workflow attuale") non è valida.\n` +
        `Correggi questi errori mantenendo la modifica richiesta:\n` +
        issues.map((i) => `- ${i.line ? `riga ${i.line}: ` : ''}${formatIssue(i)}`).join('\n'),
    );
  return parts.join('\n\n');
}

/** Riassunto e YAML dalla risposta di claude; null se non c'è un blocco YAML. */
export function parseProposal(text: string): { summary: string; yaml: string } | null {
  const yaml = /```ya?ml\s*\n([\s\S]*?)```/i.exec(text)?.[1];
  if (yaml === undefined) return null;
  // Solo spazi dopo i due punti: un riassunto vuoto non deve prendersi la riga successiva.
  const summary = /^[ \t]*SUMMARY:[ \t]*(.*)$/im.exec(text)?.[1]?.trim() ?? '';
  return { summary, yaml: yaml.replace(/\s+$/, '') + '\n' };
}

/**
 * Chiede la modifica a claude e verifica la proposta; se non è valida gli rimanda gli errori,
 * fino a {@link ASSIST_ATTEMPTS} tentativi. Restituisce l'ultima proposta con gli errori rimasti.
 */
export async function assistWorkflow(
  ask: (prompt: string) => Promise<string | null>,
  yaml: string,
  request: string,
): Promise<WorkflowProposal> {
  let current = yaml;
  let issues: Issue[] = [];
  let summary = '';
  let last: WorkflowProposal | undefined;
  for (let i = 0; i < ASSIST_ATTEMPTS; i++) {
    const text = await ask(assistPrompt(current, request, issues));
    const proposal = text ? parseProposal(text) : null;
    if (!proposal) throw new Error('Risposta di claude senza YAML');
    const check = parseWorkflow(proposal.yaml);
    issues = check.ok ? [] : check.issues;
    summary = proposal.summary || summary;
    last = { yaml: proposal.yaml, summary, issues };
    if (check.ok) return last;
    current = proposal.yaml;
  }
  return last!;
}
