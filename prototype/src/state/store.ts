import { useSyncExternalStore } from "react";
import {
  AI_FALLBACK,
  CACHED_KEYS,
  DEFAULT_SESSION_SIZE,
  DICTIONARY,
  HISTORY_ANALYSES,
  HISTORY_ATTEMPTS,
  HISTORY_AUDIO,
  FAVORITE_FIXTURES,
  LOOKUP_FIXTURES,
  PRESAVED_CARD_IDS,
  buildLibrary,
  buildQueue,
  type AnalysisRec,
  type AttemptRec,
  type AudioRec,
  type DictEntry,
  type LibCard,
  type LibSentence,
  type OcrLine,
  type PracticeItem,
  type ReviewCard,
  type StudySentence,
} from "../data/fixtures";
import type { GradeResult } from "../lib/grading";
import { countLookup, lookupKey, type LookupCounter } from "../lib/lookup";

/* ---------------- types ---------------- */

export type Frame = "fluid" | "iphone" | "mac";
export type Domain =
  | "signin"
  | "analysis"
  | "ocr"
  | "dictionary"
  | "ai"
  | "grammar"
  | "audio"
  | "save"
  | "grading"
  | "history"
  | "settings"
  | "sync"
  | "episodes"
  | "restore"
  | "exam"
  | "write"
  | "speak"
  | "studio"
  | "queue"
  | "clear";

export interface PlayerOwner {
  kind: "study" | "episode" | "practice" | "studio" | "exercise" | "review";
  /** Accessible, neutral title. Exercises always use "Practice audio". */
  label: string;
  route: string;
  episodeId?: string;
}
export interface PlayerState {
  id: number;
  owner: PlayerOwner;
  scope?: "all" | "sentence" | "step";
  status: "loading" | "playing" | "paused" | "ended" | "error" | "buffering";
  position: number;
  duration: number;
  speed: number;
  repeat: boolean;
  countedSeconds: number;
  /** Content time advanced in this session (position delta incl. speed). */
  contentSeconds: number;
}

export interface Attempt {
  id: string;
  sessionKey?: string;
  cleared?: boolean;
  kind: "Recall" | "Dictation";
  itemId: string;
  sentence: string;
  scope: "Whole sentence" | "Step by step";
  step?: number;
  response: string;
  hinted: boolean;
  answerKnown: boolean;
  status: "pending" | "completed";
  outcome?: "correct" | "incorrect";
  result?: GradeResult;
  history: "saving" | "saved" | "failed";
}

export interface QuestionUI {
  phase: "answering" | "submitting" | "techfail" | "graded";
  hint: boolean;
  revealed: boolean;
  attemptId?: string;
  emptyError?: boolean;
  revealedAfter?: boolean;
}
export interface ExerciseSession {
  key: string;
  kind: "Recall" | "Dictation";
  source: string;
  items: PracticeItem[];
  index: number;
  mode: "whole" | "step";
  steps: Record<number, number>;
  drafts: Record<string, string>;
  ui: Record<string, QuestionUI>;
  done: boolean;
  modeNotice?: string;
  audio: "idle" | "error";
}

export interface ReviewUI {
  draft: string;
  phase: "answering" | "submitting" | "techfail" | "graded";
  hint: boolean;
  revealed: boolean;
  recorded?: boolean;
  selfCheck?: boolean;
  emptyError?: boolean;
  result?: GradeResult;
  answerKnown?: boolean;
  hinted?: boolean;
}

export interface MasteryAction {
  id: string;
  cardId: string;
  at: number; // clock() time of the mastery action; the Undo window is measured from here
  state: "active" | "undone" | "expired" | "queued" | "syncing" | "conflict";
  undoAt?: number;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  text: string;
}

export interface AppState {
  auth: "in" | "out";
  signIn: "idle" | "pending" | "error";
  returnTo: string;
  route: string;
  frame: Frame;
  macWidth: number;
  offline: boolean;
  sync: "synced" | "pending" | "error";
  failNext: Partial<Record<Domain, boolean>>;
  slowNext: Partial<Record<Domain, boolean>>;
  ss: Record<string, string>;
  demoOpen: boolean;
  menuOpen: boolean;
  announce: { msg: string; n: number; assertive?: boolean };
  toasts: Toast[];

