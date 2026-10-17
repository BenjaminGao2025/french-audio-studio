// Adapters from the real FastAPI payloads to the shapes the pages are typed against (types.ts).
// The SPA was first built against a mock; every function here is pure and has a vitest with a
// fixture copied from the backend code (file:line in the fixture).
import type {
  AnalyzeResult,
  AnalyzeSentence,
  AnalyzeWord,
  Attempt,
  CardMode,
  CardState,
  Episode,
  SpeakTaskSpec,
  SrsCard,
  SrsQueue,
  WriteTaskSpec,
} from "./types";

/** `SrsReviewRequest.duration_ms` is capped at one hour (routers/srs.py). */
export const MAX_DURATION_MS = 3_600_000;

export function clampDurationMs(ms: number | undefined): number | undefined {
  if (ms === undefined) return undefined;
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(ms)));
}

// ---- SRS cards (srs.py `_card_payload`) ----

export interface RawSrsCard {
  id: string;
  note_id: string;
  mode: CardMode;
  state: CardState;
  target?: string | undefined;
  target_meta?: Record<string, string> | undefined;
  importance: number;
  intervals?: SrsCard["intervals"] | undefined;
  note?:
    | {
        sentence: string;
        translation_zh: string;
        translation_en: string;
        extra?: Record<string, unknown> | undefined;
      }
    | undefined;
  [k: string]: unknown;
}

export interface RawSrsQueue {
  cards: RawSrsCard[];
  counts: SrsQueue["counts"];
}

const BLANK = "___";

/** The sentence with the target replaced by a blank (the legacy review page does the same). */
function blankOut(sentence: string, target: string): string {
  const at = target ? sentence.toLowerCase().indexOf(target.toLowerCase()) : -1;
  if (at < 0) return BLANK;
  return sentence.slice(0, at) + BLANK + sentence.slice(at + target.length);
}

export function normalizeCard(raw: RawSrsCard): SrsCard {
  const meta = raw.target_meta ?? {};
  const target = raw.target ?? "";
  let sentence = raw.note?.sentence ?? "";
  let translationEn = raw.note?.translation_en ?? "";
  let translationZh = raw.note?.translation_zh ?? "";
  let answer: string | undefined;
  if (raw.mode === "cloze") {
    sentence = blankOut(sentence, target);
    answer = target;
  } else if (raw.mode === "recognize") {
    sentence = target || sentence;
    translationEn = meta["meaning_en"] || translationEn;
    translationZh = meta["meaning_zh"] || translationZh;
  } else if (raw.mode === "grammar") {
    sentence = (meta["prompt_fr"] ?? "").replace(/_{2,}/, BLANK) || sentence;
    translationEn = meta["full_en"] || translationEn;
    answer = meta["answer"] || target;
  }
  return {
    ...raw,
    intervals: raw.intervals ?? { "1": 0, "2": 0, "3": 0, "4": 0 },
    sentence,
    translation_en: translationEn,
    translation_zh: translationZh,
    target,
    ...(answer ? { answer } : {}),
  };
}

export function normalizeQueue(raw: RawSrsQueue): SrsQueue {
  return { ...raw, cards: raw.cards.map(normalizeCard) };
}

// ---- Writing / speaking tasks (writing.py TASKS/SUBJECTS, speaking.py TASKS/SUBJECTS) ----

interface RawSubject {
  id: string;
  prompt: string;
  [k: string]: unknown;
}

interface RawTask {
  id: string;
  min_words?: number;
  max_words?: number;
  timer_seconds: number;
  prep_seconds?: number;
  /** Writing training tasks P0-P2 (curriculum.py): no timer, not an exam task. */
  practice?: boolean;
}

export interface RawTasks {
  tasks: Record<string, RawTask>;
  subjects: Record<string, RawSubject[]>;
  recommended_task?: string;
  recommended_level?: string;
}

export interface WriteTasks {
  tasks: WriteTaskSpec[];
  recommended_task?: string | undefined;
  recommended_level?: string | undefined;
}

function examTasks(raw: RawTasks): RawTask[] {
  // A task without a timer would auto-submit at 00:00 the moment it starts.
  return Object.values(raw.tasks).filter((t) => !t.practice && t.timer_seconds > 0);
}

export function normalizeWriteTasks(raw: RawTasks): WriteTasks {
  return {
    tasks: examTasks(raw).map((t) => ({
      task: t.id,
      word_range: [t.min_words ?? 0, t.max_words ?? 0],
      minutes: Math.round(t.timer_seconds / 60),
      subjects: raw.subjects[t.id] ?? [],
    })),
    recommended_task: raw.recommended_task,
    recommended_level: raw.recommended_level,
  };
}

export function normalizeSpeakTasks(raw: RawTasks): { tasks: SpeakTaskSpec[] } {
  return {
    tasks: examTasks(raw).map((t) => ({
      task: t.id,
      seconds: t.timer_seconds,
      // PRD: task 2 has two minutes of preparation.
      prep_seconds: t.prep_seconds ?? (t.id === "T2" ? 120 : undefined),
      subjects: raw.subjects[t.id] ?? [],
    })),
  };
}

// ---- Writing / speaking attempts (writing.py/speaking.py `_row_to_dict`) ----

