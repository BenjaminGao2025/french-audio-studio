/* Word lookups: the AI dictionary entry (routers/tutor.py) and the per-user lookup count (routers/srs.py). */
import { useSyncExternalStore } from "react";
import { apiFetch } from "./client";
import { lookupKey } from "../lib/lookup";

export interface DictionaryEntry {
  token: string;
  lemma: string;
  pos: string;
  phonetic: string;
  explanation_cn: string;
  explanation_en: string;
}

const entries = new Map<string, Promise<DictionaryEntry>>();

/** One request per word per page load; a failed request is forgotten so Retry asks again. */
export function lookupWord(word: string): Promise<DictionaryEntry> {
  const key = lookupKey(word);
  let p = entries.get(key);
  if (!p) {
    p = apiFetch<DictionaryEntry>(`/api/lookup?word=${encodeURIComponent(word.trim())}`);
    entries.set(key, p);
    p.catch(() => entries.delete(key));
  }
  return p;
}

export interface LookupCount {
  count: number;
  importance: number;
  /** False when the server ignored a repeat lookup within 5 seconds. */
  incremented: boolean;
}

let counts: Record<string, number> = {};
const listeners = new Set<() => void>();

export function useLookupCount(word: string): number | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => counts[lookupKey(word)],
  );
}

/** Counts one look-up of a word on the server (it debounces repeats itself). */
export async function recordLookup(word: string): Promise<LookupCount> {
  const res = await apiFetch<LookupCount>("/api/srs/lookups", { body: { word } });
  counts = { ...counts, [lookupKey(word)]: res.count };
  listeners.forEach((l) => l());
  return res;
}
