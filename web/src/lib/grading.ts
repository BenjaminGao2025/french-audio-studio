/**
 * Dictation / Recall grading (prototype rules).
 * - NFC, case, repeated spaces and curly/straight apostrophes are normalized.
 * - Ordinary punctuation is ignored; hyphen and space are equivalent (rendez-vous = rendez vous).
 * - Word-internal apostrophes are kept (j’ai = j'ai, but jai is a different word).
 * - Accents are strict (été ≠ ete), except œ/oe which is tolerated for grading only.
 * These equivalences are never used for dictionary lookup keys (see lookup.ts).
 */

export type MarkKind = "ok" | "missing" | "different" | "accent" | "extra";

export interface DisplayWord {
  text: string;
  mark: MarkKind;
  /** For different/accent marks: the counterpart word in the other sentence. */
  counterpart?: string;
}

export interface GradeResult {
  correct: boolean;
  answer: DisplayWord[];
  target: DisplayWord[];
  issues: { kind: Exclude<MarkKind, "ok">; expected?: string; given?: string }[];
}

const APOS = /[\u2019\u2018\u02BC\u0060\u00B4]/g;

interface KeyToken {
  key: string;
  bare: string; // accent-stripped, used only to classify accent-only differences
  word: number; // index of the display word it came from
}

function baseNormalize(s: string): string {
  return s.normalize("NFC").replace(APOS, "'").toLocaleLowerCase("fr");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

export function tokenize(sentence: string): { words: string[]; keys: KeyToken[] } {
  const words = sentence.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const keys: KeyToken[] = [];
  words.forEach((w, wi) => {
    const parts = baseNormalize(w)
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .split("-");
    for (const p of parts) {
      // Drop punctuation, then trim apostrophes that are not word-internal.
      const cleaned = p.replace(/[^\p{L}\p{N}']/gu, "").replace(/^'+|'+$/g, "");
      if (cleaned) keys.push({ key: cleaned, bare: stripAccents(cleaned), word: wi });
    }
  });
  return { words, keys };
}

type Op =
  | { t: "match"; a: number; b: number }
  | { t: "accent"; a: number; b: number }
  | { t: "sub"; a: number; b: number }
  | { t: "del"; b: number } // target token missing from answer
  | { t: "ins"; a: number }; // extra answer token

function align(a: KeyToken[], b: KeyToken[]): Op[] {
  const n = a.length;
  const m = b.length;
  const cost = (i: number, j: number) => (a[i].key === b[j].key ? 0 : a[i].bare === b[j].bare ? 0.4 : 1);
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost(i - 1, j - 1));
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(i - 1, j - 1)) {
      const c = cost(i - 1, j - 1);
      ops.push({ t: c === 0 ? "match" : c < 1 ? "accent" : "sub", a: i - 1, b: j - 1 });
      i--;
      j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ t: "del", b: j - 1 });
      j--;
    } else {
      ops.push({ t: "ins", a: i - 1 });
      i--;
    }
  }
  return ops.reverse();
}

const SEVERITY: Record<MarkKind, number> = { ok: 0, accent: 1, extra: 2, missing: 2, different: 3 };

export function grade(target: string, answer: string): GradeResult {
  const A = tokenize(answer);
  const T = tokenize(target);
  const ops = align(A.keys, T.keys);
  const aMarks: DisplayWord[] = A.words.map((text) => ({ text, mark: "ok" }));
  const tMarks: DisplayWord[] = T.words.map((text) => ({ text, mark: "ok" }));
  const bump = (arr: DisplayWord[], idx: number, mark: MarkKind, counterpart?: string) => {
    if (SEVERITY[mark] > SEVERITY[arr[idx].mark]) arr[idx] = { ...arr[idx], mark, counterpart };
  };
  for (const op of ops) {
    if (op.t === "match") continue;
    if (op.t === "accent" || op.t === "sub") {
      const kind = op.t === "accent" ? "accent" : "different";
      bump(aMarks, A.keys[op.a].word, kind, T.words[T.keys[op.b].word]);
      bump(tMarks, T.keys[op.b].word, kind, A.words[A.keys[op.a].word]);
    } else if (op.t === "del") {
      bump(tMarks, T.keys[op.b].word, "missing");
    } else {
      bump(aMarks, A.keys[op.a].word, "extra");
    }
  }
  // Learner-facing issues are listed once per display word (a hyphenated word is one word).
  const issues: GradeResult["issues"] = [];
  for (const w of tMarks) {
    if (w.mark === "missing") issues.push({ kind: "missing", expected: stripPunct(w.text) });
    else if (w.mark === "different" || w.mark === "accent")
      issues.push({ kind: w.mark, expected: stripPunct(w.text), given: stripPunct(w.counterpart ?? "") });
  }
  for (const w of aMarks) if (w.mark === "extra") issues.push({ kind: "extra", given: stripPunct(w.text) });
  return { correct: issues.length === 0 && A.keys.length > 0, answer: aMarks, target: tMarks, issues };
}

function stripPunct(w: string) {
  return w.replace(/^[^\p{L}\p{N}]+|[.,;:!?…»«"]+$/gu, "");
}
