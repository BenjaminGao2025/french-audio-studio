/* Review on the server (routers/srs.py): today's queue, ratings, mastered (archive), the card library, settings, favorites. */
import { apiFetch } from "./client";
import { lookupKey } from "../lib/lookup";
import { DEFAULT_SESSION_SIZE, type LibCard, type LibSentence, type ReviewCard } from "../data/fixtures";
import { announce, get, markMastered, set, undoMastery } from "../state/store";

export type CardMode = "listen" | "speak" | "cloze" | "recognize" | "grammar";

export interface ServerCard {
  id: string;
  note_id: string;
  mode: CardMode;
  target: string;
  target_meta: Record<string, string>;
  due: string;
  importance: number;
  archived: boolean;
  state: "new" | "learning" | "review" | "relearning";
  created_at: string;
  note?: { id: string; sentence: string; translation_zh: string; translation_en: string };
}

export interface QueueCounts {
  learning: number;
  review: number;
  new: number;
  total: number;
  reviewed_today: number;
  new_today: number;
  new_limit: number;
}

const tz = () => new Date().getTimezoneOffset();

/* ---------------- mapping server cards to the screens' shapes ---------------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]");

/** The sentence with the first occurrence of `word` blanked, or null when the sentence doesn't contain it. */
export function blankOut(sentence: string, word: string): string | null {
  const w = word.trim();
  if (!w) return null;
  const re = new RegExp(escapeRe(w), "i");
  return re.test(sentence) ? sentence.replace(re, "_____") : null;
}

const groupOf = (state: ServerCard["state"]): ReviewCard["group"] => (state === "new" ? "new" : state === "review" ? "due" : "learning");

/** Turns a server card into a review question. Legacy modes fall back to a question the screen knows. */
export function toReviewCard(c: ServerCard): ReviewCard {
  const fr = c.note?.sentence ?? "";
  const meaning = c.note?.translation_en || c.note?.translation_zh || "";
  const base = { id: c.id, sentenceId: c.note_id, group: groupOf(c.state), sentenceFr: fr };
  if (c.mode === "listen") return { ...base, kind: "Listen", prompt: "", target: fr };
  if (c.mode === "speak") return { ...base, kind: "Speak", prompt: meaning, target: fr };
  if (c.mode === "grammar") {
    const m = c.target_meta ?? {};
    const answer = m.answer || c.target;
    if (m.prompt_fr && answer) {
      const full = m.full_fr || m.prompt_fr.replace(/_{2,}/, answer);
      return { ...base, kind: "Fill-in", prompt: m.prompt_fr, target: answer, sentenceFr: full };
    }
  }
  // cloze, recognize (old word cards) and grammar without its example: blank the word in the sentence.
  const blanked = blankOut(fr, c.target);
  if (blanked) return { ...base, kind: "Fill-in", prompt: blanked, target: c.target.trim() };
  return { ...base, kind: "Recall", prompt: meaning, target: fr };
}

const savedLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `saved ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
};

const STATUS: Record<ServerCard["state"], LibCard["status"]> = { new: "new", learning: "learning", relearning: "learning", review: "review" };

const KIND: Record<CardMode, LibCard["kind"]> = { listen: "Listen", speak: "Speak", cloze: "Fill-in", recognize: "Fill-in", grammar: "Fill-in" };

/** Library rows: one sentence per note (numbered from the oldest), cards in the server's order. */
export function toLibrary(cards: ServerCard[]): { sentences: LibSentence[]; cards: LibCard[] } {
  const notes = new Map<string, { s: LibSentence; created: string }>();
  for (const c of cards) {
    if (!c.note) continue;
    const prev = notes.get(c.note_id);
    if (!prev || c.created_at < prev.created)
      notes.set(c.note_id, { s: { id: c.note_id, fr: c.note.sentence, en: c.note.translation_en || c.note.translation_zh, topic: savedLabel(c.created_at), number: 0 }, created: c.created_at });
  }
  const sentences = [...notes.values()].sort((a, b) => a.created.localeCompare(b.created)).map((x, i) => ({ ...x.s, number: i + 1 }));
  const lib: LibCard[] = cards
    .filter((c) => c.note)
    .map((c) => ({
      id: c.id,
      sentenceId: c.note_id,
      kind: KIND[c.mode],
      word: c.mode === "listen" || c.mode === "speak" ? undefined : (c.mode === "grammar" ? c.target_meta?.answer : undefined) || c.target || undefined,
      savedAt: Date.parse(c.created_at) || 0,
      status: STATUS[c.state],
      mastered: c.archived,
      favorite: false,
      lookups: 0,
      saved: true,
    }));
  return { sentences, cards: lib };
}

/* ---------------- today's queue ---------------- */

let queueLoad: Promise<void> | null = null;

/**
 * Loads today's queue and the review settings into the app state. A session that is already running keeps its
 * cards; otherwise today's bookkeeping restarts from the server's numbers (it knows what was reviewed today).
 */
export function loadQueue(): Promise<void> {
  queueLoad ??= Promise.all([
    apiFetch<{ cards: ServerCard[]; counts: QueueCounts }>(`/api/srs/queue?tz_offset=${tz()}`),
    apiFetch<{ session_size: number | null; default_session_size: number }>("/api/srs/settings"),
  ])
    .then(([q, st]) => {
      set((s) => ({
        queue: q.cards.map(toReviewCard),
        dailyNew: q.counts.new_limit,
        newUsed: s.review.phase === "active" ? s.newUsed : q.counts.new_today,
        sessionSize: st.session_size ?? st.default_session_size ?? DEFAULT_SESSION_SIZE,
        // A finished session keeps its summary; the fresh queue no longer holds the cards it reviewed.
        review:
          s.review.phase === "active"
            ? s.review
            : s.review.phase === "complete"
              ? { ...s.review, introduced: {}, done: {}, removedNew: 0 }
              : { ...s.review, index: 0, completed: 0, introduced: {}, done: {}, removedNew: 0, sessionCards: null },
      }));
      queueStats = { reviewedToday: q.counts.reviewed_today };
    })
    .finally(() => {
      queueLoad = null;
    });
  return queueLoad;
}

export let queueStats = { reviewedToday: 0 };

/** Rating sent for a checked answer: Again (1), Hard (2, hint used) or Good (3). */
export function ratingFor(r: { correct: boolean; hinted?: boolean; answerKnown?: boolean }): 1 | 2 | 3 {
  if (!r.correct || r.answerKnown) return 1;
  return r.hinted ? 2 : 3;
}

/** Records one review on the server; the server reschedules the card. */
export async function rateCard(cardId: string, rating: 1 | 2 | 3 | 4, opts: { answer?: string; durationMs?: number } = {}) {
  const card = await apiFetch<ServerCard>(`/api/srs/cards/${encodeURIComponent(cardId)}/review`, {
    body: { rating, answer: opts.answer, duration_ms: opts.durationMs, tz_offset: tz() },
  });
  set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? { ...c, status: STATUS[card.state] ?? c.status } : c)) }));
  return card;
}

/* ---------------- library, favorites, lookup counts ---------------- */

let libraryState: "idle" | "loading" | "ready" = "idle";
let libraryLoad: Promise<void> | null = null;

export const libraryReady = () => libraryState === "ready";

/** Loads every card with its sentence, the favorites and the lookup counts. `force` reloads a loaded library. */
export function loadLibrary(force = false): Promise<void> {
  if (libraryState === "ready" && !force) return Promise.resolve();
  libraryLoad ??= (libraryState = "loading",
  Promise.all([
    apiFetch<{ cards: ServerCard[] }>("/api/srs/cards?limit=5000"),
    apiFetch<{ words: string[] }>("/api/srs/favorites"),
    apiFetch<{ counts: Record<string, number> }>("/api/srs/lookups"),
  ]))
    .then(([c, f, l]) => {
      const lib = toLibrary(c.cards ?? []);
      set(() => ({
        ...lib,
        favorites: Object.fromEntries((f.words ?? []).map((w) => [lookupKey(w), true])),
        lookups: Object.fromEntries(Object.entries(l.counts ?? {}).map(([w, n]) => [lookupKey(w), { count: n, lastCounted: null }])),
      }));
      libraryState = "ready";
    })
    .catch((e) => {
      libraryState = "idle";
      throw e;
    })
    .finally(() => {
      libraryLoad = null;
    });
  return libraryLoad;
}

/** Favorites are per word for word cards and per sentence for whole-sentence cards, so they sync across devices. */
export function favoriteKey(c: Pick<LibCard, "kind" | "word" | "sentenceId">): string {
  if (c.word) return lookupKey(c.word);
  return lookupKey(get().sentences.find((s) => s.id === c.sentenceId)?.fr ?? "");
}

export async function setFavorite(text: string, favorite: boolean): Promise<void> {
  const k = lookupKey(text);
  if (!k) return;
  const before = Boolean(get().favorites[k]);
  set((s) => ({ favorites: { ...s.favorites, [k]: favorite } }));
  try {
    await apiFetch("/api/srs/favorites", { method: "PUT", body: { word: text.trim(), favorite } });
    announce(favorite ? "Added to favorites. Lookup count and importance are unchanged." : "Removed from favorites. Lookup count and importance are unchanged.");
  } catch {
    set((s) => ({ favorites: { ...s.favorites, [k]: before } }));
    announce("Couldn’t save the favorite. Nothing changed.", true);
  }
}

let favoritesLoaded = false;

/** The word popup only needs the favorites, not the whole library. */
export async function loadFavorites(): Promise<void> {
  if (favoritesLoaded || libraryReady()) return;
  const f = await apiFetch<{ words: string[] }>("/api/srs/favorites");
  set((s) => ({ favorites: { ...s.favorites, ...Object.fromEntries((f.words ?? []).map((w) => [lookupKey(w), true])) } }));
  favoritesLoaded = true;
}

/* ---------------- mastered ---------------- */

async function putArchived(cardId: string, archived: boolean) {
  await apiFetch(`/api/srs/cards/${encodeURIComponent(cardId)}/archive`, { body: { archived } });
}

const setMastered = (cardId: string, mastered: boolean) =>
  set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? { ...c, mastered } : c)) }));

/** Marks a card mastered right away (with the 6-second Undo) and saves it; a failed save puts it back. */
export function masterCard(cardId: string): string {
  const actionId = markMastered(cardId);
  putArchived(cardId, true).catch(() => {
    setMastered(cardId, false);
    set((s) => ({ mastery: s.mastery.filter((m) => m.id !== actionId) }));
    announce("Couldn’t mark the card mastered. It stays in your review.", true);
  });
  return actionId;
}

/** Undo within the window restores the card on the server too. */
export function undoMastered(actionId: string): boolean {
  const cardId = get().mastery.find((m) => m.id === actionId)?.cardId;
  const ok = undoMastery(actionId);
  if (ok && cardId && get().mastery.find((m) => m.id === actionId)?.state === "undone") {
    putArchived(cardId, false).catch(() => {
      setMastered(cardId, true);
      announce("Couldn’t undo on the server. The card is still mastered; restore it from Mastered.", true);
    });
  }
  return ok;
}

/** Restore from the Mastered list. Rejects when the server didn't save it. */
export async function restoreMastered(cardId: string): Promise<void> {
  await putArchived(cardId, false);
  setMastered(cardId, false);
}

/* ---------------- settings ---------------- */

export async function saveReviewSettings(p: { new_limit?: number; session_size?: number }): Promise<{ new_limit?: number; session_size?: number }> {
  return apiFetch("/api/srs/settings", { method: "PUT", body: p });
}

/** Test helper: forget what was loaded. */
export function resetReviewCache() {
  libraryState = "idle";
  libraryLoad = null;
  queueLoad = null;
  favoritesLoaded = false;
}
