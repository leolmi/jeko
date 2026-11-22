import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  policyMatrix,
  type GateLevel,
  type Policy,
  type PolicyAction,
  type RunMode,
} from '@jeko/shared';
import { START_PROCESS_TOOL } from '../permissions/protocol.js';

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
  // pnpm dlx scarica sempre; npx e bunx solo se il pacchetto non c'è (vedi `runnerInstalls`).
  { action: 'install', test: /^(pnpx(\.cmd)?|(pnpm|yarn)(\.cmd)?\s+dlx)\s/ },
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

/** Il pacchetto (o il suo comando) è installato nella cartella o in una superiore? */
export type LocalCheck = (spec: string) => boolean;

/** Cerca `node_modules/.bin/<spec>` o `node_modules/<spec>` da `dir` in su. */
export function localPackage(dir: string): LocalCheck {
  return (spec) => {
    for (let d = dir; ; d = dirname(d)) {
      const nm = join(d, 'node_modules');
      if (['', '.cmd'].some((ext) => existsSync(join(nm, '.bin', spec + ext)))) return true;
      if (existsSync(join(nm, spec, 'package.json'))) return true;
      if (dirname(d) === d) return false;
    }
  };
}

const RUNNER = /^(npx|bunx)(\.cmd)?\s+(.*)$|^npm(\.cmd)?\s+exec\s+(.*)$/;

/**
 * `npx`/`bunx`/`npm exec` installano solo se il pacchetto non c'è già: un comando del progetto
 * (eslint, prettier, tsc…) non è un'installazione. Senza modo di verificarlo, si considera tale.
 */
function runnerInstalls(cmd: string, local?: LocalCheck): boolean | null {
  const m = RUNNER.exec(cmd);
  if (!m) return null;
  const tokens = (m[3] ?? m[5] ?? '').split(/\s+/).filter(Boolean);
  let spec: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--') {
      spec = tokens[i + 1];
      break;
    }
    if (t === '--no-install' || t === '--no') return false;
    if (/^(-p|--package|-c|--call)(=|$)/.test(t)) return true;
    if (t === '-w' || t === '--workspace') i++; // il valore non è il pacchetto
    if (t.startsWith('-')) continue;
    spec = t;
    break;
  }
  if (!spec) return false;
  spec = spec.replace(/^["']|["']$/g, '');
  // Versione (`pkg@1`), percorso o URL: va scaricato.
  if (spec.lastIndexOf('@') > 0 || /[:\\]/.test(spec)) return true;
  if (spec.includes('/') && !/^@[^/]+\/[^/]+$/.test(spec)) return true;
  return !local?.(spec);
}

/** Azioni sensibili contenute in una riga di comando. */
export function classifyCommand(line: string, local?: LocalCheck): PolicyAction[] {
  const found = new Set<PolicyAction>();
  for (const cmd of splitCommands(line)) {
    for (const rule of RULES) if (rule.test.test(cmd)) found.add(rule.action);
    if (runnerInstalls(cmd, local)) found.add('install');
  }
  return [...found];
}

/** Azioni sensibili di una chiamata a uno strumento di claude. */
export function classifyTool(
  tool: string,
  input: unknown,
  local?: LocalCheck,
): { actions: PolicyAction[]; command: string } {
  const field = (k: string) =>
    input && typeof input === 'object' && typeof (input as Record<string, unknown>)[k] === 'string'
      ? ((input as Record<string, unknown>)[k] as string)
      : '';
  if (tool === 'Bash' || tool === 'PowerShell' || tool === START_PROCESS_TOOL) {
    const command = field('command');
    return { actions: classifyCommand(command, local), command };
  }
  if (tool === 'WebFetch' || tool === 'WebSearch') {
    return { actions: ['network'], command: `${tool} ${field('url') || field('query')}`.trim() };
  }
  return { actions: [], command: tool };
}

/** Le policy fermano queste azioni in questa modalità? */
export function policyStops(
  actions: PolicyAction[],
  policies: Policy[] = [],
  mode: RunMode,
): boolean {
  const matrix = policyMatrix(policies);
  return actions.some((a) => matrix[a].includes(mode));
}

/** Un passo gate di questo livello ferma la run in questa modalità? */
export function gateStops(level: GateLevel, mode: RunMode): boolean {
  return level === 'always' || mode !== 'headless';
}
