import { loadLibrary } from "./review";
/* Word lookups: the offline dictionary entry (routers/tutor.py) and the per-user lookup count (routers/srs.py). */
import { useSyncExternalStore } from "react";
import { apiFetch } from "./client";
import { get, set } from "../state/store";
import { lookupKey, wordImportance } from "../lib/lookup";

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
  elision?: { prefix: string; expansion: string; note: string; remainder: string };
  components?: DictionaryEntry[];
  entries_en?: NonNullable<DictionaryEntry["entries"]>;
  entries_fr?: NonNullable<DictionaryEntry["entries"]>;
  entries?: {
    language?: "en" | "fr";
    lemma: string;
    pos: string;
    gender?: string;
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
export function lookupWord(word: string, pos = ""): Promise<DictionaryEntry> {
  const key = JSON.stringify([word.trim().normalize("NFC"), pos]);
  let p = entries.get(key);
  if (!p) {
    p = apiFetch<DictionaryEntry>(`/api/lookup?word=${encodeURIComponent(word.trim())}&pos=${encodeURIComponent(pos)}`);
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
export async function recordLookup(word: string, context?: { fr: string; en: string; raw?: { translation_en?: string; translation_zh?: string } }): Promise<LookupCount> {
  const res = await apiFetch<LookupCount>("/api/srs/lookups", { body: { word, ...(context ? { sentence: context.fr, translation_en: context.raw?.translation_en || context.en, translation_zh: context.raw?.translation_zh ?? "" } : {}) } });
  counts = { ...counts, [lookupKey(word)]: res.count };
  listeners.forEach((l) => l());
  set(s => ({ lookups: { ...s.lookups, [lookupKey(word)]: { count: res.count, lastCounted: null } } }));
  // A counted lookup can save the word (3rd) or raise its importance (5th, 10th): refresh the deck when it did.
  if (res.incremented && res.importance !== wordImportance(get().cards, word)) await loadLibrary(true);
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
  language?: "en" | "zh";
  translation_zh: string;
  hints: WordContextHints;
}
export interface WordContextResult {
  meaning_zh: string;
  meaning_en: string;
  why_zh: string;
  why_en?: string;
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
  lang?: "zh";
  schema_version?: number;
  construction?: { form: string; gloss_zh?: string }[];
  source?: { lang: string; form: string; from_form?: string }[];
  sense_history_zh?: string;
  memory_zh?: string;
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
  const key = JSON.stringify([body.sentence, body.word, body.occurrence, body.language ?? "en"]);
  return cached(wordCtxCache, key, () => apiFetch<WordContextResponse>("/api/word-context", { body, signal }));
}

/** Called once per sentence: the server also caches per user and sentence. */
export function phraseContext(sentence: string, translation_zh: string, signal?: AbortSignal): Promise<PhraseContextResponse> {
  return cached(phraseCtxCache, sentence, () => apiFetch<PhraseContextResponse>("/api/phrase-context", { body: { sentence, translation_zh }, signal }));
}

/** Fetched only when the Roots & origin section is expanded. */
export function etymology(word: string, lemma: string, signal?: AbortSignal): Promise<EtymologyResponse> {
  const key = JSON.stringify([word, lemma]);
  return cached(etyCache, key, () => apiFetch<EtymologyResponse>("/api/etymology", { body: { word, lemma, language: "zh" }, signal }));
}

/** Test helper: forget cached dictionaries/contexts between renders. */
export function resetLookupCaches() {
  entries.clear();
  wordCtxCache.clear();
  phraseCtxCache.clear();
  etyCache.clear();
}
