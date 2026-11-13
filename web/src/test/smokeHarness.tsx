import { beforeAll, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import { resetEpisodeCache } from "../screens/Episodes";
import { resetLastAnalysisOffer } from "../screens/StudyInput";
import { REGISTRY } from "../screens/registry";
import { fake, installFakeBackend } from "./fakeBackend";
import { resetReviewCache } from "../api/review";

/** Shared setup for the smoke suites: one App per file on the fake backend. */
export function setupSmoke() {
  beforeEach(() => {
    fake.reset();
    resetReviewCache();
    resetEpisodeCache();
    resetLastAnalysisOffer();
  });

  beforeAll(async () => {
    installFakeBackend();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Element.prototype.scrollIntoView = () => {};
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => createRoot(document.getElementById("root")!).render(<App />));
  });
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList;
}

export const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
export const TARGET = "J’ai oublié mon rendez-vous";

/** Whole-document text + accessible attributes + document title + URL (excluding learner-typed textarea values). */
export function wholeDocumentSnapshot(): string {
  const bodyText = document.body.textContent ?? "";
  const ariaLabels = Array.from(document.querySelectorAll("[aria-label]"))
    .map((e) => e.getAttribute("aria-label"))
    .join(" ");
  const titles = Array.from(document.querySelectorAll("[title]"))
    .map((e) => e.getAttribute("title"))
    .join(" ");
  return `${bodyText} ${ariaLabels} ${titles} ${document.title} ${location.href} ${location.hash}`;
}


/* ---------------- round 3: session size, quota, mid-session changes ---------------- */

export const mainText = () => document.getElementById("main")!.textContent!;
export const statValue = (label: string) => {
  const dt = Array.from(document.querySelectorAll("dt")).find((el) => el.textContent === label);
  return dt?.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim() ?? "";
};
export const findButton = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text);
export function fieldByLabel(label: string): HTMLInputElement {
  const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent === label)!;
  return document.getElementById(l.getAttribute("for")!) as HTMLInputElement;
}
export function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
export const quotaState = (key: string) => REGISTRY.find((r) => r.id === "SCR-QUO-02")!.states.find((s) => s.key === key)!.apply();

export function openHistoryRow(snippet: string): HTMLButtonElement {
  const row = Array.from(document.querySelectorAll("#main tr")).find((tr) => tr.textContent?.includes(snippet));
  const btn = row && Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Open");
  if (!btn) throw new Error(`No Open button in a row containing "${snippet}"`);
  return btn;
}
export function buttonWith(text: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>("#main button, [role=dialog] button")).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`No button with "${text}"`);
  return b;
}

export function studyRecord(id: string, frs: string[]) {
  return {
    id,
    type: "study",
    text: frs.join(" ") || "x",
    created_at: "2026-01-01T10:00:00Z",
    source: "text",
    sentences: frs.map((fr) => ({ sentence: fr, translation_en: "", translation_zh: "", build_up: [], words: [], grammar_points: [] })),
    sentenceCount: frs.length,
  } as Record<string, unknown>;
}

export function attemptRow(id: string, sentence: string, correct = true) {
  return { id, item_id: "i", mode: "write", step: 0, answer: sentence, expected: sentence, accuracy: correct ? 100 : 50, correct, created_at: "2026-01-01T10:00:00Z", sentence };
}
