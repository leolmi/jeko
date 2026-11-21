import { describe, expect, it } from 'vitest';
import { linkPair } from './link.js';

describe('collegamento in memoria', () => {
  it('si apre, consegna in ordine e si chiude dai due lati', async () => {
    const [a, b] = linkPair();
    const got: string[] = [];
    b.on('message', (d) => got.push(d));
    await new Promise<void>((r) => b.on('open', r));
    expect(a.readyState).toBe(a.OPEN);
    a.send('1');
    a.send('2');
    await new Promise((r) => setTimeout(r));
    expect(got).toEqual(['1', '2']);

    const closed = new Promise<void>((r) => a.on('close', r));
    b.close();
    await closed;
    a.send('3');
    await new Promise((r) => setTimeout(r));
    expect(got).toEqual(['1', '2']);
  });
});
