// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gradeAttempt } from "../api/dictation";
import type { PracticeItem } from "../data/fixtures";
import { FEEDBACK_KEY, resetFeedbackState, saveFeedback } from "../lib/feedback";
import { get, resetDemo, set, startPlayback } from "../state/store";
import { ensureSession, Exercise, submitAnswer } from "./Exercise";

vi.mock("../api/dictation", () => ({ gradeAttempt: vi.fn() }));
vi.mock("../state/store", async (original) => ({ ...(await original<typeof import("../state/store")>()), startPlayback: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: PracticeItem[] = [{ id: "s1", fr: "Nul homme ne peut être accusé.", en: "No man can be accused.", label: "Sentence 1", steps: [] }];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  resetDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.removeItem(FEEDBACK_KEY);
  resetFeedbackState();
});

const check = async (key: string, kind: "Recall" | "Dictation", correct: boolean) => {
  vi.mocked(gradeAttempt).mockResolvedValueOnce({ attempt_id: "a1", correct, accent_only: false, accuracy: correct ? 100 : 40, saved: true, expected: items[0].fr });
  ensureSession(key, kind, "Current sentence", items);
  set((s) => ({ exercises: { ...s.exercises, [key]: { ...s.exercises[key], mode: "whole", drafts: { "0:whole:w": correct ? items[0].fr : "Nul homme" } } } }));
  await act(async () => root.render(<Exercise sessionKey={key} kind={kind} source="Current sentence" items={items} onDone={() => {}} />));
  await act(async () => { submitAnswer(key); await new Promise((r) => setTimeout(r, 10)); });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

it.each(["Recall", "Dictation"] as const)("%s reads the French aloud once after a correct answer", async (kind) => {
  await check(`read-${kind}`, kind, true);
  expect(startPlayback).not.toHaveBeenCalled();
  await settle();
  expect(startPlayback).toHaveBeenCalledTimes(1);
  const [owner, , opts] = vi.mocked(startPlayback).mock.calls[0];
  expect(owner.kind).toBe("exercise");
  expect(opts).toMatchObject({ texts: [items[0].fr], repeat: false, quiet: true });
});

it("stays silent after a wrong answer", async () => {
  await check("read-wrong", "Recall", false);
  await settle();
  expect(startPlayback).not.toHaveBeenCalled();
});

it("stays silent when the setting is off", async () => {
  saveFeedback({ readAnswer: false });
  await check("read-off", "Recall", true);
  await settle();
  expect(startPlayback).not.toHaveBeenCalled();
});

it("does not cut off an episode that is playing", async () => {
  set(() => ({ player: { ...({} as NonNullable<ReturnType<typeof get>["player"]>), id: 99, owner: { kind: "episode", label: "Episode", route: "episodes" }, status: "playing" } }));
  await check("read-episode", "Recall", true);
  await settle();
  expect(startPlayback).not.toHaveBeenCalled();
});

it("skips it when the learner already moved to another try", async () => {
  await check("read-moved", "Recall", true);
  await act(async () => set((s) => ({ exercises: { ...s.exercises, "read-moved": { ...s.exercises["read-moved"], ui: {} } } })));
  await settle();
  expect(startPlayback).not.toHaveBeenCalled();
});
