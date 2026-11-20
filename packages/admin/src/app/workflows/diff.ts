export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
  /** Numero di riga nel testo vecchio (same/del) o nuovo (add). */
  line: number;
}

/** Differenze riga per riga (LCS): basta per workflow di qualche centinaio di righe. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = lunghezza della sottosequenza comune più lunga di a[i..] e b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]!, line: i + 1 });
      i++;
      j++;
    } else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // A parità prima le righe tolte, poi quelle aggiunte.
      out.push({ kind: 'del', text: a[i]!, line: i + 1 });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j]!, line: j + 1 });
      j++;
    }
  }
  return out;
}
