import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { audioController } from "@/lib/audio-controller";

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  audioController.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("interrupts detached model/word/recording players and resets their UI", async () => {
  const reset = vi.fn();
  const model = new Audio("/model");
  const word = new Audio("/word");
  expect(await audioController.play(model, reset)).toBe(true);
  await audioController.play(word, vi.fn());
  expect(model.pause).toHaveBeenCalled();
  expect(reset).toHaveBeenCalledOnce();
});

it("coordinates native episode controls with detached players in both directions", async () => {
  const reset = vi.fn();
  const word = new Audio();
  await audioController.play(word, reset);
  const episode = document.createElement("audio");
  document.body.append(episode);
  episode.dispatchEvent(new Event("play"));
  expect(reset).toHaveBeenCalledOnce();
  const pause = vi.fn();
  Object.defineProperty(episode, "pause", { value: pause });
  await audioController.play(new Audio(), vi.fn());
  expect(pause).toHaveBeenCalledOnce();
});

it("does not report successful playback after a pending request is interrupted", async () => {
  let resolve!: () => void;
  const first = new Audio();
  Object.defineProperty(first, "play", {
    value: () => new Promise<void>((done) => (resolve = done)),
  });
  const pending = audioController.play(first, vi.fn());
  await audioController.play(new Audio(), vi.fn());
  resolve();
  expect(await pending).toBe(false);
});

it("keeps the new player running when the old component unmounts", async () => {
  const first = new Audio();
  const second = new Audio();
  await audioController.play(first, vi.fn());
  await audioController.play(second, vi.fn());
  const pause = vi.fn();
  Object.defineProperty(second, "pause", { value: pause });
  audioController.stop(first);
  expect(pause).not.toHaveBeenCalled();
});

it("propagates playback failure without reporting success", async () => {
  const audio = new Audio();
  Object.defineProperty(audio, "play", {
    value: vi.fn().mockRejectedValue(new Error("unavailable")),
  });
  await expect(audioController.play(audio, vi.fn())).rejects.toThrow("unavailable");
});
