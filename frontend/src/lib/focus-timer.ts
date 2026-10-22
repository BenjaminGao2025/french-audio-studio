// Focus timer (pomodoro) store. Plain module state mirrored to localStorage, so a running timer
// survives reloads and route changes, and every open tab shows the same countdown.
//
// Time is kept as an absolute end timestamp (endsAt), never as a ticking counter: a background
// tab may be throttled, but the remaining time is always endsAt - now.
import { useSyncExternalStore } from "react";

export type FocusPhase = "idle" | "focus" | "break" | "done";

export interface FocusPlan {
  id: "25" | "50";
  focusMin: number;
  breakMin: number;
}

export const PLANS: readonly FocusPlan[] = [
  { id: "25", focusMin: 25, breakMin: 5 },
  { id: "50", focusMin: 50, breakMin: 10 },
];

export interface FocusState {
  phase: FocusPhase;
  planId: FocusPlan["id"];
  /** Running: absolute end time (ms). Null when idle, done or paused. */
  endsAt: number | null;
  /** Paused: milliseconds left. Null when not paused. */
  pausedLeft: number | null;
  /** Length of the current phase (ms), for the progress ring. */
  totalMs: number;
  /** Minutes of the focus session that just finished (phase "done"). */
  doneMin: number;
  /** Lane the finished session was logged to in the hours ledger (phase "done"). */
  loggedLane: string | null;
}

export interface FocusDay {
  day: string;
  count: number;
  minutes: number;
  /** endsAt of the last counted session: a session is counted once even with several tabs open. */
  lastEndsAt: number | null;
}

const STATE_KEY = "1000h.focus";
const DAY_KEY = "1000h.focus.day";
const MINUTE = 60_000;

const IDLE: FocusState = {
  phase: "idle",
  planId: "25",
  endsAt: null,
  pausedLeft: null,
  totalMs: 0,
  doneMin: 0,
  loggedLane: null,
};

export function localDay(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the timer still works for this page.
  }
}

function loadState(): FocusState {
  const s = read<FocusState>(STATE_KEY);
  if (!s || !["idle", "focus", "break", "done"].includes(s.phase)) return IDLE;
  return { ...IDLE, ...s };
}

function loadDay(now = Date.now()): FocusDay {
  const d = read<FocusDay>(DAY_KEY);
  const today = localDay(now);
  if (!d || d.day !== today)
    return { day: today, count: 0, minutes: 0, lastEndsAt: d?.lastEndsAt ?? null };
  return d;
}

let state: FocusState = typeof window === "undefined" ? IDLE : loadState();
let day: FocusDay = typeof window === "undefined" ? loadDayFallback() : loadDay();
let listeners: (() => void)[] = [];
type CompleteHandler = (finished: "focus" | "break", state: FocusState) => void;
let completeHandlers: CompleteHandler[] = [];

function loadDayFallback(): FocusDay {
  return { day: "", count: 0, minutes: 0, lastEndsAt: null };
}

function emit() {
  listeners.forEach((fn) => fn());
}

function set(next: FocusState) {
  state = next;
  write(STATE_KEY, next);
  emit();
}

export function planOf(id: FocusPlan["id"]): FocusPlan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]!;
}

export function getFocusState(): FocusState {
  return state;
}

export function getFocusDay(): FocusDay {
  // Roll over at local midnight even if nothing was written since.
  if (typeof window !== "undefined" && day.day !== localDay()) day = loadDay();
  return day;
}

/** Milliseconds left in the current phase (0 when idle or done). */
export function remainingMs(s: FocusState = state, now = Date.now()): number {
  if (s.pausedLeft !== null) return s.pausedLeft;
  if (s.endsAt === null) return 0;
  return Math.max(0, s.endsAt - now);
}

export function isRunning(s: FocusState = state): boolean {
  return (s.phase === "focus" || s.phase === "break") && s.endsAt !== null;
}

export function startFocus(planId: FocusPlan["id"] = state.planId, now = Date.now()) {
  const ms = planOf(planId).focusMin * MINUTE;
  set({ ...IDLE, phase: "focus", planId, endsAt: now + ms, totalMs: ms });
}

export function startBreak(now = Date.now()) {
  const ms = planOf(state.planId).breakMin * MINUTE;
  set({ ...IDLE, phase: "break", planId: state.planId, endsAt: now + ms, totalMs: ms });
}

export function pause(now = Date.now()) {
  if (!isRunning()) return;
  set({ ...state, pausedLeft: remainingMs(state, now), endsAt: null });
}

export function resume(now = Date.now()) {
  if (state.pausedLeft === null) return;
  set({ ...state, endsAt: now + state.pausedLeft, pausedLeft: null });
}

/** Add minutes to the running or paused phase. */
export function extend(minutes: number) {
  const add = minutes * MINUTE;
  if (state.pausedLeft !== null)
    set({ ...state, pausedLeft: state.pausedLeft + add, totalMs: state.totalMs + add });
  else if (state.endsAt !== null)
    set({ ...state, endsAt: state.endsAt + add, totalMs: state.totalMs + add });
}

/** Give up the current phase (a stopped focus session is not counted). */
export function stop() {
  set({ ...IDLE, planId: state.planId });
}

/** Remember that the finished session went into the hours ledger, so it is not logged twice. */
export function markLogged(lane: string) {
  if (state.phase === "done") set({ ...state, loggedLane: lane });
}

/** Close the "done" card without starting anything. */
export function dismiss() {
  if (state.phase === "done") set({ ...IDLE, planId: state.planId });
}

export function setPlan(planId: FocusPlan["id"]) {
  if (state.phase === "idle") set({ ...state, planId });
}

/**
 * Advance a phase whose time is up. Call on every tick, on focus/visibility and on the timer's
 * own timeout; it is idempotent. Returns which phase finished, if any.
 */
export function tick(now = Date.now()): "focus" | "break" | null {
  if (!isRunning() || state.endsAt === null || now < state.endsAt) return null;
  const finished = state.phase as "focus" | "break";
  const endsAt = state.endsAt;
  if (finished === "focus") {
    // Another tab may already have counted this session: re-read before counting.
    const fresh = loadDay(now);
    const minutes = Math.round(state.totalMs / MINUTE);
    day =
      fresh.lastEndsAt === endsAt
        ? fresh
        : {
            ...fresh,
            count: fresh.count + 1,
            minutes: fresh.minutes + minutes,
            lastEndsAt: endsAt,
          };
    write(DAY_KEY, day);
    set({ ...IDLE, phase: "done", planId: state.planId, doneMin: minutes });
  } else {
    set({ ...IDLE, planId: state.planId });
  }
  completeHandlers.forEach((fn) => fn(finished, state));
  return finished;
}

export function onComplete(fn: CompleteHandler): () => void {
  completeHandlers.push(fn);
  return () => {
    completeHandlers = completeHandlers.filter((f) => f !== fn);
  };
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((f) => f !== cb);
  };
}

if (typeof window !== "undefined") {
  // Keep tabs in step: a start, pause or stop in one tab shows in the others.
  window.addEventListener("storage", (e) => {
    if (e.key === STATE_KEY) state = loadState();
    else if (e.key === DAY_KEY) day = loadDay();
    else return;
    emit();
  });
}

export function useFocusState(): FocusState {
  return useSyncExternalStore(subscribe, getFocusState, () => IDLE);
}

export function useFocusDay(): FocusDay {
  return useSyncExternalStore(subscribe, getFocusDay, loadDayFallback);
}

/** Test helper: reset module state from storage. */
export function _reloadFromStorage() {
  state = loadState();
  day = loadDay();
  emit();
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
