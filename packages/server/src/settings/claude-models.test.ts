import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsFile } from '../data/files.js';
import { ClaudeModelStore } from './claude-models.js';

describe('modelli predefiniti di claude', () => {
  it('li tiene per cartella e ricorda l’ultimo, anche dopo un riavvio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-models-'));
    const store = new ClaudeModelStore(new SettingsFile(dir));
    expect(store.get()).toEqual({ byFolder: {}, last: null });
    expect(store.record('C:\\dev\\p', 'claude-opus-5-5')).toBe(true);
    expect(store.record('c:/dev/p/', 'claude-opus-5-5')).toBe(false);
    expect(store.record(null, 'claude-sonnet-5-5')).toBe(true);
    const again = new ClaudeModelStore(new SettingsFile(dir)).get();
    expect(again.last).toBe('claude-sonnet-5-5');
    expect(Object.values(again.byFolder)).toEqual(['claude-opus-5-5']);
  });
});
