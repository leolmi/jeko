import type { GateLevel, Policy, PolicyAction, RunMode } from '@jeko/shared';

interface Rule {
  action: PolicyAction;
  test: RegExp;
}

// Ogni regola guarda un singolo comando (le catene `a && b; c | d` vengono divise prima).
const RULES: Rule[] = [
  {
    action: 'install',
    test: /^(npm|pnpm|yarn|bun)(\.cmd)?\s+(install|i|add|ci|update|up|upgrade)(\s|$)/,
  },
  { action: 'install', test: /^(npm|pnpm|yarn|bun)(\.cmd)?\s+.*(\s-g|\s--global)(\s|$)/ },
  { action: 'install', test: /^(npx|pnpx|bunx)(\.cmd)?\s/ },
  { action: 'install', test: /^(npm|pnpm|yarn|bun)(\.cmd)?\s+(create|init)\s+\S/ },
  { action: 'install', test: /^(pip3?|pipx|uv\s+pip|poetry)\s+(install|add)(\s|$)/ },
  {
    action: 'install',
    test: /^(winget|choco|scoop|brew|apt(-get)?|dnf|nvm)\s+(install|add)(\s|$)/,
  },
  {
    action: 'install',
    test: /^(dotnet\s+(add|tool\s+install)|cargo\s+(install|add)|go\s+install)(\s|$)/,
  },
  { action: 'git.commit', test: /^git\s+(.*\s)?commit(\s|$)/ },
  { action: 'git.push', test: /^git\s+(.*\s)?push(\s|$)/ },
  {
    action: 'git.branch',
    test: /^git\s+(.*\s)?(branch\s+(?!--?(list|l|a|r|v|vv|show-current)\b)\S|checkout\s+-[bB]\s|switch\s+-[cC]\s)/,
  },
  { action: 'fs.delete', test: /^(rm|rmdir|del|erase|rd)\s/ },
  { action: 'fs.delete', test: /^remove-item\s/i },
  { action: 'fs.delete', test: /^git\s+(.*\s)?(clean\s+-\S*f|reset\s+--hard)/ },
  { action: 'network', test: /^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)\s/i },
];

/** Divide una riga di shell nei singoli comandi (approssimato, senza eseguire nulla). */
function splitCommands(line: string): string[] {
  return line
    .split(/&&|\|\||[;|\n]/)
    .map((c) => c.trim().replace(/^(sudo|env\s+\S+=\S+)\s+/, ''))
    .filter(Boolean);
}

/** Azioni sensibili contenute in una riga di comando. */
export function classifyCommand(line: string): PolicyAction[] {
  const found = new Set<PolicyAction>();
  for (const cmd of splitCommands(line)) {
    for (const rule of RULES) if (rule.test.test(cmd)) found.add(rule.action);
  }
  return [...found];
}

/** Azioni sensibili di una chiamata a uno strumento di claude. */
export function classifyTool(
  tool: string,
  input: unknown,
): { actions: PolicyAction[]; command: string } {
  const field = (k: string) =>
    input && typeof input === 'object' && typeof (input as Record<string, unknown>)[k] === 'string'
      ? ((input as Record<string, unknown>)[k] as string)
      : '';
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = field('command');
    return { actions: classifyCommand(command), command };
  }
  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return { actions: ['network'], command: `${tool} ${field('url') || field('query')}`.trim() };
  }
  return { actions: [], command: tool };
}

/** Livello di gate più stringente tra le policy che colpiscono queste azioni. */
export function gateLevel(actions: PolicyAction[], policies: Policy[] = []): GateLevel | null {
  let level: GateLevel | null = null;
  for (const p of policies) {
    const match = Array.isArray(p.match) ? p.match : [p.match];
    if (!actions.some((a) => match.includes(a))) continue;
    if (p.gate === 'always') return 'always';
    level = 'interactive';
  }
  return level;
}

/** Un gate di questo livello ferma la run in questa modalità? */
export function gateStops(level: GateLevel, mode: RunMode): boolean {
  return level === 'always' || mode !== 'headless';
}
