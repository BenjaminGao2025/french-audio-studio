/* Recall and Dictation grading on the server (routers/dictation.py). Every graded attempt is saved there. */
import { apiFetch } from "./client";

export interface PracticeSource {
  fr: string;
  en: string;
  steps: { fr: string; en: string }[];
}

export interface AttemptResult {
  attempt_id: string;
  correct: boolean;
  accent_only: boolean;
  accuracy: number;
  saved: boolean;
  expected: string;
}

const items = new Map<string, Promise<string>>();

/** The server item for a sentence and its build-up steps (step 0 is the whole sentence, 1..N the steps). */
export function dictationItem(src: PracticeSource): Promise<string> {
  const key = JSON.stringify([src.fr, src.en, src.steps]);
  let p = items.get(key);
  if (!p) {
    p = apiFetch<{ item_id: string }>("/api/dictation/items", {
      body: { sentence: src.fr, translation_en: src.en, build_up: src.steps.map((s) => ({ fr: s.fr, en: s.en, new: "" })) },
    }).then((r) => r.item_id);
    items.set(key, p);
    p.catch(() => items.delete(key));
  }
  return p;
}

/** Recall is "write" (English prompt), Dictation is "listen" (audio prompt). `step` 0 = whole sentence. */
export async function gradeAttempt(src: PracticeSource, kind: "Recall" | "Dictation", step: number, answer: string): Promise<AttemptResult> {
  const itemId = await dictationItem(src);
  return apiFetch<AttemptResult>("/api/dictation/attempts", {
    body: { item_id: itemId, mode: kind === "Recall" ? "write" : "listen", step, answer },
  });
}
