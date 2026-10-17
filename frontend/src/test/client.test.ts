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
