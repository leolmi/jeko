import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeToolCall } from '../agents/claude/cli.js';
import { classifyCommand, classifyTool, gateStops, localPackage, policyStops } from './policy.js';

describe('policy', () => {
  it.each([
    ['npm install', ['install']],
    ['npm i -D vitest', ['install']],
    ['npm test', []],
    ['npm run build', []],
    ['pnpm add zod', ['install']],
    ['pip install requests', ['install']],
    ['winget install Git.Git', ['install']],
    ['git status', []],
    ['git commit -m "x"', ['git.commit']],
    ['git -C repo commit', ['git.commit']],
    ['git add . && git commit -m x && git push', ['git.commit', 'git.push']],
    ['git branch --list', []],
    ['git branch feature/x', ['git.branch']],
    ['git checkout -b feat', ['git.branch']],
    ['git switch main', []],
    ['rm -rf dist', ['fs.delete']],
    ['Remove-Item -Recurse x', ['fs.delete']],
    ['git reset --hard HEAD', ['fs.delete']],
    ['curl https://x', ['network']],
    ['echo "npm install"', []],
  ])('%s', (cmd, actions) => {
    expect(classifyCommand(cmd).sort()).toEqual([...actions].sort());
  });

  it('classifica gli strumenti di claude', () => {
    const classify = (tool: string, input: unknown) => classifyTool(claudeToolCall(tool, input));
    expect(classify('Bash', { command: 'npm ci' })).toEqual({
      actions: ['install'],
      command: 'npm ci',
    });
    expect(classify('WebFetch', { url: 'https://x' }).actions).toEqual(['network']);
    expect(classify('Edit', { file_path: 'a' }).actions).toEqual([]);
  });

  it.each([
    ['npx eslint .', []],
    ['npx prettier --check src', []],
    ['npx.cmd tsc -p .', []],
    ['npm exec -w @jeko/shared -- tsc', []],
    ['npx --no-install foo', []],
    ['npx create-vite app', ['install']],
    ['npx -y cowsay hi', ['install']],
    ['npx eslint@9 .', ['install']],
    ['npx -p typescript tsc', ['install']],
    ['npx github:user/repo', ['install']],
    ['pnpx eslint', ['install']],
    ['pnpm dlx eslint', ['install']],
  ])('npx guarda i pacchetti installati: %s', (cmd, actions) => {
    const local = (spec: string) => ['eslint', 'prettier', 'tsc'].includes(spec);
    expect(classifyCommand(cmd, local)).toEqual(actions);
  });

  it("senza verifica, npx è un'installazione", () => {
    expect(classifyCommand('npx eslint .')).toEqual(['install']);
  });

  it('cerca i pacchetti nelle cartelle superiori', () => {
    const root = mkdtempSync(join(tmpdir(), 'jeko-policy-'));
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '.bin', 'eslint.cmd'), '');
    mkdirSync(join(root, 'node_modules', '@scope', 'tool'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '@scope', 'tool', 'package.json'), '{}');
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
    const local = localPackage(join(root, 'packages', 'app'));
    expect(local('eslint')).toBe(true);
    expect(local('@scope/tool')).toBe(true);
    expect(local('prettier')).toBe(false);
  });

  it('ferma le azioni nelle modalità scelte', () => {
    const policies = [
      { match: 'install' as const, gate: 'interactive' as const },
      { match: ['install' as const, 'git.push' as const], gate: ['headless' as const] },
    ];
    expect(policyStops(['install'], policies, 'headless')).toBe(true);
    expect(policyStops(['git.push'], policies, 'checkpoint')).toBe(false);
    expect(policyStops(['git.commit'], policies, 'interactive')).toBe(false);
    expect(policyStops(['install'], [{ match: 'install', gate: 'always' }], 'headless')).toBe(true);
    expect(gateStops('interactive', 'headless')).toBe(false);
    expect(gateStops('interactive', 'checkpoint')).toBe(true);
    expect(gateStops('always', 'headless')).toBe(true);
  });
});
