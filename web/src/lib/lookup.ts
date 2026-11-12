/**
 * Dictionary lookup keys and lookup counting (prototype rules).
 * Keys: NFC, trimmed/collapsed whitespace, case folding, curly/straight apostrophe equivalence.
 * Accents, hyphens, œ, whole phrases and distinct word forms are kept: failli ≠ faillir, sœur ≠ soeur.
 */
export function lookupKey(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u2019\u2018\u02BC]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
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
export const IMPORTANCE_FROM_LOOKUPS = [[5, 5], [3, 4]] as const;

export function importanceFor(count: number, saved = false): 0 | 3 | 4 | 5 {
  if (!saved) return 0;
  for (const [threshold, level] of IMPORTANCE_FROM_LOOKUPS) if (count >= threshold) return level;
  return DEFAULT_SAVED_IMPORTANCE;
}

export function importanceLabel(count: number, saved = false): string {
  const n = importanceFor(count, saved);
  return `Importance, ${n} out of 5, based on ${count} ${count === 1 ? "lookup" : "lookups"}.`;
}

/** The deck star represents Fill-in/cloze membership, never word_favorites. */
export function wordIsSaved(cards: readonly { saved: boolean; mode?: string; kind: string; word?: string }[], word: string): boolean {
  return cards.some(c => c.saved && (c.mode === "cloze" || (!c.mode && c.kind === "Fill-in")) && lookupKey(c.word ?? "") === lookupKey(word));
}
