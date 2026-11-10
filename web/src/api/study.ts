/* Study endpoints (routers/studio.py, routers/history.py) and the mapping from an analysed sentence to the screen model. */
import type { DerivedCard, GrammarNote, Segment, Step, StepPart, StudySentence } from "../data/fixtures";
import { ApiError, apiFetch } from "./client";

/** One analysed word (analysis.py, schema v2). */
export interface ApiWord {
  fr: string;
  ipa: string;
  lemma: string;
  type: string;
  meaning: string;
  meaning_zh: string;
  why: string;
  english_link: string;
  false_friend: boolean;
}

/** One analysed sentence as /api/analyze returns it (schema v2; legacy fields are ignored). */
export interface ApiSentence {
  sentence: string;
  translation_en: string;
  translation_zh: string;
  build_up: { fr: string; en: string; new: string }[];
  words: ApiWord[];
  grammar_points: { title: string; explanation: string; hook: string }[];
  pronunciation_tips?: string[];
  accent_fixed_from?: string;
  alignment?: { fr: string; en: string }[];
  order_note?: string;
  structure?: { text: string; block: string; role: string; detail: string; gid?: string }[];
  grammar_ids?: string[];
  [key: string]: unknown;
}

/* ---------------- analysis ---------------- */

/** Sentences (or lines), with very short ones kept together, up to ~90 characters a part (same as static/study.js). */
export function splitForAnalysis(text: string): string[] {
  // Never split inside « … » (French puts a space before the closing mark).
  const sentences = text
    .split(/(?<=[.!?…]["»”)]?)\s+(?![»”])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts: string[] = [];
  for (const sentence of sentences) {
    const last = parts[parts.length - 1];
    if (last && last.length + sentence.length < 90) parts[parts.length - 1] = `${last}\n${sentence}`;
    else parts.push(sentence);
  }
  return parts.length ? parts : [text];
}

export const RETRY_DELAYS = [1500, 4000];

function retryable(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // status 0 = the request itself failed (network); 5xx = the tunnel or the model stalled. 4xx stays bad.
  return err instanceof ApiError ? err.status === 0 || err.status >= 500 : true;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function analyzePart(text: string, signal?: AbortSignal): Promise<ApiSentence[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await apiFetch<{ sentences?: ApiSentence[] }>("/api/analyze", { body: { text }, signal });
      return res.sentences ?? [];
    } catch (err) {
      const delay = RETRY_DELAYS[attempt];
      if (delay === undefined || !retryable(err, signal)) throw err;
      await wait(delay, signal);
    }
  }
}

export interface AnalyzeProgress {
  done: number;
  total: number;
}

/**
 * Analyses text part by part, two parts at a time. A part that keeps failing is skipped; the whole
 * analysis fails only when every part fails (the first error is rethrown).
 */
export async function analyzeText(
  text: string,
  opts: { signal?: AbortSignal; onProgress?: (p: AnalyzeProgress) => void } = {},
): Promise<{ sentences: ApiSentence[]; failedParts: number }> {
  const parts = splitForAnalysis(text);
  const results: (ApiSentence[] | null)[] = parts.map(() => null);
  let firstError: unknown = null;
  let failed = 0;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < parts.length) {
      const i = next++;
      try {
        results[i] = await analyzePart(parts[i], opts.signal);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        firstError ??= err;
        failed++;
      }
      done++;
      opts.onProgress?.({ done, total: parts.length });
    }
  };
  await Promise.all([worker(), worker()]);
  if (failed === parts.length) throw firstError;
  return { sentences: results.flatMap((r) => r ?? []), failedParts: failed };
}

/** A lesson pasted with Chinese notes: the server keeps only the French lines. Any failure means "use the text as typed". */
export async function cleanInput(text: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await apiFetch<{ cleaned?: string; changed?: boolean }>("/api/clean-input", { body: { text }, signal, noAuthRedirect: true });
    return res.changed && typeof res.cleaned === "string" && res.cleaned.trim() ? res.cleaned : null;
  } catch {
    return null;
  }
}

/** "Practise my own ideas": the learner's idea (English or simple French) becomes simple Canadian French. */
export async function ideaToFrench(text: string, signal?: AbortSignal): Promise<string> {
  const res = await apiFetch<{ text: string }>("/api/transform", {
    body: { text, style: "spoken", level: "A1-A2", locale: "fr-CA", task_mode: "express" },
    signal,
  });
  return res.text;
}

/* ---------------- photo import ---------------- */

export interface PhotoItem {
  kind: string;
  fr: string;
  gloss: string;
  accent_fixed_from?: string;
  alignment?: { fr: string; en: string }[];
  order_note?: string;
  structure?: { text: string; block: string; role: string; detail: string; gid?: string }[];
  grammar_ids?: string[];
}

/** Downscales a photo to at most 1600 px on the long side as JPEG 0.8 (the server's upload limit). */
export async function photoToDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function photoExtract(image: string, signal?: AbortSignal): Promise<PhotoItem[]> {
  const res = await apiFetch<{ items?: PhotoItem[] }>("/api/photo-extract", { body: { image }, signal });
  return res.items ?? [];
}

