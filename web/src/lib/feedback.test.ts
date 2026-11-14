// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animationOn,
  currentStreak,
  DEFAULT_FEEDBACK,
  FANFARE_MS,
  FEEDBACK_KEY,
  gradeFeedback,
  loadFeedback,
  markGesture,
  noteOutcome,
  resetFeedbackState,
  saveFeedback,
} from "./feedback";

afterEach(() => {
  localStorage.removeItem(FEEDBACK_KEY);
  resetFeedbackState();
});

describe("practice feedback", () => {
  it("uses sound and animation with spoken praise off by default", () => {
    expect(loadFeedback()).toEqual(DEFAULT_FEEDBACK);
    expect(DEFAULT_FEEDBACK.spoken).toBe(false);
    expect(DEFAULT_FEEDBACK.volume).toBeGreaterThan(0);
    expect(DEFAULT_FEEDBACK.volume).toBeLessThanOrEqual(1);
  });

  it("persists sound, volume, spoken praise and animation on this device", () => {
    saveFeedback({ sound: false, volume: 0.25, spoken: false, animation: false });
    resetFeedbackState();
    expect(loadFeedback()).toEqual({ sound: false, volume: 0.25, spoken: false, animation: false, readAnswer: true });
  });

  it("reads correct answers aloud by default and remembers turning it off", () => {
    expect(DEFAULT_FEEDBACK.readAnswer).toBe(true);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ sound: true }));
    expect(loadFeedback().readAnswer).toBe(true);
    saveFeedback({ readAnswer: false });
    resetFeedbackState();
    expect(loadFeedback().readAnswer).toBe(false);
  });

  it("uses the default for an unset spoken field and preserves explicit true", () => {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ sound: true }));
    expect(loadFeedback().spoken).toBe(false);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ spoken: true }));
    expect(loadFeedback().spoken).toBe(true);
  });

  it("keeps a stored animation preference but forces it off for reduced motion", () => {
    saveFeedback({ animation: true });
    expect(animationOn(loadFeedback(), true)).toBe(false);
    expect(animationOn(loadFeedback(), false)).toBe(true);
    saveFeedback({ animation: false });
    expect(animationOn(loadFeedback(), false)).toBe(false);
  });

  it("counts consecutive correct answers and resets the streak on a wrong one", () => {
    expect(noteOutcome(true)).toMatchObject({ streak: 1, milestone: 0, correct: true });
    expect(noteOutcome(true).milestone).toBe(0);
    expect(noteOutcome(true)).toMatchObject({ streak: 3, milestone: 3 });
    expect(noteOutcome(true).streak).toBe(4);
    expect(noteOutcome(true)).toMatchObject({ streak: 5, milestone: 5 });
    noteOutcome(true);
    noteOutcome(true);
    noteOutcome(true);
    noteOutcome(true);
    expect(noteOutcome(true)).toMatchObject({ streak: 10, milestone: 10 });
    expect(noteOutcome(false)).toMatchObject({ streak: 0, milestone: 0, correct: false });
    expect(currentStreak()).toBe(0);
    expect(noteOutcome(true).streak).toBe(1);
  });
});

describe("perfect answer sound", () => {
  it("plays a rising run that lands on a chord, longer than the plain correct chime", () => {
    const notes: { freq: number; start: number; stop: number }[] = [];
    class FakeCtx {
      currentTime = 0;
      state = "running";
      destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() {
        const note = { freq: 0, start: 0, stop: 0 };
        notes.push(note);
        return { type: "sine", frequency: { set value(v: number) { note.freq = v; } }, connect() {}, start(t: number) { note.start = t; }, stop(t: number) { note.stop = t; } };
      }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    markGesture();

    gradeFeedback(true);
    expect(notes).toHaveLength(1);
    const plain = notes[0].stop - notes[0].start;

    notes.length = 0;
    gradeFeedback(true, { perfect: true });
    const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThan(3);
    const end = Math.max(...notes.map((n) => n.stop));
    expect(end).toBeGreaterThan(plain * 3);
    expect(end).toBeLessThanOrEqual(FANFARE_MS / 1000 + 0.2);
    // The lowest note at each of the first four onsets climbs.
    const run = starts.slice(0, 4).map((t) => Math.min(...notes.filter((n) => n.start === t).map((n) => n.freq)));
    expect(run).toEqual([...run].sort((a, b) => a - b));
    expect(new Set(run).size).toBe(4);

    const independentStreak = currentStreak();
    const fanfareNotes = notes.length;
    notes.length = 0;
    expect(gradeFeedback(true, { perfect: true, answerKnown: true })).toBe(FANFARE_MS);
    expect(notes).toHaveLength(fanfareNotes);
    expect(currentStreak()).toBe(independentStreak);
    notes.length = 0;
    expect(gradeFeedback(false, { answerKnown: true })).toBe(0);
    expect(notes).toHaveLength(0);
    expect(currentStreak()).toBe(independentStreak);

    saveFeedback({ sound: false });
    expect(gradeFeedback(true, { perfect: true, answerKnown: true })).toBe(0);
    expect(notes).toHaveLength(0);

    resetFeedbackState();
    saveFeedback({ sound: true, spoken: true });
    for (let i = 0; i < 4; i++) noteOutcome(true);
    expect(gradeFeedback(true, { perfect: true })).toBe(FANFARE_MS);
    expect(notes).toHaveLength(fanfareNotes);
    expect(currentStreak()).toBe(5);
    vi.unstubAllGlobals();
  });
});
