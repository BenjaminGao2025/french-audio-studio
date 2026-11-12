/* Saving study sentences as review cards (routers/srs.py) and what is already saved, per sentence. */
import { useSyncExternalStore } from "react";
import { lookupWord } from "./lookup";
import type { ApiWord } from "./study";
import { toLibrary, type ServerCard } from "./review";
import { get, set } from "../state/store";
import { apiFetch } from "./client";

export interface ApiCard {
  id: string;
  note_id: string;
  mode: "listen" | "speak" | "cloze" | "recognize" | "grammar";
  target: string;
  target_meta: Record<string, unknown>;
  archived: boolean;
}

export interface ApiNote {
  id: string;
  sentence: string;
  translation_zh: string;
  translation_en: string;
  cards: ApiCard[];
}

export interface NoteTarget {
  exact_target?: boolean;
  text: string;
  mode: "cloze";
  importance?: number;
  meta: Record<string, string>;
}

/** srs.sentence_key: the server matches saved sentences this way. */
export function sentenceKey(s: string): string {
  return s.replace(/’/g, "'").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Saved cards of one sentence: "listen", "speak", and "cloze:<word>", and "grammar:<title>" (targets lower-cased). */
export type SavedSet = ReadonlySet<string>;

export const cardKey = (mode: string, target = "") => (["cloze", "recognize", "grammar"].includes(mode) ? `${mode === "recognize" ? "cloze" : mode}:${sentenceKey(target)}` : mode);

let saved: Record<string, SavedSet> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function remember(notes: ApiNote[]) {
  const next = { ...saved };
  for (const n of notes) {
    const keys = new Set(next[sentenceKey(n.sentence)] ?? []);
    for (const c of n.cards ?? []) keys.add(cardKey(c.mode, c.target));
    next[sentenceKey(n.sentence)] = keys;
  }
  saved = next;
  emit();
}

const EMPTY: SavedSet = new Set();

export function useSavedCards(sentence: string): SavedSet {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => saved[sentenceKey(sentence)] ?? EMPTY,
  );
}

/** Loads which of these sentences already have cards. Failure leaves the known state as it is. */
export async function loadSavedCards(sentences: string[]): Promise<void> {
  if (!sentences.length) return;
  const res = await apiFetch<{ notes: ApiNote[] }>("/api/srs/notes/lookup", { body: { sentences } });
  remember(res.notes ?? []);
}

/** Saves a sentence with the chosen cards. The server never duplicates a card that already exists. */
export async function saveNote(req: {
  sentence: string;
  translation_en: string;
  translation_zh: string;
  modes: ("listen" | "speak")[];
  targets: NoteTarget[];
  extra?: Record<string, unknown>;
}): Promise<ApiNote> {
  const note = await apiFetch<ApiNote>("/api/srs/notes", { body: { extra: {}, ...req } });
  remember([note]);
  const lib = toLibrary(note.cards.map(c => ({ state: "new", due: new Date().toISOString(), created_at: new Date().toISOString(), importance: 3, ...c, note: { ...note } })) as ServerCard[]);
  set(s => ({ cards: [...s.cards.filter(c => !lib.cards.some(n => n.id === c.id)), ...lib.cards], sentences: [...s.sentences.filter(n => n.id !== note.id), ...lib.sentences.map(n => s.sentences.find(old => old.id === n.id) ?? n)] }));
  return note;
}

/** Test helper. */
export function resetSavedCards() {
  saved = {};
  emit();
}

/* ---------------- sentences for Recall / Dictation without new text ---------------- */

export interface SavedSentence {
  noteId: string;
  fr: string;
  en: string;
  createdAt: string;
}

interface CardWithNote extends ApiCard {
  created_at: string;
  note?: { id: string; sentence: string; translation_en: string };
}

function uniqueSentences(cards: CardWithNote[]): SavedSentence[] {
  const out = new Map<string, SavedSentence>();
  for (const c of cards) {
    if (!c.note || out.has(c.note.id)) continue;
    out.set(c.note.id, { noteId: c.note.id, fr: c.note.sentence, en: c.note.translation_en, createdAt: c.created_at });
  }
  return [...out.values()];
}

/** Sentences of the cards due today (one per sentence), in queue order. */
export async function queueSentences(): Promise<SavedSentence[]> {
  const res = await apiFetch<{ cards: CardWithNote[] }>(`/api/srs/queue?tz_offset=${new Date().getTimezoneOffset()}`);
  return uniqueSentences(res.cards ?? []);
}

/** Every saved sentence that still has a card in review (mastered-only sentences are left out), newest first. */
export async function savedSentences(): Promise<SavedSentence[]> {
  const res = await apiFetch<{ cards: CardWithNote[] }>("/api/srs/cards");
  return uniqueSentences((res.cards ?? []).filter((c) => !c.archived));
}

/** The same metadata snapshot for Add to review and the word-card star. */
export async function clozeTarget(w: ApiWord): Promise<NoteTarget> {
  const dict = await lookupWord(w.fr, w.type).catch(() => null);
  const meta: Record<string, string> = { meaning_en: w.meaning, meaning_zh: w.meaning_zh, lemma: w.lemma, pos: w.type, ipa: w.ipa, ctx_en: w.meaning, ctx_zh: w.meaning_zh, dict_en: dict?.explanation_en ?? "", dict_zh: dict?.explanation_cn ?? "", snap: "1" };
  return { text: w.fr, mode: "cloze", exact_target: true, meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => v)) };
}

/** Remove one card; sentence audio and other words keep their membership. */
export async function deleteSavedCard(id: string): Promise<void> {
  const card = get().cards.find(c => c.id === id);
  const sentence = get().sentences.find(s => s.id === card?.sentenceId);
  await apiFetch(`/api/srs/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (card && sentence) {
    const key = sentenceKey(sentence.fr);
    const keys = new Set(saved[key] ?? []);
    keys.delete(cardKey(card.mode ?? (card.kind === "Fill-in" ? "cloze" : card.kind.toLowerCase()), card.word));
    saved = { ...saved, [key]: keys };
    emit();
  }
  set(s => ({ cards: s.cards.filter(c => c.id !== id) }));
}
