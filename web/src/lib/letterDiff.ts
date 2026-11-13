/** One run of letters: `diff` is true where this word differs from the other one. */
export interface LetterRun {
  text: string;
  diff: boolean;
}

/**
 * Letter-level difference between a typed word and the expected word, by longest common subsequence.
 * Letters outside the common subsequence are marked, so "activities" vs "activités" marks only "ie" and "é".
 */
export function letterDiff(given: string, expected: string): { given: LetterRun[]; expected: LetterRun[] } {
  const a = Array.from(given);
  const b = Array.from(expected);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) { keepA[i] = keepB[j] = true; i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return { given: runs(a, keepA), expected: runs(b, keepB) };
}

function runs(chars: string[], keep: boolean[]): LetterRun[] {
  const out: LetterRun[] = [];
  chars.forEach((ch, i) => {
    const diff = !keep[i];
    const last = out.at(-1);
    if (last && last.diff === diff) last.text += ch;
    else out.push({ text: ch, diff });
  });
  return out;
}
