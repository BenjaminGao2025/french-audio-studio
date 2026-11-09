// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import { REGISTRY } from "./screens/registry";
import { get, resetDemo, set } from "./state/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const TARGET = "J’ai oublié mon rendez-vous";

function visibleText() {
  const root = document.getElementById("main")!;
  const names = Array.from(root.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label")).join(" ");
  return `${root.textContent} ${names} ${document.title} ${location.hash}`;
}

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => createRoot(document.getElementById("root")!).render(<App />));
});

describe("every registered state renders", () => {
  for (const screen of REGISTRY)
    for (const st of screen.states)
      it(`${screen.id}/${st.key}`, async () => {
        await act(async () => {
          resetDemo();
          set(() => ({ auth: "in", frame: "fluid" }));
        });
        await act(async () => st.apply());
        await wait(30);
        expect(document.querySelector("main")).toBeTruthy();
        expect(document.querySelector("[data-page-title]")).toBeTruthy();
      });
});

describe("no answer leakage before submission", () => {
  const unrevealed: [string, string][] = [
    ["SCR-REC-01", "empty"], ["SCR-REC-01", "typing"], ["SCR-REC-01", "empty-check"], ["SCR-REC-01", "hint"], ["SCR-REC-01", "drafts"],
    ["SCR-DIC-01", "empty"], ["SCR-DIC-01", "hint"], ["SCR-DIC-01", "step"], ["SCR-DIC-01", "audio-error"], ["SCR-REC-01", "submitting"],
  ];
  for (const [id, key] of unrevealed)
    it(`${id}/${key}`, async () => {
      await act(async () => resetDemo());
      await act(async () => REGISTRY.find((r) => r.id === id)!.states.find((s) => s.key === key)!.apply());
      await wait(900);
      expect(visibleText()).not.toContain(TARGET);
    });

  it("study-level recall hides the current sentence", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REC-01")!.states.find((s) => s.key === "study")!.apply());
    await wait(50);
    expect(visibleText()).not.toContain("j’ai failli oublier mon rendez-vous");
  });
});

describe("result patterns", () => {
  it("correct result shows the answer once, with no leftover input", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states[0].apply());
    await wait(1700);
    const text = document.getElementById("main")!.textContent!;
    expect(text.split(TARGET).length - 1).toBe(1);
    expect(document.querySelector("#main textarea")).toBeNull();
  });
  it("technical failure retries the same attempt", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REC-01")!.states.find((s) => s.key === "techfail")!.apply());
    await wait(900);
    expect(get().attempts).toHaveLength(1);
    const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry check")!;
    await act(async () => retry.click());
    await wait(900);
    expect(get().attempts).toHaveLength(1);
    expect(get().attempts[0].status).toBe("completed");
  });
  it("incorrect accent shows one comparison pair", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-02")!.states.find((s) => s.key === "accent")!.apply());
    await wait(1700);
    const text = document.getElementById("main")!.textContent!;
    expect(text).toContain("Your answer");
    expect(text).toContain("Correct answer");
    expect(text).toContain("Accent");
  });
});
