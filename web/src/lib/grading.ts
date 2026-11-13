/**
 * Dictation / Recall grading: a port of dictation.py (the server grader, which decides right or wrong).
 * tests/fixtures/dictation_cases.json pins both; grading.parity.test.ts runs every case here.
 * - NFC, case, spacing and typographic apostrophes (’ ‘ ʼ ` ´ ′) are normalized.
 * - Any character that is not a letter, mark, number or apostrophe splits words, so punctuation is never
 *   a word and a glued comma (nationale,ont) reads as two words. Hyphen and space are equivalent.
 * - Elisions split into their own word (l'homme = l' + homme); a space after the apostrophe is fine.
 * - A word that only misses an accent or an apostrophe (ete, jai) is an "accent" slip worth half credit.
 * - œ/oe and æ/ae are equivalent for grading only.
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
  alignment: { mark: MarkKind; given?: string; expected?: string }[];
  counts: Record<MarkKind, number>;
  accuracy: number;
  answer: DisplayWord[];
  target: DisplayWord[];
  issues: { kind: Exclude<MarkKind, "ok">; expected?: string; given?: string }[];
}

const APOSTROPHES = new Set(["’", "‘", "ʼ", "`", "´", "′", "'"]);
const ELISION_PREFIXES = new Set(["l", "d", "j", "m", "t", "s", "n", "c", "ç", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu"]);
const ACCENT_CREDIT = 0.5;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

interface KeyToken {
  text: string; // surface as typed
  key: string; // comparison form (dictation.py "norm")
  word: number; // index of the whitespace-separated display word it came from
}

function norm(surface: string): string {
  const text = Array.from(surface.normalize("NFC").toLowerCase())
    .map((ch) => (APOSTROPHES.has(ch) ? "'" : ch))
    .join("");
  return text.replace(/œ/g, "oe").replace(/æ/g, "ae");
}
const stripApostrophes = (s: string) => s.replace(/'/g, "");
const fold = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
const isWordChar = (ch: string) => APOSTROPHES.has(ch) || WORD_CHAR.test(ch);

function trimApostrophes(chars: string[]): string[] {
  let a = 0;
  let b = chars.length;
  while (a < b && APOSTROPHES.has(chars[a])) a++;
  while (b > a && APOSTROPHES.has(chars[b - 1])) b--;
  return chars.slice(a, b);
}

function splitElision(surface: string): string[] {
  const parts: string[] = [];
  // A quote mark typed as an apostrophe before a word ('J'ai faim') is punctuation, never part of the word.
  let rest = Array.from(surface);
  while (rest.length && APOSTROPHES.has(rest[0])) rest = rest.slice(1);
  for (;;) {
    const cut = rest.findIndex((ch) => APOSTROPHES.has(ch));
    if (cut <= 0 || !ELISION_PREFIXES.has(norm(rest.slice(0, cut).join("")))) break;
    parts.push(rest.slice(0, cut + 1).join(""));
    let next = cut + 1;
    while (next < rest.length && APOSTROPHES.has(rest[next])) next++;
    rest = rest.slice(next);
    if (!rest.length) return parts;
  }
  // "l'" typed before a space is a whole elided word; other leading/trailing quotes are punctuation.
  if (rest.length > 1 && APOSTROPHES.has(rest[rest.length - 1]) && ELISION_PREFIXES.has(norm(rest.slice(0, -1).join("")))) {
    parts.push(rest.join(""));
    return parts;
  }
  rest = trimApostrophes(rest);
  if (rest.length) parts.push(rest.join(""));
  return parts;
}

/** Display words (split on whitespace) and the grading tokens inside them, in order. */
export function tokenize(sentence: string): { words: string[]; keys: KeyToken[] } {
  const words = sentence.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const keys: KeyToken[] = [];
  words.forEach((w, wi) => {
    let run: string[] = [];
    for (const ch of Array.from(w + " ")) {
      if (isWordChar(ch)) {
        run.push(ch);
        continue;
      }
      if (run.length) for (const part of splitElision(run.join(""))) keys.push({ text: part, key: norm(part), word: wi });
      run = [];
    }
  });
  return { words, keys };
}

type Kind = "ok" | "accent" | "wrong";

function compareWords(actual: string, expected: string): Kind {
  if (actual === expected) return "ok";
  if (fold(stripApostrophes(actual)) === fold(stripApostrophes(expected))) return "accent";
  return "wrong";
}