  study: {
    mode: "text" | "ideas";
    drafts: { text: string; ideas: string };
    restored: boolean;
    analysis: {
      status: "idle" | "running" | "long" | "failed" | "cancelled" | "nofrench" | "invalid" | "done";
      runId: number;
      input: string;
      stage: number;
      source: AnalysisRec["source"];
    };
    sentences: StudySentence[];
    index: number;
    tab: "steps" | "grammar" | "recall" | "dictation";
    step: number;
    sourceOpen: boolean;
    ocr: {
      phase: "select" | "processing" | "failed" | "cancelled" | "none" | "results";
      photoId?: string;
      lines: (OcrLine & { selected: boolean })[];
      partial: boolean;
    };
  };

  player: PlayerState | null;
  lastPlaybackNotice?: string;

  lookups: Record<string, LookupCounter>;
  favorites: Record<string, boolean>;
  snapshots: Record<string, DictEntry>;
  ctxSnapshots: Record<string, string>;

  saved: Record<string, boolean>;
  sentences: LibSentence[];
  cards: LibCard[];
  libFilters: { q: string; savedOnly: boolean; mastered: "hide" | "show" | "only"; minImportance: 0 | 3 | 4 | 5; favoritesOnly: boolean };

  queue: ReviewCard[];
  review: {
    phase: "summary" | "active" | "complete";
    index: number;
    completed: number;
    introduced: Record<string, boolean>;
    /** Cards finished in any session today; they are not planned into later sessions. */
    done: Record<string, boolean>;
    /** New cards removed from the locked session because the daily limit was lowered. */
    removedNew: number;
    allowance: number;
    sessionCards: ReviewCard[] | null;
  };
  reviewUi: Record<string, ReviewUI>;
  dailyNew: number;
  newUsed: number;
  /** Cards per review session (10–300). Changing it never alters a session that is already locked. */
  sessionSize: number;

  mastery: MasteryAction[];

  exercises: Record<string, ExerciseSession>;
  attempts: Attempt[];
  /** Session key of the independent Recall/Dictation run currently open. */
  activeRun: string | null;

  history: { analyses: AnalysisRec[]; audio: AudioRec[]; attempts: AttemptRec[] };
  audioStats: { todaySeconds: number; weekSeconds: number; lifetimeHours: number; last28Hours: number };

  settings: { speed: number; repeat: boolean; timezone: string };
  episodePositions: Record<string, number>;
  /** Generic preserved drafts (Practice writing, Audio Studio, exam writing…). */
  drafts: Record<string, string>;

  exam: ExamState;
}

export type ExamSection = "listening" | "reading" | "writing" | "speaking";
export interface ExamState {
  mode: "practice" | "section" | "full";
  section: ExamSection;
  timed: boolean;
  startedAt: number | null;
  budgetSeconds: number;
  demoPausedAt: number | null;
  pausedTotal: number;
  answers: Record<string, number>;
  writing: Record<string, string>;
  writingSave: Record<string, "saved" | "saving" | "failed">;
  speakingStage: number;
  recordings: Record<string, "none" | "recording" | "recorded" | "failed">;
  phase: "intro" | "running" | "transition" | "submitting" | "submitfail" | "results" | "timeout";
  leftAt: number | null;
  resumedNotice: boolean;
  qIndex: number;
  missedRetry: string | null;
  practiceResults: ExamResult[];
  mockResults: ExamResult[];
  sectionStartedAt: number | null;
}

export interface ExamResult {
  id: string;
  mode: "practice" | "section" | "full";
  timedOut: boolean;
  sections: { key: ExamSection; name: string; correct?: number; answered?: number; sample?: number; unfilled?: number; missed: string[]; qualitative?: string }[];
}

/* ---------------- initial state ---------------- */

