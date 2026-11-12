/* Real French audio: Edge TTS clips from /tts, played one after another in a single <audio> element. */
import { apiFetch } from "../api/client";

// Canadian French voices: the same text always gets the same voice (FNV-1a hash of the trimmed text), so
// replays, slow replays and the old pages share one cached clip (tests/test_ca_voices.py checks this rule).
export const CA_VOICES = ["fr-CA-SylvieNeural", "fr-CA-JeanNeural", "fr-CA-AntoineNeural"];

export function voiceFor(text: string): string {
  const key = text.trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return CA_VOICES[h % CA_VOICES.length];
}

export function ttsUrl(text: string, voice = voiceFor(text)): string {
  return `/tts?text=${encodeURIComponent(text.trim())}&voice=${voice}`;
}

let session: Promise<void> | null = null;

/** <audio> can't send the bearer token: exchange it once for the HttpOnly session cookie. */
export function ensureAudioSession(): Promise<void> {
  session ??= apiFetch("/api/auth/session", { method: "POST", noAuthRedirect: true }).then(
    () => undefined,
    () => {
      session = null; // try again next time; the cookie from sign-in may still work
    },
  );
  return session;
}

/** Rough length of a clip before its metadata loads (about 13 characters a second). */
const estimate = (text: string) => Math.max(1, text.length / 13);
export { estimate };

/* ---------------- one-shot "say this" ---------------- */

let oneShot: HTMLAudioElement | null = null;
let oneShotSeq = 0;
let activeStop: (() => void) | null = null;
function claimPlayback(stop: () => void) {
  if (activeStop !== stop) activeStop?.();
  activeStop = stop;
}
function stopOneShot() {
  ++oneShotSeq;
  oneShot?.pause();
}

/**
 * Reads one short piece of French aloud in its own <audio> element. It never creates or replaces
 * the store's main `player` (so a word or a phrase selection never takes over sentence playback).
 * A new call stops the previous clip. Empty text is ignored and long text is capped.
 */
export function speakOnce(text: string, rate = 1, voice?: string): void {
  const clean = text.trim().slice(0, 200);
  if (!clean) return;
  // jsdom (unit tests) exposes HTMLMediaElement but cannot actually play anything; skip it there.
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return;
  claimPlayback(stopOneShot);
  const id = ++oneShotSeq;
  try {
    oneShot ??= new Audio();
    oneShot.pause(); // stop whatever one-shot clip is currently playing
  } catch {
    return; // no usable Audio element (e.g. a DOM-less/jsdom environment)
  }
  ensureAudioSession().then(() => {
    if (id !== oneShotSeq || !oneShot) return; // a newer call superseded this one
    try {
      oneShot.src = ttsUrl(clean, voice);
      oneShot.playbackRate = rate;
      const playing = oneShot.play() as Promise<void> | undefined;
      if (playing && typeof playing.catch === "function") playing.catch(() => undefined);
    } catch {
      // Playback is unavailable here; the caller still got its sayFrench side effects.
    }
  });
}

export interface ClipEvents {
  onPlaying: () => void;
  onProgress: (position: number, duration: number) => void;
  onEnded: () => void;
  onError: () => void;
}

export interface AudioHandle {
  pause: () => void;
  resume: () => void;
  restart: () => void;
  setSpeed: (speed: number) => void;
  seek: (seconds: number) => void;
  stop: () => void;
}

/** Plays texts in order. Only one handle is meant to be alive at a time (the store owns it). */
export function playTexts(texts: string[], speed: number, ev: ClipEvents): AudioHandle {
  const audio = new Audio();
  const durations = texts.map(estimate);
  let index = 0;
  let stopped = false;
  let paused = false;
  const cancel = () => { stopped = true; audio.pause(); };
  claimPlayback(cancel);
  const total = () => durations.reduce((a, b) => a + b, 0);
  const position = () => durations.slice(0, index).reduce((a, b) => a + b, 0) + (audio.currentTime || 0);

  const load = (i: number) => {
    if (stopped || paused) return;
    index = i;
    audio.src = ttsUrl(texts[i]);
    audio.playbackRate = speed;
    audio.play().catch(() => !stopped && ev.onError());
  };
  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) durations[index] = audio.duration;
    ev.onProgress(position(), total());
  });
  audio.addEventListener("playing", () => !stopped && ev.onPlaying());
  audio.addEventListener("timeupdate", () => !stopped && ev.onProgress(position(), total()));
  audio.addEventListener("error", () => !stopped && ev.onError());
  audio.addEventListener("ended", () => {
    if (stopped) return;
    if (index < texts.length - 1) return load(index + 1);
    ev.onProgress(total(), total());
    ev.onEnded();
  });

  ensureAudioSession().then(() => !stopped && load(0));

  return {
    pause: () => { paused = true; audio.pause(); },
    resume: () => {
      claimPlayback(cancel);
      stopped = false;
      paused = false;
      if (!audio.getAttribute("src")) { ensureAudioSession().then(() => !stopped && !paused && load(index)); return; }
      audio.play().catch(() => !stopped && ev.onError());
    },
    restart: () => { claimPlayback(cancel); stopped = false; paused = false; load(0); },
    setSpeed: (s) => {
      speed = s;
      audio.playbackRate = s;
    },
    seek: () => undefined, // sentence clips restart instead
    stop: () => {
      stopped = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

/** Plays one audio file (an episode) from `startAt` seconds. Its real duration comes from the file. */
export function playUrl(url: string, speed: number, startAt: number, ev: ClipEvents): AudioHandle {
  const audio = new Audio();
  audio.preload = "auto";
  let stopped = false;
  let paused = false;
  const cancel = () => { stopped = true; audio.pause(); };
  claimPlayback(cancel);
  let pendingSeek = startAt;
  const report = () => ev.onProgress(audio.currentTime || 0, Number.isFinite(audio.duration) ? audio.duration : 0);
  audio.addEventListener("loadedmetadata", () => {
    if (pendingSeek > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 1));
    pendingSeek = 0;
    report();
  });
  audio.addEventListener("playing", () => !stopped && ev.onPlaying());
  audio.addEventListener("timeupdate", () => !stopped && report());
  audio.addEventListener("error", () => !stopped && ev.onError());
  audio.addEventListener("ended", () => {
    if (stopped) return;
    report();
    ev.onEnded();
  });
  const start = () => {
    if (stopped || paused) return;
    audio.src = url;
    audio.playbackRate = speed;
    audio.play().catch(() => !stopped && ev.onError());
  };
  ensureAudioSession().then(start);
  return {
    pause: () => { paused = true; audio.pause(); },
    resume: () => {
      claimPlayback(cancel);
      stopped = false;
      paused = false;
      if (!audio.getAttribute("src")) { ensureAudioSession().then(() => !stopped && !paused && start()); return; }
      audio.play().catch(() => !stopped && ev.onError());
    },
    restart: () => {
      claimPlayback(cancel); stopped = false; paused = false;
      if (!audio.getAttribute("src")) { ensureAudioSession().then(start); return; }
      audio.currentTime = 0;
      audio.play().catch(() => !stopped && ev.onError());
    },
    setSpeed: (s) => {
      speed = s;
      audio.playbackRate = s;
    },
    seek: (t) => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Math.max(0, Math.min(t, audio.duration));
      else pendingSeek = t;
      report();
    },
    stop: () => {
      stopped = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}
