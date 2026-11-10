// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, TOKEN_KEY, apiFetch, loginUrl, navigation } from "./client";
import { getSession, loadMe, login, logout } from "./auth";
import { safeNext } from "../screens/Login";
import { parseLocation } from "../state/store";

function respond(status: number, body?: unknown) {
  return vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/app/review/session?x=1");
});
afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("sends the stored bearer token and JSON body", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    const f = respond(200, { ok: true });
    vi.stubGlobal("fetch", f);
    expect(await apiFetch("/api/x", { body: { a: 1 } })).toEqual({ ok: true });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("turns string and {code, message} details into ApiError", async () => {
    vi.stubGlobal("fetch", respond(422, { detail: "请输入需要处理的文本。" }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 422, message: "请输入需要处理的文本。" });
    vi.stubGlobal("fetch", respond(403, { detail: { code: "nope", message: "No." } }));
    const err = await apiFetch("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "nope", message: "No." });
  });

  it("redirects to login with the current path on 401, and keeps the token", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    const toLogin = vi.spyOn(navigation, "toLogin").mockImplementation(() => {});
    vi.stubGlobal("fetch", respond(401, { detail: { code: "login_required", message: "请先登录账号。" } }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 401, code: "login_required" });
    expect(toLogin).toHaveBeenCalledTimes(1);
    expect(loginUrl()).toBe("/app/login?next=review%2Fsession%3Fx%3D1");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
  });

  it("does not redirect when asked not to", async () => {
    const toLogin = vi.spyOn(navigation, "toLogin").mockImplementation(() => {});
    vi.stubGlobal("fetch", respond(401, {}));
    await expect(apiFetch("/api/x", { noAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
    expect(toLogin).not.toHaveBeenCalled();
  });
});

describe("session", () => {
  const user = { id: 1, email: "a@b.c", plan: "trial", trial_expires_at: null, days_left: 3, is_valid: true };

  it("login stores the token under the existing key", async () => {
    vi.stubGlobal("fetch", respond(200, { token: "new", user }));
    await login("a@b.c", "pw");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new");
    expect(getSession()).toEqual({ status: "in", user });
  });

  it("loadMe: no token → out; rejected token → out and cleared; network failure → error and kept", async () => {
    expect(await loadMe()).toBe("out");
    localStorage.setItem(TOKEN_KEY, "old");
    vi.stubGlobal("fetch", respond(401, { detail: { code: "session_revoked", message: "x" } }));
    expect(await loadMe()).toBe("out");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    localStorage.setItem(TOKEN_KEY, "old");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await loadMe()).toBe("error");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old");
  });

  it("logout clears the token even when the request fails", async () => {
    localStorage.setItem(TOKEN_KEY, "tok");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await logout().catch(() => {});
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(getSession().status).toBe("out");
  });
});

describe("routing", () => {
  it("reads the route from the /app/ path", () => {
    history.replaceState(null, "", "/app/");
    expect(parseLocation()).toBe("study");
    history.replaceState(null, "", "/app/review/session/");
    expect(parseLocation()).toBe("review/session");
    history.replaceState(null, "", "/app/review/library/?from=bookmark");
    expect(parseLocation()).toBe("review/saved?from=bookmark");
    history.replaceState(null, "", "/app/progress/history?tab=attempts");
    expect(parseLocation()).toBe("progress/history?tab=attempts");
    history.replaceState(null, "", "/app/cockpit");
    expect(parseLocation()).toBe("moved");
  });

  it("only follows in-app next paths after sign-in", () => {
    expect(safeNext("?next=review%2Fsession")).toBe("review/session");
    for (const bad of ["", "?next=%2F%2Fevil.com", "?next=https%3A%2F%2Fevil.com", "?next=%2Fapi%2Fx", "?next=login"])
      expect(safeNext(bad)).toBe("study");
  });
});