function initialState(): AppState {
  const { sentences, cards } = buildLibrary();
  const lookups: Record<string, LookupCounter> = {};
  for (const [k, count] of Object.entries(LOOKUP_FIXTURES)) lookups[k] = { count, lastCounted: null };
  const snapshots: Record<string, DictEntry> = {};
  for (const k of CACHED_KEYS) snapshots[k] = DICTIONARY[k];
  const saved: Record<string, boolean> = {};
  for (const id of PRESAVED_CARD_IDS) saved[id] = true;
  return {
    auth: "in",
    signIn: "idle",
    returnTo: "study",
    route: "study",
    frame: "fluid",
    macWidth: 1080,
    offline: false,
    sync: "synced",
    failNext: {},
    slowNext: {},
    ss: {},
    demoOpen: false,
    menuOpen: false,
    announce: { msg: "", n: 0 },
    toasts: [],
    study: {
      mode: "text",
      drafts: { text: "", ideas: "" },
      restored: false,
      analysis: { status: "idle", runId: 0, input: "", stage: 0, source: "Pasted text" },
      sentences: [],
      index: 0,
      tab: "steps",
      step: 0,
      sourceOpen: false,
      ocr: { phase: "select", lines: [], partial: false },
    },
    player: null,
    lookups,
    favorites: { ...FAVORITE_FIXTURES },
    snapshots,
    ctxSnapshots: {},
    saved,
    sentences,
    cards,
    libFilters: { q: "", savedOnly: false, mastered: "hide", minImportance: 0, favoritesOnly: false },
    queue: buildQueue(sentences, cards, lookups),
    review: { phase: "summary", index: 0, completed: 0, introduced: {}, done: {}, removedNew: 0, allowance: 31, sessionCards: null },
    reviewUi: {},
    dailyNew: 40,
    newUsed: 0,
    sessionSize: DEFAULT_SESSION_SIZE,
    mastery: [],
    exercises: {},
    attempts: [],
    activeRun: null,
    history: { analyses: HISTORY_ANALYSES, audio: HISTORY_AUDIO, attempts: HISTORY_ATTEMPTS },
    audioStats: { todaySeconds: 18 * 60, weekSeconds: 3 * 3600 + 25 * 60, lifetimeHours: 125, last28Hours: 14 },
    settings: { speed: 1, repeat: false, timezone: "America/Toronto" },
    episodePositions: {},
    drafts: {},
    exam: initialExam(),
  };
}

export function initialExam(): ExamState {
  return {
    mode: "practice",
    section: "listening",
    timed: false,
    startedAt: null,
    budgetSeconds: 0,
    demoPausedAt: null,
    pausedTotal: 0,
    answers: {},
    writing: {},
    writingSave: {},
    speakingStage: 0,
    recordings: {},
    phase: "intro",
    leftAt: null,
    resumedNotice: false,
    qIndex: 0,
    missedRetry: null,
    practiceResults: [],
    mockResults: [],
    sectionStartedAt: null,
  };
}

/* ---------------- store ---------------- */

