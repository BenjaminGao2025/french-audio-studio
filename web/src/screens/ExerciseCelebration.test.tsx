// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gradeAttempt } from "../api/dictation";
import type { PracticeItem } from "../data/fixtures";
import * as feedback from "../lib/feedback";
import { get, resetDemo, set } from "../state/store";
import { ensureSession, Exercise, submitAnswer } from "./Exercise";

vi.mock("../api/dictation", () => ({ gradeAttempt: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = "Nul ne doit être inquiété pour ses opinions";
const items: PracticeItem[] = [{ id: "opinions", fr: target, en: "No one should be worried for their opinions.", label: "Sentence",
  steps: [{ fr: "Nul", en: "No one" }, { fr: target, en: "No one should be worried for their opinions." }, { fr: target, en: "No one should be worried for their opinions." }] }];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  resetDemo();
  feedback.resetFeedbackState();
  feedback.saveFeedback({ sound: true, animation: true, readAnswer: false });
  vi.spyOn(feedback, "gradeFeedback").mockReturnValue(0);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.removeItem(feedback.FEEDBACK_KEY);
  feedback.resetFeedbackState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function check(kind: "Recall" | "Dictation", mode: "whole" | "step", last: boolean, answer = target, correct = true) {
  vi.mocked(gradeAttempt).mockResolvedValueOnce({ correct, accuracy: correct ? 100 : 20, saved: true } as Awaited<ReturnType<typeof gradeAttempt>>);
  ensureSession("celebration", kind, "Current sentence", items);
  const step = last ? 2 : 1;
  const qk = mode === "whole" ? "0:whole:w" : `0:step:${step}`;
  set(s => ({ exercises: { ...s.exercises, celebration: { ...s.exercises.celebration, mode, steps: { 0: step }, drafts: { [qk]: answer } } } }));
  await act(async () => root.render(<Exercise sessionKey="celebration" kind={kind} source="Current sentence" items={items} onDone={() => {}} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Answer actions"] button:last-child')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Hide answer"]')!.click());
  await act(async () => submitAnswer("celebration"));
}

describe.each(["Recall", "Dictation"] as const)("%s perfect revealed answer", kind => {
  describe.each(["whole", "step"] as const)("%s scope", mode => {
    it.each([false, true])("celebrates and preserves answer-known scoring (last=%s)", async last => {
      await check(kind, mode, last);
      expect(host.querySelectorAll(".perfect-burst .spark")).toHaveLength(14);
      expect(host.querySelector('[aria-label="Score: 100%"]')?.classList.contains("perfect-score")).toBe(true);
      expect(host.querySelectorAll(".perfect-word").length).toBeGreaterThan(0);
      expect(feedback.gradeFeedback).toHaveBeenCalledExactlyOnceWith(true, { perfect: true, answerKnown: true });
      expect(get().attempts.at(-1)).toMatchObject({ answerKnown: true, outcome: "correct" });
      expect(host.textContent).toContain("Answer known");
      const summary = host.querySelector('[aria-label="Session summary"]');
      if (mode === "whole" || last) {
        expect(summary?.textContent).toContain("Practice complete");
        expect([...summary!.querySelectorAll("dt")].find(el => el.textContent === "Unaided correct")?.nextElementSibling?.textContent).toBe("0");
        expect([...summary!.querySelectorAll("dt")].find(el => el.textContent === "Answer known")?.nextElementSibling?.textContent).toBe("1");
      } else {
        expect(summary).toBeNull();
        expect(host.querySelector('[aria-label="Result actions"] button:last-child')?.textContent).toBe("Next");
      }
      await act(async () => set(s => ({ attempts: s.attempts.map(a => ({ ...a, history: "saved" })) })));
      expect(feedback.gradeFeedback).toHaveBeenCalledTimes(1);
    });
  });
});

it("does not celebrate an incorrect revealed answer", async () => {
  await check("Recall", "step", false, "Nul", false);
  expect(host.querySelector(".perfect-burst, .perfect-score")).toBeNull();
  expect(feedback.gradeFeedback).toHaveBeenCalledExactlyOnceWith(false, { perfect: false, answerKnown: true });
});

it.each(["setting", "reduced motion"])("keeps a full score visible with animation disabled by %s", async reason => {
  if (reason === "setting") feedback.saveFeedback({ animation: false });
  else vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })));
  await check("Recall", "step", false);
  expect(host.querySelector('[aria-label="Score: 100%"]')).toBeTruthy();
  expect(host.querySelector(".perfect-burst, .perfect-score, .perfect-word")).toBeNull();
  expect(feedback.gradeFeedback).toHaveBeenCalledExactlyOnceWith(true, { perfect: true, answerKnown: true });
});
