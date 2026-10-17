// Real adapter: calls the FastAPI backend at /api on the same origin.
import { request, tzOffset } from "./client";
import type * as T from "./types";

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
    deleteLog: (id: string) =>
      request<void>(`/api/game/log/${id}`, { method: "DELETE", query: { tz_offset: tzOffset() } }),
    familyDay: (on: boolean) =>
      request<void>("/api/game/family-day", {
        method: "POST",
        body: { on, tz_offset: tzOffset() },
      }),
  },
  srs: {
    queue: (
      opts: {
        new_limit?: number | undefined;
        min_importance?: number | undefined;
        modes?: string | undefined;
      } = {},
    ) =>
      request<T.SrsQueue>("/api/srs/queue", {
        query: {
          tz_offset: tzOffset(),
          new_limit: opts.new_limit,
          min_importance: opts.min_importance,
          modes: opts.modes,
        },
      }),
    review: (
      id: string,
      rating: 1 | 2 | 3 | 4,
      duration_ms?: number | undefined,
      score?: number | undefined,
      answer?: string,
    ) =>
      request<T.SrsCard & { game: unknown }>(`/api/srs/cards/${id}/review`, {
        method: "POST",
        body: { rating, duration_ms, score, answer, tz_offset: tzOffset() },
      }),
    practice: (card_ids: string[]) =>
      request<{ cards: T.SrsCard[] }>("/api/srs/practice", { method: "POST", body: { card_ids } }),
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
    uploadRecording: (id: string, kind: "first" | "final", audio: Blob, duration: number) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("duration", String(duration));
      form.set("audio", audio, `recording.${audio.type.includes("mp4") ? "mp4" : "webm"}`);
      return request<T.Journal>(`/api/homework/${id}/recordings`, { method: "POST", form });
    },
    finish: (id: string, reflection: string, recalled: boolean) =>
      request<T.Journal>(`/api/homework/${id}/finish`, {
        method: "POST",
        body: { reflection, recalled },
      }),
    archiveUrl: (id: string) => `/api/homework/${id}/archive`,
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
    ttsUrl: (text: string, voice = "fr-FR-DeniseNeural") =>
      `/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`,
    transcribe: async (audio: Blob, language = "fr") => {
      const form = new FormData();
      form.set("audio", audio, "audio.webm");
      return request<{ text: string }>(`/api/transcribe`, {
        method: "POST",
        form,
        query: { language },
      });
    },
  },
  analyze: {
    text: (text: string) =>
      request<T.AnalyzeResult>("/api/analyze", { method: "POST", body: { text } }),
    lookup: (word: string) => request<unknown>("/api/lookup", { query: { word } }),
  },
  write: {
    tasks: () => request<{ tasks: T.WriteTaskSpec[]; recommended?: unknown }>("/api/write/tasks"),
    subject: (task: string, level: string, theme?: string) =>
      request<unknown>("/api/write/subject", { method: "POST", body: { task, level, theme } }),
    attempt: (body: {
      task: string;
      subject: unknown;
      level: string;
      text: string;
      seconds: number;
    }) => request<T.Attempt>("/api/write/attempts", { method: "POST", body }),
    getAttempt: (id: string) => request<T.Attempt>(`/api/write/attempts/${id}`),
    round2: (id: string, text: string, seconds: number) =>
      request<T.Attempt>(`/api/write/attempts/${id}/round2`, {
        method: "POST",
        body: { text, seconds },
      }),
    rubric: (id: string) => request<T.Rubric>(`/api/write/attempts/${id}/rubric`),
  },
  speak: {
    tasks: () => request<{ tasks: unknown[] }>("/api/speak/tasks"),
    attempt: (body: {
      task: string;
      subject: unknown;
      level: string;
      transcript: string;
      seconds: number;
      audio_duration: number;
    }) => request<T.Attempt>("/api/speak/attempts", { method: "POST", body }),
    getAttempt: (id: string) => request<T.Attempt>(`/api/speak/attempts/${id}`),
    round2: (id: string, body: { transcript: string; seconds: number; audio_duration: number }) =>
      request<T.Attempt>(`/api/speak/attempts/${id}/round2`, { method: "POST", body }),
    roleplayReply: (
      scenario: string,
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
    list: () => request<T.Episode[]>("/api/episodes"),
    create: (body: { level?: string | undefined; minutes: number; request?: string | undefined }) =>
      request<T.Episode>("/api/episodes", { method: "POST", body }),
    remove: (id: string) => request<void>(`/api/episodes/${id}`, { method: "DELETE" }),
    audioUrl: (id: string) => `/episodes/${id}.mp3`,
    lrcUrl: (id: string) => `/episodes/${id}.lrc`,
  },
  humanScores: {
    add: (body: {
      attempt_type: "writing" | "speaking";
      attempt_id: string;
      grader: string;
      dims?: unknown;
      score: number;
      note?: string | undefined;
    }) => request<void>("/api/human-scores", { method: "POST", body }),
    calibration: (type: "writing" | "speaking") =>
      request<T.Calibration>("/api/calibration", { query: { type } }),
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
      request<T.Today>("/api/today/minimal", { method: "POST", body: { on } }),
  },
  hours: {
    ledger: () => request<T.HoursLedger>("/api/hours/ledger", { query: { tz_offset: tzOffset() } }),
  },
  todos: {
    list: () => request<T.Todo[]>("/api/todos"),
    done: (id: string) => request<void>(`/api/todos/${id}/done`, { method: "POST" }),
  },
  tutor: {
    sessions: () => request<T.TutorSession[]>("/api/tutor/sessions"),
    addSession: (body: {
      day: string;
      minutes: number;
      tutor?: string | undefined;
      topics?: string | undefined;
      homework?: string | undefined;
      cost?: number | undefined;
    }) => request<T.TutorSession>("/api/tutor/sessions", { method: "POST", body }),
  },
  reviews: {
    add: (body: T.DailyReview) => request<void>("/api/daily-reviews", { method: "POST", body }),
    get: (day: string) => request<T.DailyReview>("/api/daily-reviews", { query: { day } }),
  },
  listening: {
    createSession: (block_id?: string) =>
      request<T.ListeningSession>("/api/listening/sessions", {
        method: "POST",
        body: { block_id },
      }),
    blind: (id: string, self: 0 | 1 | 2, plays: number) =>
      request<T.ListeningSession>(`/api/listening/sessions/${id}/blind`, {
        method: "POST",
        body: { self, plays },
      }),
    reveal: (id: string) =>
      request<T.ListeningSession>(`/api/listening/sessions/${id}/reveal`, { method: "POST" }),
    relisten: (id: string, stage: T.RateStage) =>
      request<T.ListeningSession>(`/api/listening/sessions/${id}/relisten`, {
        method: "POST",
        body: { stage },
      }),
    check: (id: string, answer_index: number) =>
      request<T.ListeningSession>(`/api/listening/sessions/${id}/check`, {
        method: "POST",
        body: { answer_index },
      }),
    gate: () => request<T.ListeningGate>("/api/listening/gate"),
  },
  reading: {
    create: (body: {
      text?: string | undefined;
      generate?: { text_type: string; level: string };
    }) => request<T.Passage>("/api/reading/passages", { method: "POST", body }),
    get: (id: string) => request<T.Passage>(`/api/reading/passages/${id}`),
    done: (id: string, seconds: number) =>
      request<void>(`/api/reading/passages/${id}/done`, { method: "POST", body: { seconds } }),
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
