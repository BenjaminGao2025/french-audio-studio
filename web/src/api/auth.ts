/* Account endpoints (routers/auth.py) and the signed-in user, shared by the shell and Settings. */
import { useSyncExternalStore } from "react";
import { ApiError, apiFetch, getToken, setToken } from "./client";

/** auth_db.get_user_status */
export interface AuthUser {
  id: number;
  email: string;
  plan: string;
  created_at?: string;
  trial_expires_at: string | null;
  days_left: number;
  is_valid: boolean;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** "error": the server could not be reached; the token is kept so a retry can succeed. */
export type SessionStatus = "checking" | "in" | "out" | "error";

let session: { status: SessionStatus; user: AuthUser | null } = { status: "checking", user: null };
const listeners = new Set<() => void>();

function setSession(next: typeof session) {
  session = next;
  listeners.forEach((l) => l());
}

export function getSession() {
  return session;
}

export function useSession() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch<AuthResponse>("/api/auth/login", { body: { email, password }, noAuthRedirect: true });
  setToken(res.token);
  setSession({ status: "in", user: res.user });
  return res.user;
}

export async function register(email: string, password: string, inviteCode = ""): Promise<AuthUser> {
  const res = await apiFetch<AuthResponse>("/api/auth/register", {
    body: { email, password, invite_code: inviteCode },
    noAuthRedirect: true,
  });
  setToken(res.token);
  setSession({ status: "in", user: res.user });
  return res.user;
}

/** Resolves the session on load: no token or a token the server rejects → out; network trouble → error. */
export async function loadMe(): Promise<SessionStatus> {
  if (!getToken()) {
    setSession({ status: "out", user: null });
    return "out";
  }
  setSession({ status: "checking", user: null });
  try {
    const user = await apiFetch<AuthUser>("/api/auth/me", { noAuthRedirect: true });
    setSession({ status: "in", user });
  } catch (e) {
    const rejected = e instanceof ApiError && (e.status === 401 || e.status === 404);
    if (rejected) setToken("");
    setSession({ status: rejected ? "out" : "error", user: null });
  }
  return session.status;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", noAuthRedirect: true });
  } finally {
    // Signed out locally even if the network call failed; the server session expires on its own.
    setToken("");
    setSession({ status: "out", user: null });
  }
}

/** auth_db.list_sessions, one per signed-in browser. */
export interface Device {
  id: string;
  device: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export const listDevices = () => apiFetch<{ devices: Device[]; max_devices: number }>("/api/auth/devices");

export const signOutDevice = (id: string) => apiFetch<{ success: boolean }>(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
