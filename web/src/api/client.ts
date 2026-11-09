/* Fetch wrapper for the FastAPI backend: bearer token, JSON in and out, typed errors, 401 → login. */

// The key the old pages already use, so a signed-in learner stays signed in.
export const TOKEN_KEY = "frenchStudio.userToken";
export const APP_BASE = "/app";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private mode): the session cookie set by the server still works for this tab.
  }
}

/** The in-app path (after /app/) to come back to after signing in. */
export function currentAppPath(): string {
  const path = location.pathname.startsWith(APP_BASE + "/") ? location.pathname.slice(APP_BASE.length + 1) : "";
  return path + location.search;
}

export function loginUrl(next = currentAppPath()): string {
  const clean = next.startsWith("login") ? "" : next;
  return `${APP_BASE}/login${clean ? `?next=${encodeURIComponent(clean)}` : ""}`;
}

/** Overridable so tests can observe the redirect instead of navigating jsdom. */
export const navigation = {
  toLogin(next?: string) {
    location.assign(loginUrl(next));
  },
};

function errorFrom(status: number, body: unknown): ApiError {
  // FastAPI's detail is a string, {code, message}, or a validation list.
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return new ApiError(status, detail);
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as { code?: unknown; message?: unknown };
    return new ApiError(status, typeof d.message === "string" ? d.message : `Request failed (${status})`, typeof d.code === "string" ? d.code : undefined);
  }
  return new ApiError(status, `Request failed (${status})`);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the 401 → login redirect (the login form itself, or a background check). */
  noAuthRedirect?: boolean;
}

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
    signal: opts.signal,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = errorFrom(res.status, data);
    if (res.status === 401 && !opts.noAuthRedirect) navigation.toLogin();
    throw err;
  }
  return data as T;
}
