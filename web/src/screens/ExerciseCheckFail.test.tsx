// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gradeAttempt } from "../api/dictation";
import type { PracticeItem } from "../data/fixtures";
import { get, resetDemo, set } from "../state/store";
import { ensureSession, Exercise, submitAnswer } from "./Exercise";

vi.mock("../api/dictation", () => ({ gradeAttempt: vi.fn() }));
vi.mock("../lib/feedback", async (original) => ({
  ...(await original<typeof import("../lib/feedback")>()),
  gradeFeedback: vi.fn(() => { throw new Error("audio glitch"); }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: PracticeItem[] = [{ id: "s1", fr: "Je vous demande.", en: "I ask you.", label: "Sentence 1", steps: [] }];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  resetDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const check = async (key: string) => {
  ensureSession(key, "Recall", "Current sentence", items);
  set((s) => ({ exercises: { ...s.exercises, [key]: { ...s.exercises[key], mode: "whole", drafts: { "0:whole:w": "Je vous demande" } } } }));
  await act(async () => root.render(<Exercise sessionKey={key} kind="Recall" source="Current sentence" items={items} onDone={() => {}} />));
  await act(async () => { submitAnswer(key); await new Promise((r) => setTimeout(r, 10)); });
};

it("a graded answer stays graded when the sound or recording after it fails", async () => {
  vi.mocked(gradeAttempt).mockResolvedValueOnce({ attempt_id: "a1", correct: true, accent_only: false, accuracy: 100, saved: true, expected: "Je vous demande." });
  await check("after-glitch");
  expect(host.textContent).not.toContain("Checking didn’t finish");
  expect(host.querySelector('[aria-label="Result actions"]')).toBeTruthy();
  expect(get().attempts.at(-1)?.outcome).toBe("correct");
});

it("a request that did not come back is still a technical failure", async () => {
  vi.mocked(gradeAttempt).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await check("network-down");
  expect(host.textContent).toContain("Checking didn’t finish");
});
