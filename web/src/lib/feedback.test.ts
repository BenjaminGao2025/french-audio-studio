// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  animationOn,
  currentStreak,
  DEFAULT_FEEDBACK,
  FEEDBACK_KEY,
  loadFeedback,
  noteOutcome,
  resetFeedbackState,
  saveFeedback,
} from "./feedback";

afterEach(() => {
  localStorage.removeItem(FEEDBACK_KEY);
  resetFeedbackState();
});

describe("practice feedback", () => {
  it("uses sound, spoken praise and animation by default", () => {
    expect(loadFeedback()).toEqual(DEFAULT_FEEDBACK);
    expect(DEFAULT_FEEDBACK.volume).toBeGreaterThan(0);
    expect(DEFAULT_FEEDBACK.volume).toBeLessThanOrEqual(1);
  });

  it("persists sound, volume, spoken praise and animation on this device", () => {
    saveFeedback({ sound: false, volume: 0.25, spoken: false, animation: false });
    resetFeedbackState();
    expect(loadFeedback()).toEqual({ sound: false, volume: 0.25, spoken: false, animation: false });
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
