/* History on the server: analyses (/api/history, type "study") and Recall/Dictation attempts (/api/dictation/history). */
import { apiFetch } from "./client";
import type { ApiSentence } from "./study";

export type SourceLabel = "Pasted text" | "Photo import" | "My own idea";

export interface StudyRecord {
  id: string;
  text: string;
  created_at: string;
  sentences?: ApiSentence[];
  sentenceCount?: number;
  source?: string;
}

const SOURCE_LABEL: Record<string, SourceLabel> = { text: "Pasted text", photo: "Photo import", idea: "My own idea" };
export const sourceLabel = (r: Pick<StudyRecord, "source">): SourceLabel => SOURCE_LABEL[r.source ?? ""] ?? "Pasted text";

/** Only records that still hold their analysed sentences can be opened again. */
export const canReopen = (r: StudyRecord) => Array.isArray(r.sentences) && r.sentences.some((s) => s && typeof s.sentence === "string");
export const sentenceCount = (r: StudyRecord) => (Array.isArray(r.sentences) ? r.sentences.length : (r.sentenceCount ?? 0));

export const listStudyRecords = (limit = 200) =>
  apiFetch<{ records: StudyRecord[]; count: number }>(`/api/history?type=study&limit=${limit}`).then((r) => r.records ?? []);
export const clearStudyRecords = () => apiFetch<{ deleted: number }>("/api/history?type=study", { method: "DELETE" });

export interface AttemptRecord {
  id: string;
  item_id: string;
  mode: "write" | "listen";
  step: number;
  answer: string;
  expected: string;
  /** 0–100, as the server grades it. */
  accuracy: number;
  correct: boolean;
  created_at: string;
  sentence: string;
}

export const listAttempts = (limit = 200) => apiFetch<{ attempts: AttemptRecord[]; total: number }>(`/api/dictation/history?limit=${limit}`);
export const clearAttempts = () => apiFetch<{ deleted: number }>("/api/dictation/history", { method: "DELETE" });

export const attemptKind = (a: Pick<AttemptRecord, "mode">) => (a.mode === "write" ? "Recall" : "Dictation");

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