/** 'jai' typed for "j'ai": split it at the elision, so it reads as a missing apostrophe, not a wrong word. */
function splitMerged(actual: KeyToken[], expected: KeyToken[]): KeyToken[] {
  const merged = new Map<string, number>();
  for (let i = 0; i + 1 < expected.length; i++) {
    if (!expected[i].key.endsWith("'")) continue;
    const head = fold(stripApostrophes(expected[i].key));
    const k = head + fold(stripApostrophes(expected[i + 1].key));
    if (!merged.has(k)) merged.set(k, Array.from(head).length);
  }
  const known = new Set(expected.map((t) => t.key));
  const out: KeyToken[] = [];
  for (const token of actual) {
    const n = token.key;
    const cut = !n.includes("'") && !known.has(n) ? merged.get(fold(n)) : undefined;
    if (!cut) {
      out.push(token);
      continue;
    }
    const normChars = Array.from(n);
    const textChars = Array.from(token.text);
    const surface = textChars.length === normChars.length ? textChars : normChars;
    out.push({ text: surface.slice(0, cut).join(""), key: normChars.slice(0, cut).join(""), word: token.word });
    out.push({ text: surface.slice(cut).join(""), key: normChars.slice(cut).join(""), word: token.word });
  }
  return out;
}

const COST: Record<Kind, number> = { ok: 0, accent: ACCENT_CREDIT, wrong: 1 };

type Op =
  | { kind: Kind; e: number; a: number }
  | { kind: "missing"; e: number }
  | { kind: "extra"; a: number };

/** The same dynamic programme and tie order as dictation._align (expected-major). */
function align(expected: KeyToken[], actual: KeyToken[]): Op[] {
  const n = expected.length;
  const m = actual.length;
  const kinds = expected.map((e) => actual.map((a) => compareWords(a.key, e.key)));
  const dist = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dist[i][j] = Math.min(dist[i - 1][j - 1] + COST[kinds[i - 1][j - 1]], dist[i - 1][j] + 1, dist[i][j - 1] + 1);
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i || j) {
    if (i && j && dist[i][j] === dist[i - 1][j - 1] + COST[kinds[i - 1][j - 1]]) {
      ops.push({ kind: kinds[i - 1][j - 1], e: i - 1, a: j - 1 });
      i--;
      j--;
    } else if (i && dist[i][j] === dist[i - 1][j] + 1) {
      ops.push({ kind: "missing", e: i - 1 });
      i--;
    } else {
      ops.push({ kind: "extra", a: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

const SEVERITY: Record<MarkKind, number> = { ok: 0, accent: 1, extra: 2, missing: 2, different: 3 };

export function grade(target: string, answer: string): GradeResult {
  const A = tokenize(answer);
  const T = tokenize(target);
  const got = splitMerged(A.keys, T.keys);
  const ops = align(T.keys, got);
  const aMarks: DisplayWord[] = A.words.map((text) => ({ text, mark: "ok" }));
  const tMarks: DisplayWord[] = T.words.map((text) => ({ text, mark: "ok" }));
  const bump = (arr: DisplayWord[], idx: number, mark: MarkKind, counterpart?: string) => {
    if (SEVERITY[mark] > SEVERITY[arr[idx].mark]) arr[idx] = { ...arr[idx], mark, counterpart };
  };
  const counts: GradeResult["counts"] = { ok: 0, accent: 0, different: 0, missing: 0, extra: 0 };
  const alignment: GradeResult["alignment"] = ops.map((op) => {
    const mark: MarkKind = op.kind === "wrong" ? "different" : op.kind;
    counts[mark]++;
    const given = "a" in op ? got[op.a] : undefined;
    const expected = "e" in op ? T.keys[op.e] : undefined;
    if (given && expected) {
      bump(aMarks, given.word, mark, T.words[expected.word]);
      bump(tMarks, expected.word, mark, A.words[given.word]);
    } else if (expected) bump(tMarks, expected.word, "missing");
    else if (given) bump(aMarks, given.word, "extra");
    return { mark, given: given?.text, expected: expected?.text };
  });
  const total = T.keys.length + counts.extra;
  const score = total ? (counts.ok + ACCENT_CREDIT * counts.accent) / total : 1;
  const accuracy = Math.floor(score * 100 + 0.5);
  // Learner-facing issues are listed once per display word (a hyphenated word is one word).
  const issues: GradeResult["issues"] = [];
  for (const w of tMarks) {
    if (w.mark === "missing") issues.push({ kind: "missing", expected: stripPunct(w.text) });
    else if (w.mark === "different" || w.mark === "accent")
      issues.push({ kind: w.mark, expected: stripPunct(w.text), given: stripPunct(w.counterpart ?? "") });
  }
  for (const w of aMarks) if (w.mark === "extra") issues.push({ kind: "extra", given: stripPunct(w.text) });
  const correct = total > 0 && counts.ok === T.keys.length && counts.extra === 0;
  return { correct, answer: aMarks, target: tMarks, issues, alignment, counts, accuracy };
}

function stripPunct(w: string) {
  return w.replace(/^[^\p{L}\p{N}]+|[.,;:!?…»«"]+$/gu, "");
}
