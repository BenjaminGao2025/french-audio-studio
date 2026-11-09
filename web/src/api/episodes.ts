/* Episodes (routers/episodes.py): AI-written listening programmes rendered to MP3 + LRC in the background. */
import { apiFetch, getToken } from "./client";

export type EpisodeLevel = "A1" | "A2" | "B1" | "B2";

export interface ServerEpisode {
  id: string;
  title: string | null;
  status: "generating" | "ready" | "failed";
  duration: number | null;
  error: string | null;
  created_at: string;
  settings: { level?: EpisodeLevel; minutes?: number; request?: string };
}

export interface EpisodeList {
  episodes: ServerEpisode[];
  hours: number;
  recommended_level: EpisodeLevel;
  levels: EpisodeLevel[];
  lengths: number[];
}

export interface Cue {
  at: number;
  text: string;
  /** A second line (the subtitle's translation or note), when the cue has one. */
  sub?: string;
}

export const listEpisodes = () => apiFetch<EpisodeList>("/api/episodes");

export const createEpisode = (p: { level?: EpisodeLevel; minutes: number; request?: string; replace_id?: string }) =>
  apiFetch<ServerEpisode>("/api/episodes", { body: p });

export const deleteEpisode = (id: string) => apiFetch<{ success: boolean }>(`/api/episodes/${id}`, { method: "DELETE" });

export const episodeAudioUrl = (id: string) => `/episodes/${id}.mp3`;
export const episodeFileUrl = (id: string, ext: "mp3" | "srt" | "lrc") => `/episodes/${id}.${ext}?download=true`;

/** `[mm:ss.cc]text` lines; " / " joins a cue's lines. Metadata tags like [ti:…] are skipped. */
export function parseLrc(lrc: string): Cue[] {
  const out: Cue[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const m = /^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\](.*)$/.exec(line.trim());
    if (!m) continue;
    const at = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0);
    const [text, ...rest] = m[4].split(" / ");
    if (!text.trim()) continue;
    out.push({ at, text: text.trim(), sub: rest.join(" / ").trim() || undefined });
  }
  return out;
}

export async function loadTranscript(id: string): Promise<Cue[]> {
  // The file route reads the session cookie; the bearer header works too.
  const res = await fetch(`/episodes/${id}.lrc`, { credentials: "same-origin", headers: tokenHeader() });
  if (!res.ok) throw new Error(`Transcript request failed (${res.status})`);
  return parseLrc(await res.text());
}

function tokenHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* Listening positions stay on this device (the server keeps no position). */
const POS_KEY = "frenchStudio.episodePositions";

export function savedPositions(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function savePosition(id: string, seconds: number) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ ...savedPositions(), [id]: Math.max(0, Math.round(seconds)) }));
  } catch {
    // storage blocked: the position is only kept for this visit
  }
}

export function episodeTitle(e: ServerEpisode): string {
  if (e.title) return e.title;
  const d = new Date(e.created_at);
  return `Episode of ${Number.isNaN(d.getTime()) ? "today" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