/* ---------------- history ---------------- */

/** Saves an analysis to History in the same shape the old pages used, so either app can re-open it. */
export async function saveStudyHistory(text: string, sentences: ApiSentence[], source: string): Promise<void> {
  const now = Date.now();
  const id = `hist_study_${now}`;
  const record = { id, type: "study", schemaVersion: 2, timestamp: now, text: text.trim(), sentences, sentenceCount: sentences.length, source };
  await apiFetch("/api/history", { body: { id, type: "study", text: record.text, payload: record } });
}

/* ---------------- mapping to the screen model ---------------- */

const fold = (s: string) => s.replace(/[’‘ʼ]/g, "'").toLowerCase();

/** Splits the sentence into clickable words (by the analysis word list, in order) and the text between them. */
export function segmentsFor(sentence: string, words: ApiWord[]): Segment[] {
  const hay = fold(sentence);
  const out: Segment[] = [];
  let at = 0;
  words.forEach((w, wi) => {
    const needle = fold(w.fr);
    const i = needle ? hay.indexOf(needle, at) : -1;
    if (i < 0) return;
    if (i > at) out.push({ t: sentence.slice(at, i) });
    out.push({ t: sentence.slice(i, i + needle.length), w: true, wi });
    at = i + needle.length;
  });
  if (at < sentence.length) out.push({ t: sentence.slice(at) });
  return out.length ? out : [{ t: sentence }];
}

const wordKey = (w: string) => fold(w).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");

/** Marks the words a build-up step adds compared with the step before it. */
export function stepParts(prev: string, cur: string): StepPart[] {
  const seen = new Map<string, number>();
  for (const w of prev.split(/\s+/).filter(Boolean)) seen.set(wordKey(w), (seen.get(wordKey(w)) ?? 0) + 1);
  const parts: StepPart[] = [];
  const tokens = cur.split(/(\s+)/);
  for (const tok of tokens) {
    if (!tok) continue;
    const space = /^\s+$/.test(tok);
    let added = false;
    if (!space) {
      const k = wordKey(tok);
      const n = seen.get(k) ?? 0;
      if (n > 0) seen.set(k, n - 1);
      else added = Boolean(prev) && k !== "";
    }
    const last = parts[parts.length - 1];
    // Spaces join the run they sit in; a space between an old and a new word stays plain.
    if (last && (space ? true : Boolean(last.added) === added)) last.t += tok;
    else parts.push(added ? { t: tok, added: true } : { t: tok });
  }
  // A trailing space inside a marked run belongs outside the mark.
  const split = parts.flatMap((p) => {
    const m = p.added ? p.t.match(/^(.*?)(\s+)$/s) : null;
    return m ? [{ t: m[1], added: true }, { t: m[2] }] : [p];
  });
  // That space can sit next to an unmarked run: join them.
  return split.reduce<StepPart[]>((out, p) => {
    const last = out[out.length - 1];
    if (last && Boolean(last.added) === Boolean(p.added)) last.t += p.t;
    else out.push({ ...p });
    return out;
  }, []);
}

export function stepsFor(s: ApiSentence): Step[] {
  const steps = s.build_up.filter((b) => b.fr.trim());
  if (!steps.length) return [{ parts: [{ t: s.sentence }], en: s.translation_en, addedLabel: "Short sentence: practise it whole", how: "" }];
  return steps.map((b, i) => ({
    parts: stepParts(i ? steps[i - 1].fr : "", b.fr),
    en: b.en,
    addedLabel: b.new || (i === 0 ? "Starting phrase" : "Added words"),
    how: "",
  }));
}

export function grammarFor(s: ApiSentence): GrammarNote[] | null {
  const notes = (s.grammar_points ?? []).filter((g) => g.title || g.explanation);
  return notes.length ? notes.map((g) => ({ title: g.title, body: g.explanation, example: g.hook, exampleEn: "" })) : null;
}

/** Stable id for a sentence: the same French text always maps to the same id. */
export function sentenceId(fr: string): string {
  let h = 0x811c9dc5;
  const key = fr.normalize("NFC").trim();
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return `s-${h.toString(36)}`;
}

export function sentenceCards(id: string): DerivedCard[] {
  return [
    { id: `${id}-listen`, kind: "Listen", label: "Listen card · whole sentence" },
    { id: `${id}-speak`, kind: "Speak", label: "Speak card · whole sentence" },
  ];
}

export function toStudySentence(s: ApiSentence): StudySentence {
  const id = sentenceId(s.sentence);
  return {
    id,
    fr: s.sentence,
    en: s.translation_en,
    segments: segmentsFor(s.sentence, s.words ?? []),
    steps: stepsFor({ ...s, build_up: s.build_up ?? [] }),
    grammar: grammarFor(s),
    cards: sentenceCards(id),
    raw: s,
  };
}

/** The text a build-up step reads aloud and is graded against. */
export const stepText = (st: Step) => st.parts.map((p) => p.t).join("");
