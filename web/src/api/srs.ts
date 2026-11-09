/* Saving study sentences as review cards (routers/srs.py) and what is already saved, per sentence. */
import { useSyncExternalStore } from "react";
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
  text: string;
  mode: "cloze";
  importance?: number;
  meta: Record<string, string>;
}

/** srs.sentence_key: the server matches saved sentences this way. */
export function sentenceKey(s: string): string {
  return s.replace(/’/g, "'").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Saved cards of one sentence: "listen", "speak", and "cloze:<word>" (word lower-cased). */
export type SavedSet = ReadonlySet<string>;

export const cardKey = (mode: string, target = "") => (mode === "cloze" ? `cloze:${sentenceKey(target)}` : mode);

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
