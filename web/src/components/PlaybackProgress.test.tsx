// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaybackProgress, PlaybackSeek } from "./PlaybackProgress";
import { readPlaybackPosition, type PlayerState } from "../state/store";

vi.mock("../state/store", () => ({ readPlaybackPosition: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mediaTime = 2;
let now = 0;
let next = 0;
const frames = new Map<number, FrameRequestCallback>();
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
let player: PlayerState;
const onSeek = vi.fn();
const render = async (p: PlayerState | null = player) => {
  await act(async () => root.render(<><PlaybackProgress player={p} /><PlaybackSeek player={p} position={0} duration={10} onSeek={onSeek} /></>));
};
const advance = async (ms: number, position = mediaTime) => {
  now = ms; mediaTime = position;
  const callbacks = [...frames.values()]; frames.clear();
  await act(async () => callbacks.forEach(cb => cb(now)));
};
const shown = () => Number(host.querySelector('[role="slider"]')!.getAttribute("aria-valuenow"));

beforeEach(() => {
  frames.clear(); now = 0; next = 0; mediaTime = 2; onSeek.mockClear();
  vi.mocked(readPlaybackPosition).mockImplementation(() => mediaTime);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  document.body.appendChild(host); root = createRoot(host);
  player = { id: 1, owner: { kind: "episode", label: "Episode", route: "practice/episodes/e1" }, status: "playing", position: 2, duration: 10, speed: 1, repeat: false, countedSeconds: 0, contentSeconds: 0, src: "/audio" };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(frames.size).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("both controls advance between media events, without rounding seconds or updating shared player state", async () => {
  await render();
  await advance(16, 2.016);
  expect(shown()).toBeCloseTo(2.016);
  expect(host.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!.style.transform).toContain("79.84");
  await advance(32, 2.032);
  expect(shown()).toBeCloseTo(2.032);
  expect(player.position).toBe(2);
});

it("the progress stays on the media clock while stalled and after changing speed", async () => {
  await render();
  await advance(1000); // No audio movement, despite a second of wall time.
  expect(shown()).toBe(2);
  player = { ...player, speed: 2 };
  await render();
  await advance(1016, 2.032);
  expect(shown()).toBeCloseTo(2.032);
  player = { ...player, status: "buffering" };
  await render();
  expect(frames.size).toBe(0);
  await advance(2000);
  expect(shown()).toBeCloseTo(2.032);
});

it("pause, seek, restart and a different player snap immediately and cancel old frames", async () => {
  await render();
  mediaTime = 2.123; player = { ...player, status: "paused" };
  await render(); expect(shown()).toBeCloseTo(2.123); expect(frames.size).toBe(0);
  mediaTime = 7.25; player = { ...player, position: 7.25 };
  await render(); expect(shown()).toBe(7.25);
  mediaTime = 0; player = { ...player, status: "playing", position: 0 };
  await render(); expect(shown()).toBe(0);
  mediaTime = 0.5; player = { ...player, id: 2, position: 0.5 };
  await render(); expect(shown()).toBe(0.5);
  await render(null); expect(shown()).toBe(0); expect(frames.size).toBe(0);
});

it("keyboard seeking keeps fractional precision", async () => {
  player = { ...player, status: "paused" };
  await render();
  await act(async () => host.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(onSeek).toHaveBeenCalledWith(2.01);
});
