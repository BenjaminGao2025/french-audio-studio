/*
 * Study time toward 1,000 hours, the same rules as the old pages (static/game.js + media-time.js):
 * - a page counts while it is being used (visible, input in the last 2 minutes) under its lane:
 *   Study = reading, Review = review, Write = writing, Speak = speaking;
 * - audio counts while it really plays (also with the tab hidden or the phone locked): the seconds
 *   are read from how far the audio moved, divided by the speed, so 10 min at 2× counts 5 min;
 * - one second is counted once: a beat credits the larger of page time and audio time.
 * Seconds are sent to /api/game/heartbeat in chunks of at most 120 s; a failed send keeps them.
 */
import { apiFetch } from "./client";
import { get } from "../state/store";
import type { PlayerOwner } from "../state/store";

export type Lane = "listening" | "reading" | "speaking" | "writing" | "review" | "car";

export const IDLE_MS = 120_000;
const BEAT_MS = 5_000;
const FLUSH_SECONDS = 30;
const MAX_CHUNK = 120;

const tz = () => new Date().getTimezoneOffset();

/** The lane a screen's own use counts under; null for screens that only count their audio. */
export function laneForRoute(route: string): Lane | null {
  const r = route.split("?")[0];
  // Homework records its speaking time through /api/homework; page time would double-count it.
  if (r === "study/personal") return null;
  if (r === "study" || r.startsWith("study/")) return "reading";
  if (r === "review" || r.startsWith("review/")) return "review";
  if (r.startsWith("practice/write")) return "writing";
  if (r.startsWith("practice/speak")) return "speaking";
  return null;
}

/** Episodes are the listen-anywhere (car, walk) programme: half weight in XP, as on the old /listen. */
export function laneForAudio(owner: PlayerOwner, route: string): Lane {
  if (owner.kind === "episode") return "car";
  return laneForRoute(route) ?? "listening";
}

export interface Beat {
  /** Wall-clock seconds since the last beat. */
  wall: number;
  /** Seconds the audio really moved since its last reading, already divided by speed (0 when not playing). */
  audio: number;
  /** Wall-clock seconds since that reading (longer than `wall` when timers were frozen, e.g. a locked phone). */
  audioWall: number;
  active: boolean;
}

/** Seconds a beat earns: the larger of page time and audio time, never their sum. Large gaps are not page use. */
export function creditFor(b: Beat): number {
  const page = b.active ? Math.min(b.wall, (BEAT_MS / 1000) * 2) : 0;
  const audio = b.audio > 0 && b.audio <= b.audioWall + 2 ? b.audio : 0; // a bigger jump is a seek
  return Math.max(page, audio);
}

const pending: Partial<Record<Lane, number>> = {};
let flushing: Promise<void> | null = null;
let listeners = new Set<() => void>();

export const pendingSeconds = () => Object.values(pending).reduce((a, b) => a + (b ?? 0), 0);
/** Seconds sent since the page loaded, so Progress can add them without refetching. */
export let sentSeconds = 0;

