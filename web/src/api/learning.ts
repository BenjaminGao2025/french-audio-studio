/** Restored learning tools use the same endpoints and saved records as the original study page. */
import { ApiError, apiFetch, getToken, navigation } from "./client";
import type { StudySentence } from "../data/fixtures";
import { loadSavedCards } from "./srs";

export const sentenceContext = (s: StudySentence) => ({
  sentence: s.fr,
  translation_zh: s.raw?.translation_zh ?? "",
  grammar_points: (s.raw?.grammar_points ?? []).slice(0, 5).map(({ title, explanation }) => ({ title, explanation })),
});
export interface ExplanationFeedback {
  verdict: "solid" | "partial" | "missing";
  got_right: string[];
  gaps: string[];
  variation: { ok: boolean; corrected: string; note: string } | null;
  follow_up: string;
}
export interface TutorTurn { role: "learner" | "tutor"; content: string }
export const checkExplanation = (s: StudySentence, explanation: string, variation: string, signal?: AbortSignal) =>
  apiFetch<ExplanationFeedback>("/api/feynman", { body: { ...sentenceContext(s), explanation, variation }, signal });
export const askQuestion = (s: StudySentence, question: string, history: TutorTurn[], signal?: AbortSignal) =>
  apiFetch<{ answer: string }>("/api/ask", { body: { ...sentenceContext(s), question, history: history.slice(-12) }, signal });
export async function saveGrammar(s: StudySentence, grammar: { title: string; explanation: string; hook: string }) {
  await apiFetch("/api/srs/grammar", { body: { sentence: s.fr, translation_en: s.en, translation_zh: s.raw?.translation_zh ?? "", grammar } });
  await loadSavedCards([s.fr]).catch(() => undefined);
}
export async function saveAnswer(s: StudySentence, question: string, answer: string) {
  await apiFetch("/api/ask/card", { body: { sentence: s.fr, translation_en: s.en, translation_zh: s.raw?.translation_zh ?? "", question, answer } });
  await loadSavedCards([s.fr]).catch(() => undefined);
}

/** Private media must carry the bearer token too; never put tokens in media URLs. */
export async function mediaRequest(path: string, body?: Blob, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = body.type || "audio/webm";
  const r = await fetch(path, { method: body ? "POST" : "GET", headers, body, signal, credentials: "same-origin" });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    if (r.status === 401) navigation.toLogin();
    throw new ApiError(r.status, typeof data?.detail === "string" ? data.detail : data?.detail?.message || `Request failed (${r.status})`);
  }
  return r;
}
export async function transcribeTake(blob: Blob, language: "fr" | "zh", sentence = "", signal?: AbortSignal) {
  const q = new URLSearchParams({ language, sentence: sentence.slice(0, 1000) });
  const r = await mediaRequest(`/api/transcribe?${q}`, blob, signal);
  const data = await r.json() as { text: string };
  if (!data.text?.trim()) throw new Error("No speech was recognised. Please record again.");
  return data.text.trim();
}
export async function transcribeExplanation(blob: Blob, s: StudySentence, signal?: AbortSignal) {
  const text = await transcribeTake(blob, "zh", s.fr, signal);
  // The correction repairs misheard French inside an explanation, keeping the learner's ideas.
  try {
    const fixed = await apiFetch<{ text: string }>("/api/transcribe/fix", { body: { sentence: s.fr, text }, signal });
    return fixed.text || text;
  } catch { return text; }
}
export interface JournalRecording { id: string; kind: "first" | "final"; duration: number; url: string; created_at: string }
export interface JournalEntry {
  id: string; native_text: string; french: string; reference_url: string; complete: boolean;
  reflection: string; recalled: boolean | number; practice_seconds: number; created_at: string;
  parts: { source: string; french: string }[]; recordings: JournalRecording[]; can_expand: boolean;
}
export const listJournals = () => apiFetch<{ entries: JournalEntry[] }>("/api/homework");
export const getJournal = (id: string) => apiFetch<JournalEntry>(`/api/homework/${encodeURIComponent(id)}`);
export const createJournal = (native_text: string) => apiFetch<JournalEntry>("/api/homework", { body: { native_text } });
export const prepareJournal = (id: string, expand = false, repair_audio = false) =>
  apiFetch<JournalEntry>(`/api/homework/${id}/prepare`, { body: { expand, repair_audio } });
export const finishJournal = (id: string, reflection: string, recalled: boolean) =>
  apiFetch<JournalEntry>(`/api/homework/${id}/finish`, { body: { reflection, recalled } });
export async function saveRecording(id: string, kind: "first" | "final", audio: Blob) {
  return (await mediaRequest(`/api/homework/${id}/recordings?kind=${kind}`, audio)).json() as Promise<JournalEntry>;
}
export async function downloadJournal(id: string) {
  const blob = await (await mediaRequest(`/api/homework/${id}/archive`)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `french-practice-${id}.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export interface GrammarPoint { id: string; name_en: string; name: string; count: number; focus: boolean; [key: string]: unknown }
export interface GrammarBlock { id: string; en: string; zh: string; points: GrammarPoint[] }
export const getGrammarMap = () => apiFetch<{ blocks: GrammarBlock[]; seen: number }>("/api/grammar/map");
export const getGrammarSentences = (id: string) => apiFetch<{ sentences: { sentence: string; translation_en?: string; translation_zh?: string }[] }>(`/api/grammar/${encodeURIComponent(id)}/sentences`);
