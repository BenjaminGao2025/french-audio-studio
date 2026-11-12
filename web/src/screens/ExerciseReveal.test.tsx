// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gradeAttempt } from "../api/dictation";
import type { PracticeItem } from "../data/fixtures";
import { get, resetDemo, set } from "../state/store";
import { ensureSession, Exercise, submitAnswer } from "./Exercise";
import { RunScreen } from "./Launcher";
import { StudyCheckTabs, StudyNavigation } from "./StudyTools";

vi.mock("../api/dictation", () => ({
  gradeAttempt: vi.fn(async () => ({ correct: true, saved: true })),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: PracticeItem[] = [{
  id: "s1",
  fr: "J'ai failli me noyer l'été dernier.",
  en: "I almost drowned last summer.",
  label: "Sentence 1",
  steps: [{ fr: "J'ai failli", en: "I almost" }],
}];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  resetDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe.each(["Recall", "Dictation"] as const)("%s exercise layout", kind => {
  describe.each([false, true])("standalone=%s", standalone => {
    it.each(["whole", "step"] as const)("coordinates toolbar, meta and card in %s scope", async mode => {
      const sessionKey = "layout-test";
      const tab = kind === "Recall" ? "recall" : "dictation";
      ensureSession(sessionKey, kind, "Current sentence", items);
      await act(async () => {
        set(s => ({ exercises: { ...s.exercises, [sessionKey]: { ...s.exercises[sessionKey], mode } } }));
        set(() => ({ activeRun: sessionKey, route: "study/run" }));
        root.render(standalone ? <RunScreen /> : <>
          <StudyNavigation value={tab} onChange={() => {}} />
          <Exercise sessionKey={sessionKey} kind={kind} source="Current sentence" items={items} onDone={() => {}}
            modeTabs={<StudyCheckTabs value={tab} onChange={() => {}} />} />
        </>);
      });
      const toolbar = host.querySelector('[aria-label="Exercise toolbar"]')!;
      expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(standalone ? 0 : 1);
      expect(Boolean(toolbar.querySelector('[role="tablist"]'))).toBe(!standalone);
      expect(toolbar.className.includes("justify-between")).toBe(!standalone);
      if (standalone) {
        expect(host.querySelector("h1")?.className).toBe("sr-only");
        expect(host.querySelector("h1")?.textContent).toBe(kind);
        expect(host.querySelector("nav")?.textContent).toContain(kind);
        expect(host.querySelector("nav")?.textContent).toContain("Session");
        expect(host.textContent).not.toContain("Check yourself");
      }
      const meta = host.querySelector('[id="ex-q-layout-test"]')!;
      expect(meta.className).toContain("text-muted-foreground");
      expect(meta.parentElement?.querySelectorAll(":scope > p")).toHaveLength(1);
      expect(meta.textContent).not.toMatch(/Source:|sentences/);
      expect(host.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
      expect(toolbar.querySelector('[aria-label="Practice scope"]')).toBeTruthy();
      expect(host.querySelector("h2")).toBeNull();
      expect(host.querySelector('[id="ex-q-layout-test"]')?.textContent).toContain(
        mode === "whole" ? "Question 1 of 1 · Current sentence" : "Question 1 of 1 · Step 1 of 1 · Current sentence",
      );
      const card = host.querySelector('[data-slot="card"]')!;
      expect(card.querySelector("textarea")).toBeTruthy();
      if (kind === "Recall") expect(card.textContent).toContain(mode === "whole" ? items[0].en : items[0].steps[0].en);
      else expect(card.querySelector('[aria-label="Play practice audio"]')).toBeTruthy();
      const actions = card.querySelector('[aria-label="Answer actions"]')!;
      expect([...actions.children].map(el => el.textContent)).toEqual(["Check", "Hint", "Answer"]);
      expect(actions.children[1].getAttribute("data-variant")).toBe("ghost");
      expect(actions.children[2].getAttribute("data-variant")).toBe("ghost");
      expect(card.querySelector('[aria-label="Hint"]')).toBeNull();
      expect(card.querySelector('[aria-label="Answer"]')).toBeNull();
      await act(async () => (actions.children[1] as HTMLButtonElement).click());
      await act(async () => (actions.children[2] as HTMLButtonElement).click());
      for (const label of ["Hint", "Answer"]) {
        const inset = card.querySelector(`[aria-label="${label}"]`)!;
        expect(inset.className).toContain("bg-muted");
        const iconLabel = inset.querySelector("svg")!.parentElement!;
        expect(iconLabel.textContent).toBe(label);
        expect(iconLabel.className).toContain("flex");
      }
      expect(card.querySelector('[aria-label="Answer"]')?.textContent).toContain("Try it now");
    });
  });
});

describe("revealed recall answer", () => {
  it("uses tappable words and Try it now hides the answer without forgetting it was shown", async () => {
    ensureSession("recall-test", "Recall", "Current sentence", items);
    const key = "0:whole:w";
    const picks: string[] = [];
    await act(async () => {
      set((s) => ({
        exercises: {
          ...s.exercises,
          "recall-test": {
            ...s.exercises["recall-test"],
            drafts: { [key]: "bonjour" },
            ui: { [key]: { phase: "answering", hint: true, revealed: true } },
          },
        },
      }));
      root.render(
        <Exercise
          sessionKey="recall-test"
          kind="Recall"
          source="Current sentence"
          items={items}
          onDone={() => {}}
          onPick={(p) => picks.push(p.text)}
        />,
      );
    });

    const words = host.querySelectorAll<HTMLElement>(".fr-word");
    expect(words.length).toBeGreaterThan(1);
    expect(host.textContent).not.toContain("If you check now");
    expect(host.querySelector('[aria-label="Hint"]')?.textContent).toContain("First letters:");
    expect(host.querySelector('[aria-label="Answer actions"] button[aria-pressed="true"]')).toBeTruthy();
    expect(host.querySelector("[aria-pressed='true']")).toBeTruthy();

    const failli = [...words].find((el) => el.dataset.word === "failli");
    expect(failli).toBeTruthy();
    await act(async () => failli!.click());
    expect(picks).toEqual(["failli"]);

    const tryNow = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try it now");
    expect(tryNow).toBeTruthy();
    await act(async () => tryNow!.click());

    expect(host.querySelector(".fr-text")).toBeNull();
    const input = host.querySelector("textarea");
    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(get().exercises["recall-test"].ui[key].revealed).toBe(true);
    expect(get().exercises["recall-test"].ui[key].coverAnswer).toBe(true);
    expect(host.querySelector('[aria-label="Answer actions"] button[aria-pressed="true"]')).toBeTruthy();
  });
});

describe.each(["Recall", "Dictation"] as const)("%s answer keyboard", (kind) => {
  it("leaves Shift+Enter available for a newline and Enter checks the typed answer", async () => {
    const sessionKey = "keyboard-test";
    const key = "0:whole:w";
    ensureSession(sessionKey, kind, "Current sentence", items);
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [sessionKey]: {
        ...s.exercises[sessionKey], drafts: { [key]: "Bonjour" },
      } } }));
      root.render(<Exercise sessionKey={sessionKey} kind={kind} source="Current sentence" items={items} onDone={() => {}} />);
    });
    const input = host.querySelector("textarea")!;
    expect(input).toBeTruthy();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    const newline = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(newline); });
    expect(newline.defaultPrevented).toBe(false);
    expect(gradeAttempt).not.toHaveBeenCalled();
    // jsdom does not perform native textarea editing; simulate the browser's input event.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Bonjour\n");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(get().exercises[sessionKey].drafts[key]).toBe("Bonjour\n");
    const check = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(check); });
    expect(check.defaultPrevented).toBe(true);
    expect(gradeAttempt).toHaveBeenCalledExactlyOnceWith({ fr: items[0].fr, en: items[0].en, steps: items[0].steps }, kind, 0, "Bonjour\n");
    expect(get().exercises[sessionKey].ui[key].phase).toBe("graded");
  });

  it("describes only the visible error after Enter on an empty answer", async () => {
    await act(async () => {
      root.render(<Exercise sessionKey="empty-test" kind={kind} source="Current sentence" items={items} onDone={() => {}} />);
    });
    const input = host.querySelector("textarea")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(input.getAttribute("aria-describedby")).toBe("ex-err-empty-test");
    expect(host.querySelector("#ex-err-empty-test")?.textContent).toContain("Type an answer before checking.");
    expect(gradeAttempt).not.toHaveBeenCalled();
  });
});


