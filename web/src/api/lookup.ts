/* Word lookups: the offline dictionary entry (routers/tutor.py) and the per-user lookup count (routers/srs.py). */
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
  dictionary_source?: "wiktionnaire";
  dictionary_state?: "found" | "not_found";
  match_type?: "exact" | "related" | "components";
  related?: string;
  components?: DictionaryEntry[];
  entries_en?: NonNullable<DictionaryEntry["entries"]>;
  entries_fr?: NonNullable<DictionaryEntry["entries"]>;
  entries?: {
    language?: "en" | "fr";
    lemma: string;
    pos: string;
    phonetic: string;
    senses: string[];
    source_url: string;
    history_url: string;
  }[];
  attribution?: string;
  license_url?: string;
  changes?: string;
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

/* ---------------- word card context (routers/tutor.py) ---------------- */

export interface WordContextHints {
  meaning_zh: string;
  meaning_en: string;
  note_en: string;
  lemma: string;
  pos: string;
}
export interface WordContextBody {
  sentence: string;
  word: string;
  occurrence: number;
  translation_zh: string;
  hints: WordContextHints;
}
export interface WordContextResult {
  meaning_zh: string;
  meaning_en: string;
  why_zh: string;
}
export interface WordContextResponse {
  context: WordContextResult;
  state: string;
}
export interface Phrase {
  text: string;
  phrase: string;
  meaning_zh: string;
  meaning_en: string;
  literal_zh: string;
}
export interface PhraseContextResponse {
  phrases: Phrase[];
}
export interface EtymologyResponse {
  text: string;
}

/** One promise per key for the page's lifetime; a failed or aborted request is forgotten so Retry asks again. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
    p.catch(() => {
      cache.delete(key);
    });
  }
  return p;
}

const wordCtxCache = new Map<string, Promise<WordContextResponse>>();
const phraseCtxCache = new Map<string, Promise<PhraseContextResponse>>();
const etyCache = new Map<string, Promise<EtymologyResponse>>();

export function wordContext(body: WordContextBody, signal?: AbortSignal): Promise<WordContextResponse> {
  const key = JSON.stringify([body.sentence, body.word, body.occurrence]);
  return cached(wordCtxCache, key, () => apiFetch<WordContextResponse>("/api/word-context", { body, signal }));
}

/** Called once per sentence: the server also caches per user and sentence. */
export function phraseContext(sentence: string, translation_zh: string, signal?: AbortSignal): Promise<PhraseContextResponse> {
  return cached(phraseCtxCache, sentence, () => apiFetch<PhraseContextResponse>("/api/phrase-context", { body: { sentence, translation_zh }, signal }));
}

/** Fetched only when the Roots & origin section is expanded. */
export function etymology(word: string, lemma: string, signal?: AbortSignal): Promise<EtymologyResponse> {
  const key = JSON.stringify([word, lemma]);
  return cached(etyCache, key, () => apiFetch<EtymologyResponse>("/api/etymology", { body: { word, lemma, language: "en" }, signal }));
}

/** Test helper: forget cached dictionaries/contexts between renders. */
export function resetLookupCaches() {
  entries.clear();
  wordCtxCache.clear();
  phraseCtxCache.clear();
  etyCache.clear();
}
