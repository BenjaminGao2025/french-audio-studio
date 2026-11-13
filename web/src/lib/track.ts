/*
 * First-party usage recording (see usage.py on the server and /privacy).
 *
 * Events are queued here and sent to our own /api/events every 30 s, and with sendBeacon when the
 * page is hidden or closed. Nothing goes to a third party. An event is a name, the screen's route
 * pattern (ids replaced by ":id", no query) and a few short properties: booleans, numbers or one
 * token without spaces. Words, sentences and anything the learner types are never recorded.
 *
 * Automatic events: screen_view, screen_time (seconds the screen was visible and in use),
 * tab_view (Study tabs), play (audio source kind and speed) and error_shown (assertive
 * announcements, as a slug). Screens add the main button actions with track().
 */
import { apiFetch, ApiError, getToken } from "../api/client";
import { IDLE_MS } from "../api/time";
import { store } from "../state/store";

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

export interface UiEvent {
  name: string;
  route: string;
  props: Props;
  ts: number;
}

export const ENDPOINT = "/api/events";
export const FLUSH_MS = 30_000;
const TICK_MS = 5_000;
export const MAX_QUEUE = 200;
export const BATCH = 50;
const MAX_PROPS = 8;
const TOKEN = /^[A-Za-z0-9_.:/-]{0,40}$/;

const randomId = () => {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** One id per page load, so the report can follow a funnel within a visit. */
export let sessionId = randomId();

let queue: UiEvent[] = [];
let sending: Promise<void> | null = null;
/** The sign-in token a 401 answered: stop recording until the learner signs in again (no page reload). */
let signedOutToken: string | null = null;
const disabled = () => signedOutToken !== null && signedOutToken === getToken();

/** "practice/write/abc123?x=1" → "practice/write/:id". Only lower-case word segments are kept as they are. */
export function routePattern(route: string): string {
  return route
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .slice(0, 4)
    .map((seg) => (/^[a-z][a-z-]{0,23}$/.test(seg) ? seg : ":id"))
    .join("/");
}

/** "Audio couldn’t play." → "audio-couldnt-play": an app message as a short token. */
export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

function cleanProps(props: Props = {}): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(k)) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  return out;
}

/** Queue one event for the current screen. Never throws, never sends by itself. */
export function track(name: string, props?: Props, route = store.get().route) {
  if (disabled() || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) return;
  queue.push({ name, route: routePattern(route), props: cleanProps(props), ts: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
}

export const queued = (): readonly UiEvent[] => queue;

/** Send the queue in batches. Network trouble and 429/5xx keep the events for the next try. */
export function flushEvents(): Promise<void> {
  commitScreenTime();
  sending ??= (async () => {
    try {
      while (queue.length && !disabled()) {
        const batch = queue.slice(0, BATCH);
        try {
          await apiFetch(ENDPOINT, { body: { session: sessionId, events: batch }, noAuthRedirect: true });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            signedOutToken = getToken();
            queue = [];
          } else if (e instanceof ApiError && e.status !== 429 && e.status < 500) {
            queue = queue.slice(batch.length); // the server will never take this batch
          }
          return;
        }
        queue = queue.slice(batch.length);
      }
    } finally {
      sending = null;
    }
  })();
  return sending;
}

/** The page is going away: hand everything to the browser with sendBeacon (it sends the session cookie). */
export function beaconEvents() {
  commitScreenTime();
  if (disabled() || !queue.length) return;
  const send = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" ? navigator.sendBeacon.bind(navigator) : null;
  if (!send) {
    void flushEvents();
    return;
  }
  while (queue.length) {
    const batch = queue.slice(0, BATCH);
    const blob = new Blob([JSON.stringify({ session: sessionId, events: batch })], { type: "application/json" });
    if (!send(ENDPOINT, blob)) return; // the browser refused (too much in flight): keep the rest for later
    queue = queue.slice(batch.length);
  }
}

/* ---------------- screen time ---------------- */

let screen = "";
let screenSeconds = 0;
let lastTick = 0;
let lastActivity = 0;

/** Add the time since the last tick to the current screen while it is visible and in use (or playing audio). */
export function tickScreen(now = Date.now()) {
  const dt = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;
  const playing = store.get().player?.status === "playing";
  const visible = typeof document === "undefined" || !document.hidden;
  if (screen && visible && (playing || now - lastActivity < IDLE_MS)) screenSeconds += Math.min(dt, (TICK_MS / 1000) * 2);
}

function commitScreenTime() {
  tickScreen();
  const seconds = Math.round(screenSeconds);
  screenSeconds = 0;
  if (screen && seconds >= 1) track("screen_time", { seconds }, screen);
}

function enterScreen(route: string) {
  const pattern = routePattern(route);
  if (pattern === routePattern(screen)) {
    screen = route;
    return;
  }
  commitScreenTime();
  screen = route;
  track("screen_view", {}, route);
}

let started = false;

/** Starts recording for this page load. Returns a stop function (tests). */
export function startTracking(): () => void {
  if (started) return () => undefined;
  started = true;
  const now = Date.now();
  lastTick = now;
  lastActivity = now;
  let prev = store.get();
  enterScreen(prev.route);
  const unsubscribe = store.subscribe(() => {
    const s = store.get();
    if (s.route !== prev.route) enterScreen(s.route);
    if (s.study.tab !== prev.study.tab && s.route.startsWith("study")) track("tab_view", { tab: s.study.tab });
    if (s.player && s.player.id !== prev.player?.id) track("play", { owner: s.player.owner.kind, speed: s.player.speed });
    if (s.announce.n !== prev.announce.n && s.announce.assertive && s.announce.msg) track("error_shown", { msg: slug(s.announce.msg) });
    prev = s;
  });
  const mark = () => {
    tickScreen();
    lastActivity = Date.now();
  };
  const activity = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  activity.forEach((e) => document.addEventListener(e, mark, { passive: true, capture: true }));
  const onVisibility = () => {
    if (document.hidden) beaconEvents();
    else lastTick = Date.now(); // hidden time never counts
  };
  window.addEventListener("pagehide", beaconEvents);
  document.addEventListener("visibilitychange", onVisibility);
  const ticker = setInterval(() => tickScreen(), TICK_MS);
  const flusher = setInterval(() => void flushEvents(), FLUSH_MS);
  return () => {
    started = false;
    unsubscribe();
    clearInterval(ticker);
    clearInterval(flusher);
    activity.forEach((e) => document.removeEventListener(e, mark, { capture: true }));
    window.removeEventListener("pagehide", beaconEvents);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Test helper. */
export function resetTracking() {
  queue = [];
  sending = null;
  signedOutToken = null;
  screen = "";
  screenSeconds = 0;
  lastTick = Date.now();
  lastActivity = 0;
  sessionId = randomId();
}