describe.each(["Recall", "Dictation"] as const)("%s result", kind => {
  describe.each(["whole", "step"] as const)("%s scope", mode => {
    it.each([false, true])("renders inline feedback and two last-item actions (correct=%s)", async correct => {
      const target = "Ma machine à laver fuit.";
      const fixture: PracticeItem[] = [{ id: "machine", fr: target, en: "My washing machine leaks.", label: "Sentence", steps: [{ fr: target, en: "My washing machine leaks." }] }];
      const key = mode === "whole" ? "0:whole:w" : "0:step:0";
      const sessionKey = "result-test";
      vi.mocked(gradeAttempt).mockResolvedValueOnce({ correct, saved: true } as Awaited<ReturnType<typeof gradeAttempt>>);
      ensureSession(sessionKey, kind, "Fixture", fixture);
      await act(async () => {
        set(s => ({ exercises: { ...s.exercises, [sessionKey]: { ...s.exercises[sessionKey], mode, drafts: { [key]: correct ? "MA machine à laver fuit!" : "Ma machine a lav fui" } } } }));
        set(() => ({ activeRun: sessionKey, route: "study/run" }));
        root.render(<RunScreen />);
      });
      await act(async () => { submitAnswer(sessionKey); });
      expect(host.querySelector('[aria-label="Score: ' + (correct ? 100 : 50) + '%"]')?.className).toContain("text-4xl");
      expect(host.textContent).toContain(correct ? "5 right · 0 wrong" : "2 right · 2 wrong · 1 accent");
      expect(host.querySelector('.grade-toast')).toBeNull();
      expect(host.textContent).not.toMatch(/Bravo !|Parfait !|Nickel !|Super !/);
      const inline = host.querySelector('[aria-label="Inline corrections"]')!;
      if (correct) {
        expect(inline.querySelector("del")).toBeNull();
        expect(inline.querySelector('[data-mark]:not([data-mark="ok"])')).toBeNull();
      } else {
        expect([...inline.querySelectorAll("del")].map(el => el.textContent)).toEqual(["a", "lav", "fui"]);
        expect(inline.querySelector('[data-mark="accent"]')?.textContent?.trim()).toBe("a à");
        expect(inline.querySelector('[data-mark="accent"] .decoration-dotted')).toBeTruthy();
        expect([...inline.querySelectorAll(".text-destructive")].map(el => el.textContent)).toEqual(["laver", "fuit"]);
      }
      expect(host.querySelector('[aria-label="Correct answer"]')?.textContent).toBe(target);
      expect(host.textContent).not.toMatch(/Accent: you wrote|Different word:|Your answer/);
      expect(host.querySelector(".compare-note")).toBeNull();
      const card = host.querySelector('[data-slot="card"]')!;
      expect(card.contains(inline)).toBe(true);
      expect(card.querySelector('[aria-label="Correct answer"]')).toBeTruthy();
      const actions = host.querySelector('[aria-label="Result actions"]')!;
      expect(card.contains(actions)).toBe(true);
      expect([...actions.querySelectorAll("button")].map(el => el.textContent)).toEqual(["Try again", "Done — return to Study"]);
      expect(host.textContent).not.toContain("See attempts in History");
    });
  });
});

