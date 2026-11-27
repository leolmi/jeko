/**
 * Markdown → HTML, fatto in casa e ridotto a quello che scrivono claude e le note: titoli,
 * paragrafi, elenchi (anche annidati), citazioni, blocchi di codice, tabelle, righe, link,
 * grassetto, corsivo, barrato e codice in linea. Tutto il testo viene prima messo al sicuro
 * (niente HTML grezzo), poi Angular lo ripulisce di nuovo con [innerHTML].
 */

const FENCE = /^ {0,3}(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function renderMarkdown(src: string): string {
  return blocks(src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), false);
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const indent = (line: string) => line.length - line.trimStart().length;
const blank = (line: string | undefined) => line === undefined || line.trim() === '';
const isTable = (lines: string[], i: number) =>
  lines[i]!.includes('|') &&
  i + 1 < lines.length &&
  TABLE_SEP.test(lines[i + 1]!) &&
  lines[i + 1]!.includes('-');

/** Una riga che apre un blocco diverso da un paragrafo. */
function opensBlock(lines: string[], i: number): boolean {
  const l = lines[i]!;
  return (
    FENCE.test(l) ||
    HEADING.test(l) ||
    HR.test(l) ||
    QUOTE.test(l) ||
    LIST.test(l) ||
    isTable(lines, i)
  );
}

/** I blocchi di un gruppo di righe; `tight` = paragrafi senza <p> (voci di elenco strette). */
function blocks(lines: string[], tight: boolean): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const n = heading[1]!.length;
      out.push(`<h${n}>${inline(heading[2]!)}</h${n}>`);
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(lines[i++]!.replace(QUOTE, ''));
      out.push(`<blockquote>${blocks(quoted, false)}</blockquote>`);
      continue;
    }
    if (isTable(lines, i)) {
      const [html, next] = table(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    if (LIST.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !opensBlock(lines, i)))
      para.push(lines[i++]!.trim());
    const text = para.map(inline).join('<br>');
    out.push(tight ? text : `<p>${text}</p>`);
  }
  return out.join('');
}

function list(lines: string[], start: number): [string, number] {
  const first = LIST.exec(lines[start])!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: { lines: string[]; pad: number }[] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = LIST.exec(line);
    if (m && m[1]!.length <= base + 1) {
      if (/\d/.test(m[2]!) !== ordered) break;
      items.push({ lines: [m[3]!], pad: m[1]!.length + m[2]!.length + 1 });
      i++;
      continue;
    }
    const item = items.at(-1)!;
    if (blank(line)) {
      const next = lines[i + 1];
      const goesOn =
        !blank(next) && (indent(next!) > base || (LIST.exec(next!)?.[1]!.length ?? -1) === base);
      if (!goesOn) break;
      if (indent(next!) <= base) loose = true;
      item.lines.push('');
      i++;
      continue;
    }
    if (indent(line) > base) {
      item.lines.push(line.slice(Math.min(indent(line), item.pad)));
      i++;
      continue;
    }
    // Riga pigra: continua il testo della voce se non apre un altro blocco.
    if (!blank(lines[i - 1]) && !opensBlock(lines, i)) {
      item.lines.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const n = ordered ? parseInt(first[2]!, 10) : 1;
  const startAttr = ordered && n !== 1 ? ` start="${n}"` : '';
  const body = items
    .map((it) => {
      const tight = !loose && !it.lines.slice(0, -1).some((l) => l === '');
      return `<li>${blocks(it.lines, tight)}</li>`;
    })
    .join('');
  return [`<${tag}${startAttr}>${body}</${tag}>`, i];
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const ALIGN: Record<string, string> = {
  left: '',
  center: ' class="text-center"',
  right: ' class="text-right"',
};

function table(lines: string[], start: number): [string, number] {
  const head = cells(lines[start]!);
  const aligns = cells(lines[start + 1]!).map((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
  );
  const row = (cs: string[], tag: string) =>
    `<tr>${head.map((_, k) => `<${tag}${ALIGN[aligns[k] ?? 'left']}>${inline(cs[k] ?? '')}</${tag}>`).join('')}</tr>`;
  let i = start + 2;
  const rows: string[] = [];
  while (i < lines.length && !blank(lines[i]) && lines[i]!.includes('|'))
    rows.push(row(cells(lines[i++]!), 'td'));
  return [
    `<div class="jk-md-table"><table><thead>${row(head, 'th')}</thead><tbody>${rows.join('')}</tbody></table></div>`,
    i,
  ];
}

/** Indirizzi ammessi nei link: web, posta o relativi (niente javascript: e simili). */
function safeUrl(url: string): string | null {
  return /^(https?:|mailto:|#|\/|\.)/i.test(url) || !/^[a-z][\w+.-]*:/i.test(url) ? url : null;
}

/** Testo in linea: codice, link, grassetto, corsivo, barrato. */
export function inline(src: string): string {
  const keep: string[] = [];
  const hold = (html: string) => `${keep.push(html) - 1}`;
  let s = src
    // Codice in linea: resta com'è, al riparo dal resto.
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code: string) =>
      hold(`<code>${escape(code.trim() || code)}</code>`),
    )
    // Caratteri protetti con la barra rovesciata.
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, c: string) => hold(escape(c)));
  s = s.replace(
    /\[([^\]]+)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    (all, text: string, url: string) => {
      const href = safeUrl(url);
      return href
        ? hold(
            `<a href="${escape(href)}" target="_blank" rel="noopener">${emphasis(escape(text))}</a>`,
          )
        : all;
    },
  );
  s = s.replace(
    /<(https?:\/\/[^\s>]+)>|\bhttps?:\/\/[^\s<]*[^\s<.,;:!?)\]'"]/g,
    (all, angled?: string) => {
      const url = angled ?? all;
      return hold(`<a href="${escape(url)}" target="_blank" rel="noopener">${escape(url)}</a>`);
    },
  );
  s = emphasis(escape(s));
  return s.replace(/(\d+)/g, (_, k: string) => keep[Number(k)]!);
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}
