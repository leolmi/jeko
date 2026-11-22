import { isMap, parseDocument, type Pair, type Scalar } from 'yaml';
import {
  POLICY_ACTIONS,
  RUN_MODES,
  type Policy,
  type PolicyAction,
  type RunMode,
} from './schema.js';

/** Per ogni azione sensibile, le modalità in cui ferma la run. */
export type PolicyMatrix = Record<PolicyAction, RunMode[]>;

const STOPPING: RunMode[] = ['checkpoint', 'interactive'];

/** Modalità in cui un gate ferma la run. */
export function gateModes(gate: Policy['gate']): RunMode[] {
  if (gate === 'always') return [...RUN_MODES];
  if (gate === 'interactive') return [...STOPPING];
  return RUN_MODES.filter((m) => gate.includes(m));
}

/** Le policy di un workflow come matrice azione → modalità (una policy in più somma modalità). */
export function policyMatrix(policies: Policy[] = []): PolicyMatrix {
  const sets = Object.fromEntries(POLICY_ACTIONS.map((a) => [a, new Set<RunMode>()])) as Record<
    PolicyAction,
    Set<RunMode>
  >;
  for (const p of policies) {
    const modes = gateModes(p.gate);
    for (const a of Array.isArray(p.match) ? p.match : [p.match])
      for (const m of modes) sets[a].add(m);
  }
  return Object.fromEntries(
    POLICY_ACTIONS.map((a) => [a, RUN_MODES.filter((m) => sets[a].has(m))]),
  ) as PolicyMatrix;
}

/** La forma più breve del gate per queste modalità. */
function gateOf(modes: RunMode[]): Policy['gate'] {
  if (modes.length === RUN_MODES.length) return 'always';
  if (modes.length === STOPPING.length && STOPPING.every((m) => modes.includes(m)))
    return 'interactive';
  return RUN_MODES.filter((m) => modes.includes(m));
}

/** Dalla matrice alle policy: le azioni con le stesse modalità finiscono nella stessa policy. */
export function matrixPolicies(matrix: Partial<PolicyMatrix>): Policy[] {
  const groups = new Map<string, { modes: RunMode[]; actions: PolicyAction[] }>();
  for (const a of POLICY_ACTIONS) {
    const modes = RUN_MODES.filter((m) => matrix[a]?.includes(m));
    if (!modes.length) continue;
    const key = modes.join(',');
    const g = groups.get(key) ?? { modes, actions: [] };
    g.actions.push(a);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ modes, actions }) => ({
    match: actions.length === 1 ? actions[0]! : actions,
    gate: gateOf(modes),
  }));
}

/** Chiavi dopo cui stanno le policy, se il testo non le ha ancora. */
const BEFORE_POLICIES = ['name', 'kind', 'version', 'description', 'inputs', 'vars'];

/**
 * Sostituisce le policy nello YAML di un workflow lasciando il resto com'è (commenti compresi).
 * Senza policy la chiave sparisce.
 */
export function setPolicies(yaml: string, policies: Policy[]): string {
  const doc = parseDocument(yaml);
  if (!isMap(doc.contents)) return yaml;
  if (!policies.length) {
    doc.delete('policies');
    return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  }
  const node = doc.createNode(policies);
  // Gli elenchi brevi in riga: `match: [git.commit, git.push]`.
  for (const item of node.items)
    for (const pair of (item as { items: Pair<Scalar, { flow?: boolean }>[] }).items)
      if (Array.isArray((pair.value as { items?: unknown }).items)) pair.value!.flow = true;
  const map = doc.contents;
  if (doc.has('policies')) {
    doc.set('policies', node);
  } else {
    const keys = map.items.map((p) => String((p.key as Scalar | null)?.value ?? p.key));
    const at = keys.reduce((n, k, i) => (BEFORE_POLICIES.includes(k) ? i + 1 : n), 0);
    (map.items as Pair[]).splice(at, 0, doc.createPair('policies', node));
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
