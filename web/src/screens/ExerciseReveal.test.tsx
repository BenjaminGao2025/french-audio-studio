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
      // The Tool group tablist sits above the exercise; only the Check yourself tabs belong to the toolbar.
      expect(host.querySelectorAll('[role="tablist"][aria-label="Tool group"]')).toHaveLength(standalone ? 0 : 1);
      expect(host.querySelectorAll('[role="tablist"]:not([aria-label="Tool group"])')).toHaveLength(standalone ? 0 : 1);
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
      // One question from the current sentence: only the step position is shown; whole scope keeps the line for screen readers.
      expect(meta.textContent).toBe(mode === "whole" ? "Question 1 of 1" : "Step 1 of 1");
      expect(meta.className.includes("sr-only")).toBe(mode === "whole");
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
      expect(card.querySelector('[aria-label="Answer"]')?.textContent).toContain("Try again");
    });
  });
});

describe("revealed recall answer", () => {
  it("uses tappable words and Try again hides the answer without forgetting it was shown", async () => {
    ensureSession("recall-test", "Recall", "Current sentence", items);
    const key = "0:whole:w";
    const picks: string[] = [];
    await act(async () => {
      set((s) => ({
        exercises: {
          ...s.exercises,
          "recall-test": {
            ...s.exercises["recall-test"], mode: "whole",
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

    const tryNow = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(tryNow).toBeTruthy();
    await act(async () => tryNow!.click());

    expect(host.querySelector(".fr-text")).toBeNull();
    const input = host.querySelector("textarea");
    expect(input?.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(get().exercises["recall-test"].ui[key].revealed).toBe(true);
    expect(get().exercises["recall-test"].ui[key].coverAnswer).toBe(true);
    expect(host.querySelector('[aria-label="Hint"]')).toBeNull();
    expect(host.querySelector('[aria-label="Answer actions"] button[aria-pressed="true"]')).toBeNull();
    await act(async () => {
      set(s => ({exercises:{...s.exercises, "recall-test":{...s.exercises["recall-test"], drafts:{[key]:"answer"}}}}));
      submitAnswer("recall-test");
    });
    expect(get().attempts.at(-1)).toMatchObject({hinted:true, answerKnown:true});
    expect(host.textContent).toContain("Answer known");
  });
});

describe.each(["Recall", "Dictation"] as const)("%s answer keyboard", (kind) => {
  it("leaves Shift+Enter available for a newline and Enter checks the typed answer", async () => {
    const sessionKey = "keyboard-test";
    const key = "0:whole:w";
    ensureSession(sessionKey, kind, "Current sentence", items);
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [sessionKey]: {
        ...s.exercises[sessionKey], mode: "whole", drafts: { [key]: "Bonjour" },
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
      // A fully right answer gets the quiet celebration; anything else does not.
      expect(host.querySelector(".perfect-label")?.textContent ?? null).toBe(correct ? "Perfect spelling" : null);
      expect(host.querySelectorAll(".perfect-burst .spark").length).toBe(correct ? 14 : 0);
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
        // Only the letters that differ are red: a/à, lav→laver, fui→fuit.
        expect([...inline.querySelectorAll(".text-destructive")].map(el => el.textContent)).toEqual(["a", "à", "er", "t"]);
      }
      // A fully right answer is not repeated under itself.
      if (correct) expect(host.querySelector('[aria-label="Correct answer"]')).toBeNull();
      else expect(host.querySelector('[aria-label="Correct answer"]')?.textContent).toBe(target);
      expect(host.textContent).not.toMatch(/Accent: you wrote|Different word:|Your answer/);
      expect(host.querySelector(".compare-note")).toBeNull();
      const card = host.querySelector('[data-slot="card"]')!;
      expect(card.contains(inline)).toBe(true);
      expect(Boolean(card.querySelector('[aria-label="Correct answer"]'))).toBe(!correct);
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
      set(s => ({ exercises: { ...s.exercises, "check-focus": { ...s.exercises["check-focus"], mode: "whole", drafts: { "0:whole:w": "answer" } } } }));
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
      set(s => ({ exercises: { ...s.exercises, "wrong-focus": { ...s.exercises["wrong-focus"], mode: "whole", drafts: { "0:whole:w": "wrong" } } } }));
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

it("new sessions default to Step by step first, preserve existing modes, and Review works in question and result", async () => {
  const { fake, installFakeBackend } = await import("../test/fakeBackend");
  const { resetSavedCards } = await import("../api/srs");
  installFakeBackend(); fake.reset(); resetSavedCards();
  ensureSession("default-review", "Recall", "Fixture", items);
  expect(get().exercises["default-review"].mode).toBe("step");
  await act(async () => root.render(<Exercise sessionKey="default-review" kind="Recall" source="Fixture" items={items} onDone={() => {}} />));
  expect(host.querySelector('[aria-label="Practice scope"] button')?.textContent).toBe("Step by step");
  const review = () => [...host.querySelectorAll("button")].find(b => /^(Review|In review)$/.test(b.getAttribute("aria-label") ?? ""))!;
  await act(async () => { review().click(); await new Promise(r => setTimeout(r, 100)); });
  expect(fake.calls.find(c => c.path === "/api/srs/notes")?.body).toMatchObject({sentence:items[0].steps[0].fr,translation_en:items[0].steps[0].en,modes:["listen"],targets:[]});
  expect(review().getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    set(s => ({ exercises: { ...s.exercises, "default-review": { ...s.exercises["default-review"], drafts: {"0:step:0":"answer"} } } }));
    submitAnswer("default-review");
  });
  expect(host.querySelector('[aria-label="Result actions"]')).toBeTruthy();
  await act(async () => { review().click(); await new Promise(r => setTimeout(r, 100)); });
  expect(review().getAttribute("aria-pressed")).toBe("false");
  expect(fake.srs.cards.filter(c => c.note?.sentence === items[0].steps[0].fr && c.mode === "listen")).toHaveLength(0);
  set(s => ({ exercises: { ...s.exercises, "default-review": { ...s.exercises["default-review"], mode:"whole" } } }));
  ensureSession("default-review", "Recall", "Fixture", items);
  expect(get().exercises["default-review"].mode).toBe("whole");
});


describe("normalization and visible grading marks", () => {
  it.each([
    ["Les représentants ont résolu d'exposer les droits.", "Les représentants ont résolu d'exposer les droits".normalize("NFD"), true],
    ["Les représentants ont résolu d'exposer les droits.".normalize("NFD"), "Les représentants ont résolu d'exposer les droits", true],
    ["d'exposer", "d’exposer", true],
    ["d’exposer", "d'exposer", true],
    ["Les représentants ont résolu d'exposer les droits.", "Les représentants ont résolu d'exposer les droits", true],
    ["résolu", "fini", false],
    ["été", "ete", false],
    ["été ici", "été", false],
    ["été", "été ici", false],
  ])("renders %s / %s from the counted alignment", async (target, answer, correct) => {
    vi.mocked(gradeAttempt).mockResolvedValueOnce({correct, saved:true} as Awaited<ReturnType<typeof gradeAttempt>>);
    const fixture = [{...items[0], fr: target}];
    ensureSession("marks", "Recall", "Fixture", fixture);
    await act(async () => {
      set(s => ({exercises:{...s.exercises, marks:{...s.exercises.marks, mode:"whole", drafts:{"0:whole:w":answer}}}}));
      root.render(<Exercise sessionKey="marks" kind="Recall" source="Fixture" items={fixture} onDone={() => {}} />);
      submitAnswer("marks");
    });
    const result = get().attempts.at(-1)!.result!;
    const line = host.querySelector('[aria-label="Inline corrections"]')!;
    const marks = line.querySelectorAll('[data-mark]:not([data-mark="ok"])');
    expect(marks.length).toBe(result.counts.different + result.counts.missing + result.counts.extra + result.counts.accent);
    if (correct) {
      expect(host.textContent).toContain("100%");
      expect(host.textContent).toContain("0 wrong");
      expect(host.textContent).not.toContain("Not quite");
    }
    for (const mark of marks) {
      const kind = mark.getAttribute("data-mark");
      if (kind !== "missing") {
        expect(mark.querySelector("del")?.classList.contains("line-through")).toBe(true);
        expect(mark.querySelector("del")?.classList.contains("text-muted-foreground")).toBe(true);
      }
      if (kind !== "extra") expect(mark.textContent).toContain(result.alignment.find(w => w.mark === kind)!.expected);
    }
    if (target === "été") {
      expect(result.counts.different).toBe(0);
      expect(result.counts.accent).toBe(answer === "ete" ? 1 : 0);
    }
  });
});

describe("glued comma result display (Bug F)", () => {
  it("keeps ont/en correct and strikes a wrong word with its correct form", async () => {
    const target = "Les représentants constitués en Assemblée nationale, ont résolu d'exposer les droits.";
    const answer = "Les représentants constitués en Assemblee nationale,ont fini d'exposer les droits";
    vi.mocked(gradeAttempt).mockResolvedValueOnce({ correct: false, saved: true } as Awaited<ReturnType<typeof gradeAttempt>>);
    const fixture = [{ ...items[0], fr: target }];
    ensureSession("comma-f", "Recall", "Fixture", fixture);
    await act(async () => {
      set(s => ({ exercises: { ...s.exercises, "comma-f": { ...s.exercises["comma-f"], mode: "whole", drafts: { "0:whole:w": answer } } } }));
      root.render(<Exercise sessionKey="comma-f" kind="Recall" source="Fixture" items={fixture} onDone={() => {}} />);
      submitAnswer("comma-f");
    });
    const result = get().attempts.at(-1)!.result!;
    const line = host.querySelector('[aria-label="Inline corrections"]')!;
    const marks = [...line.querySelectorAll('[data-mark]:not([data-mark="ok"])')];
    // "N right / M wrong" and the visible marks both come from the same alignment.
    expect(marks.length).toBe(result.counts.different + result.counts.missing + result.counts.extra + result.counts.accent);
    expect(host.textContent).toContain(
      `${result.counts.ok} right · ${result.counts.different + result.counts.missing + result.counts.extra} wrong`,
    );
    const wrong = marks.find(m => m.getAttribute("data-mark") === "different")!;
    expect(wrong.querySelector("del")?.classList.contains("line-through")).toBe(true);
    expect(wrong.querySelector("del")?.textContent).toBe("fini");
    expect(wrong.textContent).toContain("résolu");
    expect(result.alignment.filter(w => w.expected === "ont" || w.expected === "en").every(w => w.mark === "ok")).toBe(true);
  });
});


describe.each(["Recall", "Dictation"] as const)("%s panel toggles", kind => {
  it.each(["whole", "step"] as const)("keeps scoring flags when toolbar or close controls hide %s panels", async mode => {
    ensureSession("toggle", kind, "Fixture", items);
    await act(async () => {
      set(s => ({exercises:{...s.exercises, toggle:{...s.exercises.toggle, mode}}}));
      root.render(<Exercise sessionKey="toggle" kind={kind} source="Fixture" items={items} onDone={() => {}} />);
    });
    const buttons = host.querySelector('[aria-label="Answer actions"]')!.querySelectorAll("button");
    for (const [index, label] of [[1,"Hint"],[2,"Answer"]] as const) {
      await act(async () => buttons[index].click());
      expect(buttons[index].getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeTruthy();
      await act(async () => buttons[index].click());
      expect(buttons[index].getAttribute("aria-pressed")).toBe("false");
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
      await act(async () => buttons[index].click());
      await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="Hide ${label.toLowerCase()}"]`)!.click());
      expect(buttons[index].getAttribute("aria-pressed")).toBe("false");
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
    const key = mode === "whole" ? "0:whole:w" : "0:step:0";
    await act(async () => {
      set(s => ({exercises:{...s.exercises,toggle:{...s.exercises.toggle,drafts:{[key]:"answer"}}}}));
      submitAnswer("toggle");
    });
    expect(get().attempts.at(-1)).toMatchObject({hinted:true, answerKnown:true});
    expect(host.textContent).toContain("Answer known");
    const retry = host.querySelector<HTMLButtonElement>('[aria-label="Result actions"] button')!;
    await act(async () => retry.click());
    expect(get().exercises.toggle.ui[key]).toMatchObject({hint:false, revealed:false});
    expect(get().exercises.toggle.ui[key].hinted).toBeUndefined();
  });
});
