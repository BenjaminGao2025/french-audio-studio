// The daily new-card limit, shared with the legacy review page (static/new-limit.js): the same
// localStorage key, the same GET/PUT /api/srs/settings. Any whole number from 0 to 200.
import { api, getToken } from "@/api";

export const NEW_LIMIT_KEY = "frenchStudio.srs.newLimit";
export const NEW_LIMIT_DEFAULT = 10;
export const NEW_LIMIT_MAX = 200;

/** A whole number within 0..200, or null for an empty or non-numeric value. */
export function clampNewLimit(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(NEW_LIMIT_MAX, Math.max(0, n)) : null;
}

function storeLocal(n: number) {
  try {
    window.localStorage.setItem(NEW_LIMIT_KEY, String(n));
  } catch {
    /* private mode */
  }
}

function readLocal(): number | null {
  try {
    const raw = window.localStorage.getItem(NEW_LIMIT_KEY);
    return raw === null || raw === "" ? null : clampNewLimit(parseInt(raw, 10));
  } catch {
    return null;
  }
}

/** The limit to use now: the server's when signed in (an existing local value is uploaded once). */
export async function syncNewLimit(): Promise<number> {
  const own = readLocal();
  if (!getToken()) return own ?? NEW_LIMIT_DEFAULT;
  try {
    const saved = (await api.srs.getSettings()).new_limit;
    if (typeof saved === "number") {
      storeLocal(saved);
      return saved;
    }
    if (own !== null) {
      await api.srs.putSettings(own);
      return own;
    }
  } catch {
    /* offline: this browser's own */
  }
  return own ?? NEW_LIMIT_DEFAULT;
}

/** Save a new limit. `saved` says whether the server has it (false: only this browser does). */
export async function saveNewLimit(
  value: unknown,
): Promise<{ value: number | null; saved: boolean }> {
  const n = clampNewLimit(value);
  if (n === null) return { value: null, saved: false };
  storeLocal(n);
  if (!getToken()) return { value: n, saved: false };
  try {
    await api.srs.putSettings(n);
    return { value: n, saved: true };
  } catch {
    return { value: n, saved: false };
  }
}
