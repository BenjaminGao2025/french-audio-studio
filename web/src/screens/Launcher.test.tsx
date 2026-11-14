// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Launcher } from "./Launcher";
import { get, resetDemo } from "../state/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  resetDemo(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["Recall", "Dictation"] as const)("%s can retry a failed queue load even though the list is empty", async kind => {
  let failed = true;
  const f = vi.fn(async () => {
    if (failed) throw new TypeError("temporary network failure");
    return new Response(JSON.stringify({ cards: [{ id: "card", note: { id: "note", sentence: "Nous rentrons.", translation_en: "We go home." }, created_at: new Date().toISOString() }] }));
  });
  vi.stubGlobal("fetch", f);
  await act(async () => root.render(<Launcher kind={kind} />));
  const retry = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Retry")!;
  expect(retry).toBeTruthy();
  expect(retry.getAttribute("aria-disabled")).not.toBe("true");
  failed = false;
  const before = f.mock.calls.length;
  await act(async () => retry.click());
  expect(f.mock.calls.length).toBeGreaterThan(before);
  expect(host.textContent).not.toContain("Sentences didn’t load");
  expect(get().activeRun).toBeNull(); // Retry only reloads; starting is a separate action.
});
