// Same-origin JSON API client. Bearer token auth shared with the legacy pages.

export const TOKEN_KEY = "frenchStudio.userToken";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Retry transient failures only: a 4xx (404 = not on this server, 401, 422) will not change. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Minutes west-positive, unchanged from JavaScript (Vancouver PDT = 420). */
export function tzOffset(): number {
  return new Date().getTimezoneOffset();
}

type Opts = {
  method?: string;
  body?: unknown;
  form?: FormData;
  /** Raw request body (e.g. recorded audio): the backend reads bytes, not multipart. */
  raw?: Blob;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function request<T>(path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body: BodyInit | null = null;
  if (opts.raw) {
    headers["Content-Type"] = opts.raw.type || "application/octet-stream";
    body = opts.raw;
  } else if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: opts.method ?? "GET", headers, body });
  } catch {
    throw new ApiError(0, "Network error — is the server reachable?");
  }
  if (res.status === 401) {
    setToken(null);
    if (!window.location.pathname.includes("/login")) {
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    throw new ApiError(401, "Not signed in");
  }
  if (!res.ok) {
    let detail: unknown;
    let message = `Request failed (${res.status})`;
    try {
      detail = await res.json();
      const d = detail as { detail?: { message?: string } | string };
      if (typeof d.detail === "string") message = d.detail;
      else if (d.detail?.message) message = d.detail.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
