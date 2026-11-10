// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { beat, creditFor, flush, laneForAudio, laneForRoute, pendingSeconds, resetStudyTime } from "./time";
import { fake, installFakeBackend } from "../test/fakeBackend";
import { set } from "../state/store";
import type { PlayerOwner, PlayerState } from "../state/store";

describe("lanes", () => {
  it("counts each screen under its skill and episodes as listening on the go", () => {
    expect(laneForRoute("study/personal")).toBeNull();
    expect(laneForRoute("study/recall")).toBe("reading");
    expect(laneForRoute("review/session?x=1")).toBe("review");
    expect(laneForRoute("practice/write")).toBe("writing");
    expect(laneForRoute("practice/speak/task")).toBe("speaking");
    expect(laneForRoute("progress")).toBeNull();
    expect(laneForAudio({ kind: "episode", episodeId: "e1" } as PlayerOwner, "study")).toBe("car");
    expect(laneForAudio({ kind: "study" } as PlayerOwner, "progress")).toBe("listening");
    expect(laneForAudio({ kind: "study" } as PlayerOwner, "review")).toBe("review");
  });
});

describe("creditFor", () => {
  it("takes the larger of page time and audio time, never the sum", () => {
    expect(creditFor({ wall: 5, audio: 5, audioWall: 5, active: true })).toBe(5);
    expect(creditFor({ wall: 5, audio: 2.5, audioWall: 5, active: true })).toBe(5);
    expect(creditFor({ wall: 5, audio: 0, audioWall: 5, active: false })).toBe(0);
  });

  it("caps idle-looking page gaps but keeps audio that played while timers were frozen", () => {
    expect(creditFor({ wall: 600, audio: 0, audioWall: 600, active: true })).toBe(10);
    expect(creditFor({ wall: 600, audio: 590, audioWall: 600, active: false })).toBe(590);
  });

  it("treats a jump bigger than the time that passed as a seek", () => {
    expect(creditFor({ wall: 5, audio: 300, audioWall: 5, active: false })).toBe(0);
  });
});

describe("beat and flush", () => {
  beforeAll(() => installFakeBackend());
  afterEach(() => {
    resetStudyTime();
    set(() => ({ player: null, route: "study" }));
  });

  it("counts episode audio at its real duration (2× speed counts half) under car, and sends it", async () => {
    fake.reset();
    resetStudyTime();
    const t0 = Date.now();
    beat(t0);
    // Playback starts between beats; the 4 s of audio (8 s at 2×) before the next beat count too.
    set(() => ({ route: "progress", player: { id: 1, owner: { kind: "episode", episodeId: "e1" }, position: 8, startPosition: 0, speed: 2, status: "playing" } as unknown as PlayerState }));
    beat(t0 + 5_000);
    expect(pendingSeconds()).toBe(4);
    set((s) => ({ player: { ...s.player!, position: 20 } }));
    beat(t0 + 11_000);
    expect(pendingSeconds()).toBe(10);
    set((s) => ({ player: { ...s.player!, position: 80 } }));
    beat(t0 + 40_000);
    await flush();
    expect(fake.heartbeats).toEqual({ car: 40 });
    expect(pendingSeconds()).toBe(0);
  });
});