describe.each(["Recall", "Dictation"] as const)("%s Next focus", kind => {
  it.each(["whole", "step"] as const)("waits for submit Enter release in %s, then advances once on a fresh Enter", async mode => {
    const sessionKey = "focus-test";
    const qk = mode === "whole" ? "0:whole:w" : "0:step:0";
    const done = vi.fn();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    ensureSession(sessionKey, kind, "Fixture", items);
    await act(async () => {
      set(s => ({ exercises: { ...s.exercises, [sessionKey]: { ...s.exercises[sessionKey], mode, drafts: { [qk]: "answer" } } } }));
      root.render(<Exercise sessionKey={sessionKey} kind={kind} source="Fixture" items={items} onDone={done} />);
    });
    const input = host.querySelector("textarea")!;
    const key = (el: Element, type: string, repeat = false) => el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", repeat, bubbles: true, cancelable: true }));
    await act(async () => { input.focus(); key(input, "keydown"); });
    await act(async () => { while (frames.length) frames.shift()!(0); });
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Result actions"] button:last-child')!;
    expect(document.activeElement).not.toBe(next);
    expect(done).not.toHaveBeenCalled();
    await act(async () => { key(document.body, "keydown", true); key(document.body, "keyup"); while (frames.length) frames.shift()!(0); });
    expect(document.activeElement).toBe(next);
    expect(done).not.toHaveBeenCalled();
    await act(async () => { key(next, "keydown", true); });
    expect(done).not.toHaveBeenCalled();
    await act(async () => { key(next, "keydown"); key(next, "keyup"); });
    expect(done).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it("focuses Next after a Check button Enter is released, and moves to the next question", async () => {
    const fixture = [...items, { ...items[0], id: "second" }];
    ensureSession("check-focus", kind, "Fixture", fixture);
    await act(async () => {
      set(s => ({ exercises: { ...s.exercises, "check-focus": { ...s.exercises["check-focus"], drafts: { "0:whole:w": "answer" } } } }));
      set(() => ({ activeRun: "check-focus", route: "study/run" }));
      root.render(<RunScreen />);
    });
    const check = [...host.querySelectorAll("button")].find(b => b.textContent === "Check")!;
    await act(async () => { check.focus(); check.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); check.click(); });
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Result actions"] button:last-child')!;
    expect(document.activeElement).not.toBe(next);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })); await new Promise(r => setTimeout(r, 30)); });
    expect(document.activeElement).toBe(next);
    await act(async () => { next.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(get().exercises["check-focus"].index).toBe(1);
  });
  it("does not focus Next or advance an incorrect result", async () => {
    vi.mocked(gradeAttempt).mockResolvedValueOnce({ correct: false, saved: true } as Awaited<ReturnType<typeof gradeAttempt>>);
    const done = vi.fn();
    ensureSession("wrong-focus", kind, "Fixture", items);
    await act(async () => {
      set(s => ({ exercises: { ...s.exercises, "wrong-focus": { ...s.exercises["wrong-focus"], drafts: { "0:whole:w": "wrong" } } } }));
      root.render(<Exercise sessionKey="wrong-focus" kind={kind} source="Fixture" items={items} onDone={done} />);
      submitAnswer("wrong-focus");
      await new Promise(r => setTimeout(r, 30));
    });
    const next = host.querySelector('[aria-label="Result actions"] button:last-child');
    expect(document.activeElement).not.toBe(next);
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(done).not.toHaveBeenCalled();
  });
});