export interface RawAttempt {
  id: string;
  status: string;
  feedback_1?: Record<string, unknown> | undefined;
  feedback_2?: Record<string, unknown> | undefined;
  wpm?: number | null | undefined;
  [k: string]: unknown;
}

function nonEmpty(o: Record<string, unknown> | undefined): o is Record<string, unknown> {
  return !!o && Object.keys(o).length > 0;
}

export function normalizeAttempt(raw: RawAttempt): Attempt {
  // generating_1 / generating_2 are in progress; the pages poll until ready or failed.
  const status = raw.status === "ready" || raw.status === "failed" ? raw.status : "pending";
  const { wpm, ...rest } = raw;
  const out: Attempt = { ...rest, status };
  if (nonEmpty(raw.feedback_1)) {
    const errors = (raw.feedback_1["errors"] as { hint?: string }[] | undefined) ?? [];
    out.feedback1 = { ...raw.feedback_1, hints: errors.map((e) => e.hint ?? "").filter(Boolean) };
    const questions = (raw.feedback_1["t2_questions"] as { count?: number } | null | undefined)
      ?.count;
    if (questions !== undefined) out["questions_asked"] = questions;
  }
  const fb2 = raw.feedback_2;
  if (nonEmpty(fb2)) {
    out.feedback2 = {
      corrected_text: String(fb2["corrected_text"] ?? fb2["corrected_transcript"] ?? ""),
      sentences: (fb2["sentences"] as NonNullable<Attempt["feedback2"]>["sentences"]) ?? [],
      structures: (fb2["structures"] as unknown[]) ?? [],
    };
  }
  // 0 means "not measured" in the database.
  if (wpm) out.wpm = wpm;
  return out;
}

// ---- Episodes (episodes.py `_row_payload`; GET /api/episodes wraps the list) ----

export interface RawEpisode {
  id: string;
  title?: string | null | undefined;
  status: string;
  duration?: number | null | undefined;
  error?: string | null | undefined;
  created_at: string;
  settings?: { level?: string; minutes?: number; request?: string } | undefined;
}

export function normalizeEpisode(raw: RawEpisode): Episode {
  const status =
    raw.status === "generating" || raw.status === "failed" || raw.status === "ready"
      ? raw.status
      : undefined;
  return {
    ...raw,
    title: raw.title ?? "",
    level: raw.settings?.level ?? "",
    minutes: raw.settings?.minutes ?? 0,
    status,
  };
}

export function normalizeEpisodes(raw: { episodes: RawEpisode[] }): Episode[] {
  return raw.episodes.map(normalizeEpisode);
}

// ---- /api/analyze (tts_service.py request_french_analysis) ----

interface RawWord {
  fr: string;
  ipa?: string;
  lemma?: string;
  type?: string;
  meaning?: string;
  meaning_zh?: string;
  why?: string;
  english_link?: string;
  false_friend?: boolean;
}

interface RawToken {
  token: string;
  lemma?: string;
  pos?: string;
  phonetic?: string;
  explanation_en?: string;
  explanation_cn?: string;
}

export interface RawAnalyzeSentence {
  sentence?: string;
  original?: string;
  translation_en?: string;
  translation_zh?: string;
  alignment?: { fr: string; en: string }[];
  order_note?: string;
  build_up?: { fr: string; en?: string; new?: string }[];
  words?: RawWord[];
  /** Legacy V1 sentences have tokens instead of words. */
  tokens?: RawToken[];
  grammar_points?: { title: string; explanation: string; hook?: string }[];
  pronunciation_tips?: string[];
}

function normalizeWord(w: RawWord): AnalyzeWord {
  return {
    word: w.fr,
    ipa: w.ipa ?? "",
    lemma: w.lemma ?? w.fr,
    pos: w.type ?? "",
    en: w.meaning ?? "",
    zh: w.meaning_zh ?? "",
    why: w.why ?? "",
    ...(w.english_link ? { english_link: w.english_link } : {}),
    ...(w.false_friend ? { false_friend: true } : {}),
  };
}

function wordFromToken(t: RawToken): AnalyzeWord {
  return {
    word: t.token,
    ipa: t.phonetic ?? "",
    lemma: t.lemma ?? t.token,
    pos: t.pos ?? "",
    en: t.explanation_en ?? "",
    zh: t.explanation_cn ?? "",
    why: "",
  };
}

export function normalizeAnalyze(raw: { sentences: RawAnalyzeSentence[] }): AnalyzeResult {
  return {
    sentences: raw.sentences.map((s): AnalyzeSentence => ({
      text: s.sentence ?? s.original ?? "",
      translation_en: s.translation_en ?? "",
      translation_zh: s.translation_zh ?? "",
      alignment: s.alignment ?? [],
      ...(s.order_note ? { order_note: s.order_note } : {}),
      build_up: (s.build_up ?? []).map((b) => b.fr),
      words: s.words ? s.words.map(normalizeWord) : (s.tokens ?? []).map(wordFromToken),
      grammar_points: s.grammar_points ?? [],
      ...(s.pronunciation_tips?.length
        ? { pronunciation_tips: s.pronunciation_tips.join("\n") }
        : {}),
    })),
  };
}
