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

/** Automatic, read-only importance. 0–4 lookups → 3, 5–9 → 4, 10+ → 5. */
export function importanceFor(count: number): 3 | 4 | 5 {
  if (count >= 10) return 5;
  if (count >= 5) return 4;
  return 3;
}

export function importanceLabel(count: number): string {
  const n = importanceFor(count);
  return `Importance, ${n} out of 5, based on ${count} ${count === 1 ? "lookup" : "lookups"}.`;
}