let state: AppState = initialState();
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(fn: (s: AppState) => Partial<AppState>) {
    state = { ...state, ...fn(state) };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export const set = store.set;
export const get = store.get;

export function patchStudy(p: Partial<AppState["study"]>) {
  set((s) => ({ study: { ...s.study, ...p } }));
}

/* ---------------- routing ---------------- */

const LEGACY = ["app", "coach", "learn", "exams", "homework", "cards", "cockpit"];

export function parseHash(): string {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return "study";
  const top = raw.split("/")[0];
  if (LEGACY.includes(top)) return "moved";
  return raw;
}

export function go(route: string, opts: { focus?: boolean; keepDemo?: boolean } = {}) {
  set((s) => {
    // Leaving a running timed exam keeps the timer running (demo rule).
    const leavingExam = s.route.startsWith("practice/exams/run") && !route.startsWith("practice/exams/run");
    const exam = leavingExam && s.exam.phase === "running" && s.exam.timed ? { ...s.exam, leftAt: Date.now() } : s.exam;
    const leavingStudy = s.route.startsWith("study") && !route.startsWith("study");
    const hasDraft = !!(s.study.drafts.text.trim() || s.study.drafts.ideas.trim());
    const study = leavingStudy && hasDraft && s.study.analysis.status !== "done" ? { ...s.study, restored: true } : s.study;
    // Ordinary navigation clears any state forced from the Demo states navigator.
    return { route, menuOpen: false, exam, study, ss: opts.keepDemo ? s.ss : {} };
  });
  if (location.hash !== "#/" + route) history.pushState(null, "", "#/" + route);
  if (opts.focus !== false) focusHeading();
}

export function focusHeading() {
  requestAnimationFrame(() => {
    const h = document.querySelector<HTMLElement>("[data-page-title]");
    h?.focus({ preventScroll: false });
  });
}

/* ---------------- announcements & toasts ---------------- */

export function announce(msg: string, assertive = false) {
  set((s) => ({ announce: { msg, n: s.announce.n + 1, assertive } }));
}

let toastId = 0;
export function toast(text: string, kind: Toast["kind"] = "info") {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
}

/* ---------------- simulation ---------------- */

export class SimError extends Error {
  constructor(public reason: "failed" | "offline" = "failed") {
    super(reason);
  }
}

/** Resolves after a delay unless the demo is offline or a one-shot failure is armed for the domain. */
export function simulate<T>(domain: Domain, ms: number, value: T, opts: { needsNetwork?: boolean } = {}): Promise<T> {
  const s = get();
  const fail = s.failNext[domain];
  const slow = s.slowNext[domain];
  if (fail || slow) set((st) => ({ failNext: { ...st.failNext, [domain]: false }, slowNext: { ...st.slowNext, [domain]: false } }));
  const epoch = demoEpoch;
  return new Promise((resolve, reject) => {
    setTimeout(
      () => {
        if (epoch !== demoEpoch) return;
        if (opts.needsNetwork !== false && get().offline) return reject(new SimError("offline"));
        if (fail) return reject(new SimError("failed"));
        resolve(value);
      },
      slow ? ms + 9000 : ms,
    );
  });
}

export function armFailure(domain: Domain) {
  set((s) => ({ failNext: { ...s.failNext, [domain]: true } }));
}
export function armSlow(domain: Domain) {
  set((s) => ({ slowNext: { ...s.slowNext, [domain]: true } }));
}

export function setScreen(id: string, value: string) {
  set((s) => ({ ss: { ...s.ss, [id]: value } }));
}
export function clearScreen(id: string) {
  set((s) => {
    const ss = { ...s.ss };
    delete ss[id];
    return { ss };
  });
}

/** Simulated sync of a change. Respects offline / delayed / error demo flags. */
export function syncChange() {
  const s = get();
  if (s.offline) {
    set(() => ({ sync: "pending" }));
    return;
  }
  set(() => ({ sync: "pending" }));
  simulate("sync", s.slowNext.sync ? 0 : 900, true)
    .then(() => set(() => ({ sync: "synced" })))
    .catch(() => set(() => ({ sync: "error" })));
}

export function setOffline(offline: boolean) {
  set((s) => ({ offline, sync: offline ? (s.sync === "error" ? "error" : "pending") : s.sync }));
  announce(offline ? "Simulated offline mode on." : "Simulated connection restored.");
  if (!offline) {
    // Flush queued Undo actions.
    const queued = get().mastery.filter((m) => m.state === "queued");
    if (queued.length) {
      set((s) => ({ mastery: s.mastery.map((m) => (m.state === "queued" ? { ...m, state: "syncing" } : m)) }));
      setTimeout(() => {
        set((s) => ({ mastery: s.mastery.map((m) => (m.state === "syncing" ? { ...m, state: "undone" } : m)) }));
        announce("Queued Undo synced. It was on time.");
      }, 1200);
    }
    syncChange();
  }
}

let demoEpoch = 0;
export function resetDemo() {
  demoEpoch++;
  const keep = get();
  state = { ...initialState(), frame: keep.frame, macWidth: keep.macWidth, route: "study" };
  listeners.forEach((l) => l());
  history.replaceState(null, "", "#/study");
  announce("Demo reset. Fictional session data restored to the starting point.");
}

/* ---------------- lookups & word-keyed card state ---------------- */

export function recordLookup(entry: string, nowSec = performance.now() / 1000): { counted: boolean; count: number } {
  const key = lookupKey(entry);
  const prev = get().lookups[key] ?? { count: 0, lastCounted: null };
  const { next, counted } = countLookup(prev, nowSec);
  if (counted) set((s) => ({ lookups: { ...s.lookups, [key]: next } }));
  return { counted, count: next.count };
}

/** Word cards (Fill-in) share lookup count and favorite state with the word popup via lookupKey(word). */
export function getCardWordKey(c: Pick<LibCard, "kind" | "word">): string | null {
  return c.kind === "Fill-in" && c.word ? lookupKey(c.word) : null;
}

export function getCardLookups(s: Pick<AppState, "lookups">, c: Pick<LibCard, "kind" | "word">): number | null {
  const k = getCardWordKey(c);
  return k !== null ? (s.lookups[k]?.count ?? 0) : null;
}

export function isCardFavorite(s: Pick<AppState, "favorites">, c: Pick<LibCard, "id" | "kind" | "word">): boolean {
  const k = getCardWordKey(c);
  return k !== null ? Boolean(s.favorites[k]) : Boolean(s.favorites[`card:${c.id}`]);
}

export function toggleCardFavorite(c: Pick<LibCard, "id" | "kind" | "word">) {
  const k = getCardWordKey(c) ?? `card:${c.id}`;
  const next = !get().favorites[k];
  set((s) => ({ favorites: { ...s.favorites, [k]: next } }));
  announce(
    next
      ? "Added to favorites. Lookup count and importance are unchanged."
      : "Removed from favorites. Lookup count and importance are unchanged.",
  );
}

export function dictionaryFor(entry: string): DictEntry | undefined {
  return DICTIONARY[lookupKey(entry)];
}
export function aiFor(entry: string): string {
  return (
    AI_FALLBACK[lookupKey(entry)] ??
    `In this sentence, “${entry}” is explained by a simulated AI fallback. This text is demo content, not a real explanation.`
  );
}

/** Saves a valid definition snapshot. Errors, empty or pending text are never stored. */
export function saveSnapshot(entry: DictEntry, sentenceId: string) {
  const key = lookupKey(entry.entry);
  if (!entry.main.trim() || !entry.dictionary.trim()) return;
  set((s) => ({
    snapshots: { ...s.snapshots, [key]: entry },
    ctxSnapshots: entry.context[sentenceId] ? { ...s.ctxSnapshots, [`${key}|${sentenceId}`]: entry.context[sentenceId] } : s.ctxSnapshots,
  }));
}

/* ---------------- playback ---------------- */

let playerSeq = 0;

export function startPlayback(owner: PlayerOwner, duration: number, opts: { scope?: PlayerState["scope"]; position?: number; speed?: number } = {}) {
  const prev = get().player;
  if (prev) commitAudio(prev);
  const id = ++playerSeq;
  lastTick = performance.now();
  set((s) => ({
    player: {
      id,
      owner,
      scope: opts.scope,
      status: "loading",
      position: opts.position ?? 0,
      duration,
      speed: opts.speed ?? s.settings.speed,
      repeat: s.settings.repeat,
      countedSeconds: 0,
      contentSeconds: 0,
    },
    lastPlaybackNotice: prev ? "Previous playback stopped." : undefined,
  }));
  if (prev) announce("Previous playback stopped.");
  simulate("audio", 700, true)
    .then(() => {
      if (get().player?.id !== id) return;
      lastTick = performance.now();
      updatePlayer({ status: "playing" });
      announce(`Playing ${owner.label}. Simulated audio.`);
    })
    .catch(() => {
      if (get().player?.id !== id) return;
      updatePlayer({ status: "error" });
      announce("Simulated audio could not play.", true);
    });
}

export function updatePlayer(p: Partial<PlayerState>) {
  lastTick = performance.now();
  set((s) => (s.player ? { player: { ...s.player, ...p } } : {}));
}

export function retryPlayback() {
  const p = get().player;
  if (!p) return;
  startPlayback(p.owner, p.duration, { scope: p.scope, position: p.position, speed: p.speed });
}

export function stopPlayback() {
  const p = get().player;
  if (!p) return;
  commitAudio(p);
  set(() => ({ player: null }));
  announce("Playback stopped.");
}

/** Records the session's counted time in Audio activity history and remembers episode positions. */
function commitAudio(p: PlayerState) {
  if (p.owner.episodeId) set((s) => ({ episodePositions: { ...s.episodePositions, [p.owner.episodeId!]: p.position } }));
  if (p.countedSeconds < 1) return;
  const rec: AudioRec = {
    id: `u-live-${p.id}`,
    date: "Mar 4",
    owner: ownerHistoryLabel(p.owner),
    contentSeconds: Math.round(p.contentSeconds),
    speed: p.speed,
    countedSeconds: Math.round(p.countedSeconds),
  };
  set((s) => ({ history: { ...s.history, audio: [rec, ...s.history.audio] } }));
}

function ownerHistoryLabel(o: PlayerOwner) {
  const map: Record<PlayerOwner["kind"], string> = {
    study: "Study · Sentence playback",
    episode: `Episode · ${o.label.replace(/^Episode: /, "")}`,
    practice: "Practice · Listen",
    studio: "Audio Studio · Prepared text",
    exercise: "Practice audio",
    review: "Review · Card audio",
  };
  return map[o.kind];
}

/** Advances the single simulated playback session. Only foreground playing time counts toward the goal. */
let lastTick = performance.now();
export function resetPlaybackClock() {
  lastTick = performance.now();
}

export function tick(dtOverride?: number) {
  const now = performance.now();
  const rawDt = dtOverride ?? Math.min(1, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  // Foreground-only counting: while the browser tab is hidden, keep position and add zero counted time.
  if (typeof document !== "undefined" && document.hidden) return;
  const p = get().player;
  if (!p || p.status !== "playing" || rawDt <= 0) return;
  const dt = rawDt;
  let position = p.position + dt * p.speed;
  let status: PlayerState["status"] = "playing";
  if (position >= p.duration) {
    if (p.repeat) position = 0;
    else {
      position = p.duration;
      status = "ended";
      announce("Playback ended.");
    }
  }
  const dh = dt / 3600;
  set((s) => ({
    player: { ...p, position, status, countedSeconds: p.countedSeconds + dt, contentSeconds: p.contentSeconds + dt * p.speed },
    audioStats: {
      todaySeconds: s.audioStats.todaySeconds + dt,
      weekSeconds: s.audioStats.weekSeconds + dt,
      lifetimeHours: s.audioStats.lifetimeHours + dh,
      last28Hours: s.audioStats.last28Hours + dh,
    },
  }));
}

/** Records a simulated foreground playback block (e.g. 10 content minutes at 2× = 5 counted minutes) across all four totals. */
export function recordSimulatedAudio(contentSeconds: number, speed: number, owner = "Episode · Un samedi au marché"): number {
  if (typeof document !== "undefined" && document.hidden) return 0;
  const countedSeconds = contentSeconds / speed;
  const dh = countedSeconds / 3600;
  set((s) => ({
    audioStats: {
      todaySeconds: s.audioStats.todaySeconds + countedSeconds,
      weekSeconds: s.audioStats.weekSeconds + countedSeconds,
      lifetimeHours: s.audioStats.lifetimeHours + dh,
      last28Hours: s.audioStats.last28Hours + dh,
    },
    history: {
      ...s.history,
      audio: [
        {
          id: `u-demo-${Date.now()}`,
          date: "Mar 4",
          owner,
          contentSeconds: Math.round(contentSeconds),
          speed,
          countedSeconds: Math.round(countedSeconds),
        },
        ...s.history.audio,
      ],
    },
  }));
  return countedSeconds;
}

/* ---------------- mastery ---------------- */

export const UNDO_MS = 6000;
let masterySeq = 0;

/** Injectable clock so tests (and the Shell's Undo countdown) share one time source with the mastery actions. */
let clock: () => number = () => Date.now();
export function setClock(fn: (() => number) | null) {
  clock = fn ?? (() => Date.now());
}
export const nowMs = () => clock();

/** Transitions any active mastery actions whose 6-second window (measured from m.at) has elapsed to "expired". */
export function expireMastery(now = clock()) {
  if (!get().mastery.some((m) => m.state === "active" && now - m.at >= UNDO_MS)) return;
  set((s) => ({
    mastery: s.mastery.map((m) => (m.state === "active" && now - m.at >= UNDO_MS ? { ...m, state: "expired" } : m)),
  }));
}

export function markMastered(cardId: string, now = clock()): string {
  expireMastery(now);
  const id = `m-${now}-${++masterySeq}`;
  set((s) => ({
    cards: s.cards.map((c) => (c.id === cardId ? { ...c, mastered: true } : c)),
    mastery: [...s.mastery, { id, cardId, at: now, state: "active" }],
  }));
  announce("Card marked mastered and hidden from your default review. Undo is available for 6 seconds.");
  syncChange();
  return id;
}

export function undoMastery(actionId: string, now = clock()): boolean {
  expireMastery(now);
  const a = get().mastery.find((m) => m.id === actionId);
  if (!a) return false;
  const timely = now - a.at < UNDO_MS;
  if (!timely || a.state === "expired") {
    set((s) => ({ mastery: s.mastery.map((m) => (m.id === actionId ? { ...m, state: "expired" } : m)) }));
    return false;
  }
  if (a.state !== "active") return false;
  // Undo only reverses its own mastery action.
  set((s) => ({ cards: s.cards.map((c) => (c.id === a.cardId ? { ...c, mastered: false } : c)) }));
  if (get().offline) {
    set((s) => ({ mastery: s.mastery.map((m) => (m.id === actionId ? { ...m, state: "queued", undoAt: now } : m)) }));
    announce("Undo saved on this device. It will sync when you are back online and still counts as on time.");
    return true;
  }
  set((s) => ({ mastery: s.mastery.map((m) => (m.id === actionId ? { ...m, state: "undone", undoAt: now } : m)) }));
  announce("Undo applied. The card is back in your default review.");
  syncChange();
  return true;
}

export function restoreCard(cardId: string) {
  set((s) => ({ cards: s.cards.map((c) => (c.id === cardId ? { ...c, mastered: false } : c)) }));
}

/* ---------------- review quota ---------------- */

/**
 * Keeps the locked session honest about allowances: only the next `remaining` not-yet-shown new cards may stay.
 * Shown cards (introduced) always stay. Returns how many new cards were removed.
 */
function trimUnshownNewCards(): number {
  const s = get();
  const cards = s.review.sessionCards;
  if (!cards) return 0;
  let room = Math.max(0, s.dailyNew - s.newUsed);
  const kept = cards.filter((c) => {
    if (c.group !== "new" || s.review.introduced[c.id]) return true;
    if (room > 0) {
      room--;
      return true;
    }
    return false;
  });
  const removed = cards.length - kept.length;
  if (removed) {
    set((st) => ({ review: { ...st.review, sessionCards: kept, removedNew: st.review.removedNew + removed } }));
    announce(`${removed} new ${removed === 1 ? "card" : "cards"} removed because you lowered today’s limit.`);
  }
  return removed;
}

export function setDailyNew(n: number) {
  set(() => ({ dailyNew: n }));
  trimUnshownNewCards();
}

/** Applies from the next session; a locked session keeps its cards. */
export function setSessionSize(n: number) {
  set(() => ({ sessionSize: n }));
}

/** First introduction of a new card uses exactly one allowance. With none left the card is removed instead of shown. */
export function introduceNewCard(cardId: string) {
  const s = get();
  if (s.review.introduced[cardId]) return;
  if (s.newUsed >= s.dailyNew) {
    trimUnshownNewCards();
    return;
  }
  set((st) => ({ review: { ...st.review, introduced: { ...st.review.introduced, [cardId]: true } }, newUsed: st.newUsed + 1 }));
}

/* ---------------- history ---------------- */

export function clearAttemptHistory() {
  set((s) => ({
    history: { ...s.history, attempts: [] },
    // Existing attempts stay on screen so any open feedback remains visible, but are marked cleared
    // so new session summaries and History counts start from zero unless a failed save is retried.
    attempts: s.attempts.map((a) => ({ ...a, cleared: true })),
  }));
}

export function attemptToRecord(a: Attempt): AttemptRec {
  return {
    id: a.id,
    date: "Mar 4",
    kind: a.kind,
    sentence: a.sentence,
    scope: a.scope,
    step: a.step,
    state: a.status,
    outcome: a.outcome,
    hinted: a.hinted,
    answerKnown: a.answerKnown,
    response: a.response,
    saved: a.history === "failed" ? "failed" : "saved",
  };
}
