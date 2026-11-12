import { useSyncExternalStore } from "react";

export type ExplanationLanguage = "en" | "zh";
const listeners = new Set<() => void>();
// Also retain the current choice when browser storage is unavailable.
let fallback: ExplanationLanguage = "en";
export function readExplanationLanguage(): ExplanationLanguage {
  try { return localStorage.getItem("explanationLanguage") === "zh" ? "zh" : "en"; }
  catch { return fallback; }
}
export function chooseExplanationLanguage(value: string) {
  if (value !== "en" && value !== "zh") return;
  fallback = value;
  try { localStorage.setItem("explanationLanguage", value); } catch { /* Keep it for this visit. */ }
  listeners.forEach(listener => listener());
}
export function useExplanationLanguage() {
  const language = useSyncExternalStore(listener => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
  }, readExplanationLanguage);
  return [language, chooseExplanationLanguage] as const;
}
