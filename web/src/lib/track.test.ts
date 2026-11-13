// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BATCH,
  ENDPOINT,
  MAX_QUEUE,
  beaconEvents,
  flushEvents,
  queued,
  resetTracking,
  routePattern,
  sessionId,
  slug,
  startTracking,
  tickScreen,
  track,
} from "./track";
import { announce, set } from "../state/store";
import { setToken } from "../api/client";
import type { PlayerState } from "../state/store";

type Call = { path: string; body: { session: string; events: { name: string; route: string; props: Record<string, unknown> }[] } };
let calls: Call[] = [];
let status = 204;

beforeEach(() => {
  resetTracking();
  calls = [];
  status = 204;
  set(() => ({ route: "study" }));
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ path: String(input), body: JSON.parse(String(init.body)) });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify({ detail: { code: "x", message: "no" } }), { status });
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("routePattern and slug", () => {
  it("keeps word segments and hides ids and queries", () => {
    expect(routePattern("review/session?card=abc")).toBe("review/session");
    expect(routePattern("practice/write/7f3a9c")).toBe("practice/write/:id");
    expect(routePattern("progress/history?tab=time")).toBe("progress/history");
    expect(routePattern("")).toBe("");
  });

  it("turns an app message into a short token", () => {
    expect(slug("Audio couldn’t play.")).toBe("audio-couldnt-play");
    expect(slug("Checking didn’t finish. This is not a wrong answer. Your answer is kept.").length).toBeLessThanOrEqual(40);
    expect(slug("Résumé échoué")).toBe("resume-echoue");
  });
});

describe("queue", () => {
  it("records the screen pattern and drops text-like or invalid properties", () => {
    set(() => ({ route: "practice/write/abc123?x=1" }));
    track("word_tap", { nested: true, n: 2, tab: "words", typed: "je suis là", "Bad Key": 1, inf: Infinity });
    track("Not A Name");
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ name: "word_tap", route: "practice/write/:id", props: { nested: true, n: 2, tab: "words" } });
  });

  it("keeps at most MAX_QUEUE events, dropping the oldest", () => {
    for (let i = 0; i < MAX_QUEUE + 5; i++) track("play", { i });
    expect(queued()).toHaveLength(MAX_QUEUE);
    expect(queued()[0].props.i).toBe(5);
  });

  it("flushes in batches with the page session id", async () => {
    for (let i = 0; i < BATCH + 3; i++) track("play", { i });
    await flushEvents();
    expect(calls.map((c) => c.body.events.length)).toEqual([BATCH, 3]);
    expect(calls[0].path).toBe(ENDPOINT);
    expect(calls[0].body.session).toBe(sessionId);
    expect(queued()).toHaveLength(0);
  });

  it("keeps events after a network error or 429, drops them after other client errors", async () => {
    track("play");
    status = 503;
    await flushEvents();
    expect(queued()).toHaveLength(1);
    status = 429;
    await flushEvents();
    expect(queued()).toHaveLength(1);
    status = 422;
    await flushEvents();
    expect(queued()).toHaveLength(0);
  });

  it("stops recording after a 401 until the learner signs in again", async () => {
    setToken("");
    track("play");
    status = 401;
    await flushEvents();
    track("play");
    expect(queued()).toHaveLength(0);
    setToken("new-session-token");
    try {
      track("play");
      expect(queued()).toHaveLength(1);
    } finally {
      setToken("");
    }
  });

  it("hands the queue to sendBeacon when the page goes away", async () => {
    const sent: { url: string; body: string }[] = [];
    const beacon = vi.fn((url: string, data: Blob) => {
      const reader = new FileReader(); // jsdom's Blob has no text()
      reader.onload = () => sent.push({ url, body: String(reader.result) });
      reader.readAsText(data);
      return true;
    });
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    try {
      track("play");
      track("word_tap");
      beaconEvents();
      expect(beacon).toHaveBeenCalledTimes(1);
      expect(queued()).toHaveLength(0);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0].url).toBe(ENDPOINT);
      expect(JSON.parse(sent[0].body).events.map((e: { name: string }) => e.name)).toEqual(["play", "word_tap"]);
      // A refused beacon keeps the events for the next flush.
      beacon.mockReturnValue(false);
      track("play");
      beaconEvents();
      expect(queued()).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, "sendBeacon");
    }
  });
});

describe("automatic events", () => {
  it("records screen views, time on screen, tabs, playback and errors", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(1_000_000);
    const stop = startTracking();
    try {
      document.dispatchEvent(new Event("pointerdown"));
      for (let i = 0; i < 6; i++) {
        vi.setSystemTime(Date.now() + 5_000);
        tickScreen();
      }
      set(() => ({ route: "review/session?card=1" }));
      set((s) => ({ study: { ...s.study, tab: "words" } })); // not on Study: ignored
      set(() => ({ route: "study" }));
      set((s) => ({ study: { ...s.study, tab: "grammar" } }));
      set(() => ({ player: { id: 77, owner: { kind: "episode", label: "x", route: "study" }, speed: 1.25 } as PlayerState }));
      announce("Audio couldn’t play.", true);
      announce("Saved.");
      const names = queued().map((e) => [e.name, e.route, e.props]);
      expect(names).toEqual([
        ["screen_view", "study", {}],
        ["screen_time", "study", { seconds: 30 }],
        ["screen_view", "review/session", {}],
        ["screen_view", "study", {}],
        ["tab_view", "study", { tab: "grammar" }],
        ["play", "study", { owner: "episode", speed: 1.25 }],
        ["error_shown", "study", { msg: "audio-couldnt-play" }],
      ]);
    } finally {
      stop();
      set(() => ({ player: null }));
    }
  });

  it("does not count idle or hidden time", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(2_000_000);
    const stop = startTracking();
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000); // nobody touched the page for 10 minutes
      tickScreen();
      set(() => ({ route: "review" }));
      expect(queued().filter((e) => e.name === "screen_time")).toEqual([]);
    } finally {
      stop();
    }
  });
});