export function onTimeSent(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addSeconds(lane: Lane, seconds: number) {
  if (seconds <= 0) return;
  pending[lane] = (pending[lane] ?? 0) + seconds;
  if (pendingSeconds() >= FLUSH_SECONDS) void flush();
}

export function flush(keepalive = false): Promise<void> {
  flushing ??= (async () => {
    try {
      for (const lane of Object.keys(pending) as Lane[]) {
        const whole = Math.floor(pending[lane] ?? 0);
        for (let sent = 0; sent < whole; sent += MAX_CHUNK) {
          const chunk = Math.min(MAX_CHUNK, whole - sent);
          try {
            await apiFetch("/api/game/heartbeat", { body: { lane, seconds: chunk, tz_offset: tz() }, keepalive, noAuthRedirect: true });
          } catch {
            return; // keep them; the next beat retries
          }
          pending[lane] = Math.max(0, (pending[lane] ?? 0) - chunk);
          sentSeconds += chunk;
          listeners.forEach((fn) => fn());
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

let lastActivity = 0;
let lastBeat = 0;
let lastAudio: { id: number; position: number; at: number } | null = null;

/** Called on every beat and on visibility changes. `now` is injectable for tests. */
export function beat(now = Date.now()) {
  const wall = Math.max(0, (now - lastBeat) / 1000);
  lastBeat = now;
  const s = get();
  const p = s.player;
  let audio = 0;
  let audioWall = wall;
  if (p && lastAudio?.id === p.id) {
    audio = Math.max(0, p.position - lastAudio.position) / (p.speed || 1);
    audioWall = Math.max(0, (now - lastAudio.at) / 1000);
  } else if (p?.startPosition !== undefined) {
    // First beat of a new playback: it started after the last beat, so count from where it started.
    audio = Math.max(0, p.position - p.startPosition) / (p.speed || 1);
  }
  // Keep the reading while the position stands still: after a frozen stretch the audio may report its
  // progress only after this beat, and the next beat must still see the time it took.
  if (!p) lastAudio = null;
  else if (lastAudio?.id !== p.id || p.position !== lastAudio.position) lastAudio = { id: p.id, position: p.position, at: now };
  const pageLane = laneForRoute(s.route);
  const active = Boolean(pageLane) && !document.hidden && now - lastActivity < IDLE_MS;
  const credit = creditFor({ wall, audio, audioWall, active });
  if (credit <= 0) return;
  addSeconds(audio >= credit && p ? laneForAudio(p.owner, s.route) : pageLane ?? "listening", credit);
}

/** A seek must not count as listening: forget the audio's last position. */
export function audioJumped() {
  const p = get().player;
  lastAudio = p ? { id: p.id, position: p.position, at: Date.now() } : null;
}

let started = false;

/** Starts counting for the signed-in learner. Returns a stop function (tests). */
export function startStudyTime(): () => void {
  if (started) return () => undefined;
  started = true;
  lastBeat = Date.now();
  lastActivity = Date.now();
  const mark = () => {
    lastActivity = Date.now();
  };
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "input", "mousemove"] as const;
  events.forEach((e) => document.addEventListener(e, mark, { passive: true, capture: true }));
  const onVisibility = () => {
    beat();
    if (document.hidden) void flush(true);
  };
  const onHide = () => {
    beat();
    void flush(true);
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  const timer = setInterval(() => beat(), BEAT_MS);
  return () => {
    started = false;
    clearInterval(timer);
    events.forEach((e) => document.removeEventListener(e, mark, { capture: true }));
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onHide);
  };
}

/** Test helper. */
export function resetStudyTime() {
  for (const k of Object.keys(pending)) delete pending[k as Lane];
  sentSeconds = 0;
  lastAudio = null;
  lastBeat = Date.now();
  lastActivity = 0;
  listeners = new Set();
}

/* ---------------- progress from the server ---------------- */

export interface StudySummary {
  today_seconds: number;
  week_seconds: number;
  total_seconds: number;
  day: string;
  week_start: string;
  timezone: string;
  goal_hours: number;
  progress: number;
  remaining_seconds: number;
  average_week_seconds: number;
  projected_finish: string | null;
}

export interface GameState {
  level: number;
  level_xp: number;
  next_level_xp: number | null;
  progress: number;
  xp: number;
  max_level: number;
  hours_total: number;
  today: {
    day: string;
    minutes: number;
    target: number;
    family_day: boolean;
    weekend: boolean;
    by_lane: Record<string, number>;
    logs: { id: number; lane: Lane; minutes: number; note: string }[];
    kills: number;
    deaths: number;
    best_combo: number;
  };
  week: {
    number: number;
    start: string;
    end: string;
    minutes: number;
    target: number;
    maintenance: boolean;
    by_lane: Record<string, number>;
    lane_targets: Record<string, number>;
    lane_weights: Record<string, number>;
    focus_skill: { skill: string; minutes: number; target: number };
  };
  streak_days: number;
  days_studied_7d: number;
}

export interface DayTime {
  day: string;
  seconds: number;
  manual_seconds: number;
  lanes: Partial<Record<Lane, number>>;
}

export const loadSummary = () => apiFetch<StudySummary>("/api/game/study-time");
export const loadGameState = () => apiFetch<GameState>(`/api/game/state?tz_offset=${tz()}`);
export const loadDays = (days = 60) => apiFetch<{ days: DayTime[] }>(`/api/game/days?days=${days}`).then((r) => r.days);

export const logTime = (lane: Lane, minutes: number, note: string) =>
  apiFetch<GameState>("/api/game/log", { body: { lane, minutes, note, tz_offset: tz() } });
export const deleteLog = (id: number) => apiFetch<GameState>(`/api/game/log/${id}?tz_offset=${tz()}`, { method: "DELETE" });
export const setFamilyDay = (on: boolean) => apiFetch<GameState>("/api/game/family-day", { body: { on, tz_offset: tz() } });

export const LANE_LABEL: Record<Lane, string> = {
  listening: "Listening",
  reading: "Reading",
  speaking: "Speaking",
  writing: "Writing",
  review: "Review",
  car: "Listening on the go",
};
