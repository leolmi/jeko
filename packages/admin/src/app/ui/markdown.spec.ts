import { inline, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('titoli, paragrafi e a capo', () => {
    expect(renderMarkdown('# Titolo\n\nriga uno\nriga due')).toBe(
      '<h1>Titolo</h1><p>riga uno<br>riga due</p>',
    );
  });

  it('niente HTML grezzo', () => {
    expect(renderMarkdown('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('blocco di codice con il testo così com’è', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2;\n**no**\n```')).toBe(
      '<pre><code>const a = 1 &lt; 2;\n**no**</code></pre>',
    );
  });

  it('elenchi annidati e numerati', () => {
    expect(renderMarkdown('- a\n  - b\n- c')).toBe(
      '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>',
    );
    expect(renderMarkdown('3. x\n4. y')).toBe('<ol start="3"><li>x</li><li>y</li></ol>');
  });

  it('testo dopo un elenco', () => {
    expect(renderMarkdown('- a\n\nfine')).toBe('<ul><li>a</li></ul><p>fine</p>');
  });

  it('tabella con allineamento', () => {
    const html = renderMarkdown('| a | b |\n|---|--:|\n| 1 | 2 |');
    expect(html).toContain('<th>a</th><th class="text-right">b</th>');
    expect(html).toContain('<td>1</td><td class="text-right">2</td>');
  });

  it('citazione e riga', () => {
    expect(renderMarkdown('> nota\n\n---')).toBe('<blockquote><p>nota</p></blockquote><hr>');
  });
});

describe('inline', () => {
  it('grassetto, corsivo, codice e barrato', () => {
    expect(inline('**a** *b* `c*d*` ~~e~~')).toBe(
      '<strong>a</strong> <em>b</em> <code>c*d*</code> <del>e</del>',
    );
  });

  it('i trattini bassi dentro le parole restano', () => {
    expect(inline('nome_file_lungo')).toBe('nome_file_lungo');
  });

  it('link sicuri, javascript: no', () => {
    expect(inline('[sito](https://x.it)')).toBe(
      '<a href="https://x.it" target="_blank" rel="noopener">sito</a>',
    );
    expect(inline('[x](javascript:alert(1))')).not.toContain('<a');
    expect(inline('vedi https://x.it/a.')).toBe(
      'vedi <a href="https://x.it/a" target="_blank" rel="noopener">https://x.it/a</a>.',
    );
  });
});
