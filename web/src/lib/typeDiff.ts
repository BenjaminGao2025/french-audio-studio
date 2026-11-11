export interface DiffColumn { typed: string; correct: string; match: boolean }

/** Align Unicode characters with a minimum-edit path. No case or accent folding. */
export function typeDiff(typed: string, correct: string): DiffColumn[] {
  const a = Array.from(typed.normalize("NFC"));
  const b = Array.from(correct.normalize("NFC"));
  const costs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) costs[i][0] = i;
  for (let j = 0; j <= b.length; j++) costs[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    costs[i][j] = Math.min(costs[i - 1][j] + 1, costs[i][j - 1] + 1, costs[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const columns: DiffColumn[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && costs[i][j] === costs[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      columns.push({ typed: a[--i], correct: b[--j], match: a[i] === b[j] });
    } else if (i && costs[i][j] === costs[i - 1][j] + 1) {
      columns.push({ typed: a[--i], correct: "", match: false });
    } else columns.push({ typed: "", correct: b[--j], match: false });
  }
  return columns.reverse();
}
