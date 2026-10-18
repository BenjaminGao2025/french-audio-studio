// Real adapter: calls the FastAPI backend at /api on the same origin.
import { request, tzOffset } from "./client";
import {
  clampDurationMs,
  normalizeAnalyze,
  normalizeAttempt,
  normalizeCard,
  normalizeEpisode,
  normalizeEpisodes,
  normalizeQueue,
  normalizeSpeakTasks,
  normalizeWriteTasks,
  type RawAnalyzeSentence,
  type RawAttempt,
  type RawEpisode,
  type RawSrsCard,
  type RawSrsQueue,
  type RawTasks,
} from "./normalize";
import type * as T from "./types";

// /tts accepts 1-600 characters (tts_service.py TTS_SNIPPET_MAX_CHARS).
const TTS_MAX_CHARS = 600;

export const real = {
  auth: {
    login: (email: string, password: string) =>
      request<T.UserStatus & { token: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      }),
    session: () => request<void>("/api/auth/session", { method: "POST" }),
    me: () => request<T.UserStatus>("/api/auth/me"),
    logout: () => request<void>("/api/auth/logout", { method: "POST" }),
    devices: () => request<unknown[]>("/api/auth/devices"),
    deleteDevice: (id: string) => request<void>(`/api/auth/devices/${id}`, { method: "DELETE" }),
  },
  game: {
    state: () => request<T.GameState>("/api/game/state", { query: { tz_offset: tzOffset() } }),
    heartbeat: (lane: T.Lane, seconds: number) =>
      request<{ stored_seconds: number }>("/api/game/heartbeat", {
        method: "POST",
        body: { lane, seconds, tz_offset: tzOffset() },
      }),
    log: (lane: T.Lane, minutes: number, note: string) =>
      request<T.GameState>("/api/game/log", {
        method: "POST",
        body: { lane, minutes, note, tz_offset: tzOffset() },
      }),
    deleteLog: (id: string | number) =>
      request<T.GameState>(`/api/game/log/${id}`, {
        method: "DELETE",
        query: { tz_offset: tzOffset() },
      }),
    familyDay: (on: boolean) =>
      request<T.GameState>("/api/game/family-day", {
        method: "POST",
        body: { on, tz_offset: tzOffset() },
      }),
  },
  srs: {
    queue: async (
      opts: {
        new_limit?: number | undefined;
        min_importance?: number | undefined;
        modes?: string | undefined;
      } = {},
    ) =>
      normalizeQueue(
        await request<RawSrsQueue>("/api/srs/queue", {
          query: {
            tz_offset: tzOffset(),
            new_limit: opts.new_limit,
            min_importance: opts.min_importance,
            modes: opts.modes,
          },
        }),
      ),
    review: async (
      id: string,
      rating: 1 | 2 | 3 | 4,
      duration_ms?: number | undefined,
      score?: number | undefined,
      answer?: string,
    ) => {
      const card = await request<RawSrsCard & { game: unknown }>(`/api/srs/cards/${id}/review`, {
        method: "POST",
        body: {
          rating,
          duration_ms: clampDurationMs(duration_ms),
          score,
          answer,
          tz_offset: tzOffset(),
        },
      });
      return { ...normalizeCard(card), game: card.game };
    },
    practice: async (card_ids: string[]) => {
      const res = await request<RawSrsQueue>("/api/srs/practice", {
        method: "POST",
        body: { card_ids },
      });
      return normalizeQueue(res);
    },
    addNote: (note: {
      sentence: string;
      translation_zh?: string | undefined;
      translation_en?: string | undefined;
      modes?: string[] | undefined;
      targets?: unknown[];
    }) => request<unknown>("/api/srs/notes", { method: "POST", body: note }),
    lookupNotes: (sentences: string[]) =>
      request<unknown>("/api/srs/notes/lookup", { method: "POST", body: { sentences } }),
  },
  coach: {
    get: () => request<T.CoachDashboard>("/api/coach"),
    complete: (kind: string, note?: string) =>
      request<void>("/api/coach/complete", { method: "POST", body: { kind, note } }),
    review: (note?: string) =>
      request<unknown>("/api/coach/review", { method: "POST", body: { note } }),
    profile: (profile: Record<string, unknown>) =>
      request<T.CoachDashboard>("/api/coach/profile", { method: "POST", body: profile }),
  },
  homework: {
    list: () => request<{ entries: T.Journal[] }>("/api/homework"),
    create: (native_text: string) =>
      request<T.Journal>("/api/homework", { method: "POST", body: { native_text } }),
    get: (id: string) => request<T.Journal>(`/api/homework/${id}`),
    prepare: (
      id: string,
      opts: { expand?: boolean | undefined; repair_audio?: boolean | undefined } = {},
    ) => request<T.Journal>(`/api/homework/${id}/prepare`, { method: "POST", body: opts }),
    referenceUrl: (id: string) => `/api/homework/${id}/reference`,
    practice: (id: string, beat_id: string, seconds: number) =>
      request<void>(`/api/homework/${id}/practice`, { method: "POST", body: { beat_id, seconds } }),
    // Raw audio body (audio/webm or audio/mp4); the server measures the duration itself.
    uploadRecording: (id: string, kind: "first" | "final", audio: Blob) =>
      request<T.Journal>(`/api/homework/${id}/recordings`, {
        method: "POST",
        raw: audio,
        query: { kind },
      }),
    finish: (id: string, reflection: string, recalled: boolean) =>
      request<T.Journal>(`/api/homework/${id}/finish`, {
        method: "POST",
        body: { reflection, recalled },
      }),
    archiveUrl: (id: string) => `/api/homework/${id}/archive`,
    // Not on the FastAPI backend yet: answers 404, which the UI shows as "not available".
    recite: (id: string, audio: Blob) => {
      const form = new FormData();
      form.set("audio", audio, "recite.webm");
      return request<T.ReciteResult>(`/api/homework/${id}/recite`, { method: "POST", form });
    },
  },
  shadow: {
    sentences: () => request<T.ShadowSentence[]>("/api/shadow/sentences"),
  },
  speech: {
    synthesize: (text: string, voice = "fr-FR-DeniseNeural", rate: "-30%" | "-20%" | "0%" = "0%") =>
      request<T.SpeechResult>("/api/speech", { method: "POST", body: { text, voice, rate } }),
    /** null when /tts would reject the text (empty or too long), so callers disable playback. */
    ttsUrl: (text: string, voice = "fr-FR-DeniseNeural"): string | null =>
      text.trim() && text.length <= TTS_MAX_CHARS
        ? `/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`
        : null,
    // The backend reads the raw request body and sniffs the audio type; it has no multipart parser.
    transcribe: (audio: Blob, language = "fr") =>
      request<{ text: string; duration?: number }>(`/api/transcribe`, {
        method: "POST",
        raw: audio,
        query: { language },
      }),
  },
  analyze: {
    text: async (text: string) =>
      normalizeAnalyze(
        await request<{ sentences: RawAnalyzeSentence[] }>("/api/analyze", {
          method: "POST",
          body: { text },
        }),
      ),
    lookup: (word: string) => request<unknown>("/api/lookup", { query: { word } }),
  },
  write: {
    tasks: async (): Promise<{
      tasks: T.WriteTaskSpec[];
      recommended?: unknown;
      recommended_task?: string | undefined;
      recommended_level?: string | undefined;
    }> => normalizeWriteTasks(await request<RawTasks>("/api/write/tasks")),
    subject: (task: string, level: string, theme?: string) =>
      request<unknown>("/api/write/subject", { method: "POST", body: { task, level, theme } }),
    attempt: (body: {
      task: string;
      subject: unknown;
      level: string;
      text: string;
      seconds: number;
    }) =>
      request<RawAttempt>("/api/write/attempts", { method: "POST", body }).then(normalizeAttempt),
    getAttempt: (id: string) =>
      request<RawAttempt>(`/api/write/attempts/${id}`).then(normalizeAttempt),
    round2: (id: string, text: string, seconds: number) =>
      request<RawAttempt>(`/api/write/attempts/${id}/round2`, {
        method: "POST",
        body: { text, seconds },
      }).then(normalizeAttempt),
    rubric: (id: string) => request<T.Rubric>(`/api/write/attempts/${id}/rubric`),
  },
  speak: {
    tasks: async (): Promise<{ tasks: T.SpeakTaskSpec[] }> =>
      normalizeSpeakTasks(await request<RawTasks>("/api/speak/tasks")),
    attempt: (body: {
      task: string;
      subject: unknown;
      level: string;
      transcript: string;
      seconds: number;
      audio_duration: number;
    }) =>
      request<RawAttempt>("/api/speak/attempts", { method: "POST", body }).then(normalizeAttempt),
    getAttempt: (id: string) =>
      request<RawAttempt>(`/api/speak/attempts/${id}`).then(normalizeAttempt),
    round2: (id: string, body: { transcript: string; seconds: number; audio_duration: number }) =>
      request<RawAttempt>(`/api/speak/attempts/${id}/round2`, { method: "POST", body }).then(
        normalizeAttempt,
      ),
    roleplayReply: (
      scenario: Record<string, unknown>,
      history: { role: string; text: string }[],
      user_utterance: string,
    ) =>
      request<{ reply: string }>("/api/speak/roleplay/reply", {
        method: "POST",
        body: { scenario, history, user_utterance },
      }),
    rubric: (id: string) => request<T.Rubric>(`/api/speak/attempts/${id}/rubric`),
  },
  episodes: {
    list: async () => normalizeEpisodes(await request<{ episodes: RawEpisode[] }>("/api/episodes")),
    create: (body: { level?: string | undefined; minutes: number; request?: string | undefined }) =>
      request<RawEpisode>("/api/episodes", { method: "POST", body }).then(normalizeEpisode),
    remove: (id: string) => request<void>(`/api/episodes/${id}`, { method: "DELETE" }),
    audioUrl: (id: string) => `/episodes/${id}.mp3`,
    lrcUrl: (id: string) => `/episodes/${id}.lrc`,
  },

  // ---- New endpoints (C5) ----
  today: {
    get: () => request<T.Today>("/api/today", { query: { tz_offset: tzOffset() } }),
    startBlock: (id: string) =>
      request<T.Block>(`/api/today/blocks/${id}/start`, { method: "POST" }),
    finishBlock: (id: string) =>
      request<T.Block>(`/api/today/blocks/${id}/finish`, { method: "POST" }),
    skipBlock: (id: string, reason: T.SkipReason) =>
      request<T.Block>(`/api/today/blocks/${id}/skip`, { method: "POST", body: { reason } }),
    minimal: (on: boolean) =>
      request<T.Today>("/api/today/minimal", {
        method: "POST",
        body: { on, tz_offset: tzOffset() },
      }),
  },
  hours: {
    ledger: () => request<T.HoursLedger>("/api/hours/ledger", { query: { tz_offset: tzOffset() } }),
  },
  todos: {
    list: () => request<T.Todo[]>("/api/todos"),
    done: (id: string) => request<void>(`/api/todos/${id}/done`, { method: "POST" }),
  },
  reviews: {
    add: (body: T.DailyReview) => request<void>("/api/daily-reviews", { method: "POST", body }),
    get: (day: string) => request<T.DailyReview>("/api/daily-reviews", { query: { day } }),
  },
  listening: {
    createSession: (block_id?: string, source = "auto") =>
      listeningResponse("/api/listening/sessions", {
        method: "POST",
        body: { block_id, source },
      }),
    blind: (id: string, self: 0 | 1 | 2, plays: number) =>
      listeningResponse(`/api/listening/sessions/${id}/blind`, {
        method: "POST",
        body: { self, plays },
      }),
    reveal: (id: string) =>
      listeningResponse(`/api/listening/sessions/${id}/reveal`, { method: "POST" }),
    relisten: (id: string, stage: T.RateStage, index: number) =>
      listeningResponse(`/api/listening/sessions/${id}/relisten`, {
        method: "POST",
        body: { stage, index },
      }),
    check: (id: string, answer_index: number, seconds = 0) =>
      listeningResponse(`/api/listening/sessions/${id}/check`, {
        method: "POST",
        body: { answer_index, seconds, tz_offset: tzOffset() },
      }),
    addWord: (id: string, sentence: string, word: string, meaning = "") =>
      request<unknown>(`/api/listening/sessions/${id}/words`, {
        method: "POST",
        body: { sentence, word, meaning },
      }),
    gate: () => request<T.ListeningGate>("/api/listening/gate"),
  },
  reading: {
    create: (body: {
      text?: string | undefined;
      generate?: { text_type: string; level: string };
    }) => readingPassage(request<RawPassage>("/api/reading/passages", { method: "POST", body })),
    get: (id: string) => readingPassage(request<RawPassage>(`/api/reading/passages/${id}`)),
    done: (id: string, seconds: number, answers: number[]) =>
      readingPassage(
        request<RawPassage>(`/api/reading/passages/${id}/done`, {
          method: "POST",
          body: { seconds, answers, tz_offset: tzOffset() },
        }),
      ),
    addWord: (id: string, sentence: string, word: string, meaning = "") =>
      request<unknown>(`/api/reading/passages/${id}/words`, {
        method: "POST",
        body: { sentence, word, meaning },
      }),
  },
  items: {
    summary: () => request<T.ItemsSummary>("/api/items/summary"),
    list: (q: {
      skill?: string | undefined;
      pool?: string | undefined;
      page?: number | undefined;
    }) => request<{ rows: T.ItemRow[]; total: number }>("/api/items", { query: q }),
  },
  checkpoints: {
    list: () => request<T.Checkpoint[]>("/api/checkpoints"),
    decide: (id: string, decision: string, note: string) =>
      request<T.Checkpoint>(`/api/checkpoints/${id}/decision`, {
        method: "POST",
        body: { decision, note },
      }),
    exportUrl: (id: string) => `/api/checkpoints/${id}/export.md`,
  },
  phase: {
    get: () => request<T.Phase>("/api/phase"),
    put: (p: T.Phase) => request<T.Phase>("/api/phase", { method: "PUT", body: p }),
  },
};

export type Api = typeof real;

// Passage analysis is the host analyzer's wire shape, shared with /api/analyze.
type RawPassage = Omit<T.Passage, "analysis"> & { analysis: { sentences: RawAnalyzeSentence[] } };
async function readingPassage(pending: Promise<RawPassage>): Promise<T.Passage> {
  const p = await pending;
  return { ...p, analysis: normalizeAnalyze(p.analysis) };
}

async function listeningResponse(
  path: string,
  opts: Parameters<typeof request>[1],
): Promise<T.ListeningSession> {
  const s = await request<
    Omit<T.ListeningSession, "analysis"> & { analysis?: { sentences: RawAnalyzeSentence[] } | null }
  >(path, opts);
  return { ...s, analysis: s.analysis ? normalizeAnalyze(s.analysis) : null };
}
