/**
 * Dictionary lookup keys and lookup counting (prototype rules).
 * Keys: NFC, trimmed/collapsed whitespace, case folding, curly/straight apostrophe equivalence.
 * A single word’s recognized elision prefix is stripped for shared lemma identity.
 * Accents, hyphens, œ, whole phrases and distinct word forms are kept: failli ≠ faillir, sœur ≠ soeur.
 */
/** Strip a single Task 5 elision from a word; keep whole phrases intact. */
export function stripElidedPrefix(s: string): string {
  return s.replace(/^(?:l|d|j|n|m|t|s|c|qu|jusqu|lorsqu|puisqu)['’‘ʼ](?=[\p{L}\p{N}])([^\s]+)$/iu, "$1");
}

export function lookupKey(s: string): string {
  return stripElidedPrefix(s
    .normalize("NFC")
    .replace(/[\u2019\u2018\u02BC]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr"));
}

export const LOOKUP_WINDOW_SECONDS = 5;

export interface LookupCounter {
  count: number;
  /** Time (seconds) of the last *counted* lookup. Suppressed events never move it. */
  lastCounted: number | null;
}

export function countLookup(c: LookupCounter, t: number): { next: LookupCounter; counted: boolean } {
  if (c.lastCounted === null || t - c.lastCounted >= LOOKUP_WINDOW_SECONDS) {
    return { next: { count: c.count + 1, lastCounted: t }, counted: true };
  }
  return { next: c, counted: false };
}

export const DEFAULT_SAVED_IMPORTANCE = 3;
/** Same as srs.LOOKUPS_PER_STAR: saving gives 3 stars (the learner may pick 2-5); every 5 lookups after that add one. */
export const LOOKUPS_PER_STAR = 5;
/** The lowest level the learner can choose for a saved word. */
export const MIN_CHOSEN_IMPORTANCE = 2;

/** Estimate for a word saved before its first lookup (srs.importance_for_lookups); the stored value wins when known. */
export function importanceFor(count: number, saved = false): number {
  return saved ? Math.min(5, DEFAULT_SAVED_IMPORTANCE + Math.floor(count / LOOKUPS_PER_STAR)) : 0;
}

export function importanceLabel(count: number, saved = false, value?: number): string {
  const n = value ?? importanceFor(count, saved);
  return `Importance, ${n} out of 5. Looked up ${count} ${count === 1 ? "time" : "times"}.`;
}

/** A saved word's importance as stored on its cards (the highest), or 0 when the word is not saved. */
export function wordImportance(cards: readonly { saved: boolean; mode?: string; kind: string; word?: string; importance?: number }[], word: string): number {
  const key = lookupKey(word);
  let best = 0;
  for (const c of cards)
    if (c.saved && (c.mode === "cloze" || c.mode === "recognize" || (!c.mode && c.kind === "Fill-in")) && lookupKey(c.word ?? "") === key)
      best = Math.max(best, c.importance ?? DEFAULT_SAVED_IMPORTANCE);
  return best;
}

/** The deck star represents saved word membership (Fill-in and Recall), never word_favorites. */
export function wordIsSaved(cards: readonly { saved: boolean; mode?: string; kind: string; word?: string }[], word: string): boolean {
  return cards.some(c => c.saved && (c.mode === "cloze" || c.mode === "recognize" || (!c.mode && c.kind === "Fill-in")) && lookupKey(c.word ?? "") === lookupKey(word));
}
