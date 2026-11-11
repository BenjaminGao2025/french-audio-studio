/* Session praise for a graded answer. Sound never blocks the next card. */
import { ttsUrl } from "../state/audio";

export interface FeedbackPrefs {
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  spoken: boolean;
  animation: boolean;
}

export const FEEDBACK_KEY = "frenchStudio.feedback";

export const DEFAULT_FEEDBACK: FeedbackPrefs = {
  sound: true,
  volume: 0.7,
  spoken: false,
  animation: true,
};

const PRAISE = ["Bravo !", "Parfait !", "Nickel !", "Super !"] as const;
const SPOKEN_PRAISE = "Excellent !";

export interface StreakEvent {
  streak: number;
  correct: boolean;
  /** 3, 5 and 10 are the only milestones. A wrong answer resets the streak. */
  milestone: 0 | 3 | 5 | 10;
}

export interface GradeToastState {
  id: number;
  phrase: string;
  glow: boolean;
  celebrate: boolean;
}

type Listener = () => void;

let cached: FeedbackPrefs | null = null;
let streak = 0;
let gestured = false;
let audioCtx: AudioContext | null = null;
let toast: GradeToastState | null = null;
let toastSeq = 0;
let toastTimer = 0;
const prefListeners = new Set<Listener>();
const toastListeners = new Set<Listener>();
const praiseAudio = new Map<string, HTMLAudioElement>();

function clampVolume(n: number) {
  if (!Number.isFinite(n)) return DEFAULT_FEEDBACK.volume;
  return Math.min(1, Math.max(0, n));
}

function readPrefs(): FeedbackPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_FEEDBACK };
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "");
    if (!raw || typeof raw !== "object") return { ...DEFAULT_FEEDBACK };
    return {
      sound: raw.sound !== false,
      volume: clampVolume(typeof raw.volume === "number" ? raw.volume : DEFAULT_FEEDBACK.volume),
      spoken: typeof raw.spoken === "boolean" ? raw.spoken : DEFAULT_FEEDBACK.spoken,
      animation: raw.animation !== false,
    };
  } catch {
    return { ...DEFAULT_FEEDBACK };
  }
}

function emitPrefs() {
  for (const fn of prefListeners) fn();
}

export function subscribeFeedback(fn: Listener) {
  prefListeners.add(fn);
  return () => prefListeners.delete(fn);
}

export function loadFeedback(): FeedbackPrefs {
  return readPrefs();
}

export function feedbackPrefs(): FeedbackPrefs {
  cached ??= readPrefs();
  return cached;
}

export function saveFeedback(patch: Partial<FeedbackPrefs>) {
  const prev = feedbackPrefs();
  const next: FeedbackPrefs = {
    sound: patch.sound ?? prev.sound,
    volume: patch.volume !== undefined ? clampVolume(patch.volume) : prev.volume,
    spoken: patch.spoken ?? prev.spoken,
    animation: patch.animation ?? prev.animation,
  };
  cached = next;
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the in-memory prefs still apply for this tab */
  }
  emitPrefs();
}

export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Stored animation preference, forced off while the device asks for reduced motion. */
export function animationOn(prefs = feedbackPrefs(), reduced = prefersReducedMotion()): boolean {
  return prefs.animation && !reduced;
}

export function noteOutcome(correct: boolean): StreakEvent {
  streak = correct ? streak + 1 : 0;
  const milestone: StreakEvent["milestone"] = streak === 3 || streak === 5 || streak === 10 ? streak : 0;
  return { streak, correct, milestone };
}

export function currentStreak() {
  return streak;
}

export function pickPraise(rand: () => number = Math.random) {
  const i = Math.min(PRAISE.length - 1, Math.max(0, Math.floor(rand() * PRAISE.length)));
  return PRAISE[i];
}

export function subscribeToast(fn: Listener) {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

export function gradeToast() {
  return toast;
}

function emitToast() {
  for (const fn of toastListeners) fn();
}

function armAudio() {
  gestured = true;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* this browser cannot synthesise a chime */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", armAudio, { capture: true });
  window.addEventListener("keydown", armAudio, { capture: true });
}

/** Tests and the first pointer/key event both count as a user gesture. */
export function markGesture() {
  if (typeof window !== "undefined") armAudio();
  else gestured = true;
}

function pitchFor(n: number) {
  if (n >= 10) return 988;
  if (n >= 3) return 740;
  return 587;
}

function chime(freq: number, volume: number, ms: number) {
  if (!gestured || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = audioCtx.currentTime;
    const peak = Math.max(0.0001, Math.min(0.2, volume * 0.12));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch {
    /* ignore a closed context */
  }
}

function speakPraise(volume: number): Promise<void> {
  try {
    let audio = praiseAudio.get(SPOKEN_PRAISE);
    if (!audio) {
      audio = new Audio(ttsUrl(SPOKEN_PRAISE));
      praiseAudio.set(SPOKEN_PRAISE, audio);
    }
    audio.volume = Math.min(1, Math.max(0, volume));
    try {
      audio.currentTime = 0;
    } catch {
      /* the clip has not loaded yet; play() still starts it */
    }
    const playing = audio.play();
    return playing && typeof playing.then === "function" ? playing : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Record the outcome, then play and show praise without awaiting audio.
 * Answer-known checks should not call this: they are not an independent result.
 */
export function gradeFeedback(correct: boolean, options: { pronunciation?: boolean } = {}) {
  const event = noteOutcome(correct);
  const prefs = feedbackPrefs();
  const animate = animationOn(prefs);
  if (correct && typeof window !== "undefined") {
    toast = {
      id: ++toastSeq,
      phrase: pickPraise(),
      glow: animate,
      celebrate: animate && event.milestone === 10,
    };
    emitToast();
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = 0;
      emitToast();
    }, 1600);
  }
  if (!prefs.sound || !gestured) return;
  if (!correct) {
    chime(196, prefs.volume * 0.45, 140);
    return;
  }
  if (event.milestone === 5 && prefs.spoken && !options.pronunciation) {
    void speakPraise(prefs.volume).catch(() => chime(880, prefs.volume, 280));
    return;
  }
  chime(pitchFor(event.streak), prefs.volume, event.milestone === 10 ? 420 : 260);
}

/** A practice repetition reuses the soft chime without changing the review streak. */
export function practiceFeedback() {
  const prefs = feedbackPrefs();
  if (prefs.sound && gestured) chime(880, prefs.volume * 0.45, 260);
}

export function resetFeedbackState() {
  streak = 0;
  toast = null;
  cached = null;
  if (typeof window !== "undefined" && toastTimer) window.clearTimeout(toastTimer);
  toastTimer = 0;
  emitToast();
}
