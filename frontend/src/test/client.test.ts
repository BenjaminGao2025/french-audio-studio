import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request, setToken, getToken, tzOffset, TOKEN_KEY } from "@/api/client";
import { real } from "@/api/real";
beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("adds the stored bearer token", async () => {
  window.localStorage.setItem(TOKEN_KEY, "test-token");
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await request("/api/test");
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer test-token" });
});
it("clears token and redirects to the app login on 401", async () => {
  const original = window;
  const assign = vi.fn();
  vi.stubGlobal("window", {
    localStorage: original.localStorage,
    location: { origin: "http://localhost", pathname: "/journal", assign },
  });
  setToken("expired");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
  try {
    await expect(request("/api/test")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(assign).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}login`);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each([420, -120])("keeps timezone offset %s unchanged", (value) => {
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(value);
  expect(tzOffset()).toBe(value);
});
it("includes west-positive 420 in queries and heartbeat bodies", async () => {
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(420);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
  await request("/api/game/state", { query: { tz_offset: tzOffset() } });
  expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get("tz_offset")).toBe("420");
  await real.game.heartbeat("listening", 15);
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
    lane: "listening",
    seconds: 15,
    tz_offset: 420,
  });
});
it("sends recorded audio as the raw body, not multipart", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"text":"salut"}'));
  const audio = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  const res = await real.speech.transcribe(audio);
  const [url, init] = fetcher.mock.calls[0] ?? [];
  expect(res.text).toBe("salut");
  expect(new URL(String(url)).pathname).toBe("/api/transcribe");
  expect(new URL(String(url)).searchParams.get("language")).toBe("fr");
  expect(init?.body).toBe(audio);
  expect(init?.body).not.toBeInstanceOf(FormData);
  expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("audio/webm");
});
it("falls back to octet-stream when the recorder gives no type", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await request("/api/transcribe", { method: "POST", raw: new Blob([new Uint8Array([1])]) });
  expect((fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)["Content-Type"]).toBe(
    "application/octet-stream",
  );
});
it("clamps the review duration to the backend limit of one hour", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ id: "c", note_id: "n", mode: "listen" })));
  await real.srs.review("c", 3, 7_200_000);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).duration_ms).toBe(3_600_000);
});
it("normalizes the card returned by a review and keeps the game feedback", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "c",
        note_id: "n",
        mode: "listen",
        state: "review",
        importance: 3,
        note: { sentence: "Bonjour.", translation_en: "Hello.", translation_zh: "你好。" },
        game: { xp: 5 },
      }),
    ),
  );
  const res = await real.srs.review("c", 3, 1000);
  expect(res.sentence).toBe("Bonjour.");
  expect(res.game).toEqual({ xp: 5 });
});
it("returns null instead of a /tts URL the server would reject", () => {
  expect(real.speech.ttsUrl("")).toBeNull();
  expect(real.speech.ttsUrl("   ")).toBeNull();
  expect(real.speech.ttsUrl("a".repeat(601))).toBeNull();
  const ok = real.speech.ttsUrl("a".repeat(600));
  expect(ok).toContain("/tts?text=");
  expect(real.speech.ttsUrl("é à")).toContain(encodeURIComponent("é à"));
});
it("unwraps the episodes envelope", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        episodes: [
          { id: "e", status: "ready", created_at: "x", settings: { level: "B1", minutes: 30 } },
        ],
        hours: 1,
      }),
    ),
  );
  const list = await real.episodes.list();
  expect(list).toEqual([expect.objectContaining({ id: "e", level: "B1", minutes: 30 })]);
});
it("sends the timezone when toggling the minimal day (the server picks the study day from it)", async () => {
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(420);
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await real.today.minimal(true);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
    on: true,
    tz_offset: 420,
  });
});
it("uploads a homework recording as a raw audio body with kind in the query", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  const audio = new Blob(["x".repeat(200)], { type: "audio/webm;codecs=opus" });
  await real.homework.uploadRecording("j1", "first", audio);
  const url = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/api/homework/j1/recordings");
  expect(url.searchParams.get("kind")).toBe("first");
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.method).toBe("POST");
  expect(init?.body).toBe(audio);
  expect(init?.headers).toMatchObject({ "Content-Type": "audio/webm;codecs=opus" });
});
