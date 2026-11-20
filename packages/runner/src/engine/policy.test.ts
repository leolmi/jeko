import { describe, expect, it } from 'vitest';
import { classifyCommand, classifyTool, gateLevel, gateStops } from './policy.js';

describe('policy', () => {
  it.each([
    ['npm install', ['install']],
    ['npm i -D vitest', ['install']],
    ['npm test', []],
    ['npm run build', []],
    ['npx create-vite app', ['install']],
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
    expect(classifyTool('Bash', { command: 'npm ci' })).toEqual({
      actions: ['install'],
      command: 'npm ci',
    });
    expect(classifyTool('WebFetch', { url: 'https://x' }).actions).toEqual(['network']);
    expect(classifyTool('Edit', { file_path: 'a' }).actions).toEqual([]);
  });

  it('sceglie il gate più stringente', () => {
    const policies = [
      { match: 'install' as const, gate: 'interactive' as const },
      { match: ['install' as const, 'git.push' as const], gate: 'always' as const },
    ];
    expect(gateLevel(['install'], policies)).toBe('always');
    expect(gateLevel(['git.commit'], policies)).toBeNull();
    expect(gateStops('interactive', 'headless')).toBe(false);
    expect(gateStops('interactive', 'checkpoint')).toBe(true);
    expect(gateStops('always', 'headless')).toBe(true);
  });
});
