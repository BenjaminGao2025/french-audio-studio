// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { playTexts, playUrl, speakOnce } from "./audio";
import { get, resetDemo, sayFrench, startPlayback, stopPlayback } from "./store";

const elements: FakeAudio[] = [];
class FakeAudio {
  src = ""; playbackRate = 1; currentTime = 0; playing = false;
  constructor() { elements.push(this); }
  play = vi.fn(async () => { this.playing = true; });
  pause = vi.fn(() => { this.playing = false; });
  load() {}
  removeAttribute() { this.src = ""; }
  getAttribute() { return this.src; }
  addEventListener() {}
}
const events = { onPlaying: vi.fn(), onProgress: vi.fn(), onEnded: vi.fn(), onError: vi.fn() };
const flush = async () => { await new Promise(r => setTimeout(r, 0)); };
function setup() {
  vi.stubGlobal("Audio", FakeAudio);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("audio regression test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
}
afterEach(() => { stopPlayback(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([false, true])("store playback and sayFrench have one owner (reverse=%s)", async reverse => {
  setup(); resetDemo();
  const start = () => startPlayback({ kind: "study", label: "step", route: "study" }, 2, { texts: ["Bonjour"] });
  if (reverse) { sayFrench("Salut"); await flush(); start(); }
  else { start(); await flush(); sayFrench("Salut"); }
  await flush();
  expect(elements.filter(a => a.playing)).toHaveLength(1);
  if (!reverse) expect(get().player?.status).toBe("paused");
});
it.each(["texts", "url"])("a superseded pending %s request never plays after session resolves", async kind => {
  setup();
  const handle = kind === "texts" ? playTexts(["Bonjour"], 1, events) : playUrl("/clip", 1, 0, events);
  const prior = elements.at(-1)!;
  speakOnce("Salut");
  await flush();
  expect(prior.play).not.toHaveBeenCalled();
  expect(elements.filter(a => a.playing)).toHaveLength(1);
  handle.stop();
});
it("pause before initial load prevents late autoplay", async () => {
  setup();
  const handle = playTexts(["Bonjour"], 1, events);
  const audio = elements.at(-1)!;
  handle.pause(); await flush();
  expect(audio.play).not.toHaveBeenCalled();
  handle.resume(); await flush();
  expect(audio.play).toHaveBeenCalledTimes(1);
  handle.stop();
});
