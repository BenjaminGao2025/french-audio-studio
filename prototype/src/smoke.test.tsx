// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import { WidthContext } from "./components/ui";
import { lookupKey } from "./lib/lookup";
import { submitAnswer } from "./screens/Exercise";
import { Detail } from "./screens/History";
import { computePlannedSessionCards } from "./screens/Review";
import { StudyLearn } from "./screens/StudyLearn";
import { IDEA_SENTENCE, buildSentencesForAnalysis } from "./state/study";
import { REGISTRY } from "./screens/registry";
import {
  armFailure,
  clearAttemptHistory,
  expireMastery,
  get,
  go,
  markMastered,
  recordSimulatedAudio,
  resetDemo,
  set,
  setClock,
  setDailyNew,
  setSessionSize,
  startPlayback,
  stopPlayback,
  tick,
  undoMastery,
} from "./state/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const TARGET = "J’ai oublié mon rendez-vous";

/** Whole-document text + accessible attributes + document title + URL (excluding learner-typed textarea values). */
function wholeDocumentSnapshot(): string {
  const bodyText = document.body.textContent ?? "";
  const ariaLabels = Array.from(document.querySelectorAll("[aria-label]"))
    .map((e) => e.getAttribute("aria-label"))
    .join(" ");
  const titles = Array.from(document.querySelectorAll("[title]"))
    .map((e) => e.getAttribute("title"))
    .join(" ");
  return `${bodyText} ${ariaLabels} ${titles} ${document.title} ${location.href} ${location.hash}`;
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

describe("9. whole-document answer-leak checks (Recall, Dictation, Review)", () => {
  const unrevealedExerciseStates: [string, string, string][] = [
    ["SCR-REC-01", "empty", TARGET],
    ["SCR-REC-01", "typing", TARGET],
    ["SCR-REC-01", "empty-check", TARGET],
    ["SCR-REC-01", "submitting", TARGET],
    ["SCR-REC-01", "techfail", "Ma sœur m’a appelé"],
    ["SCR-REC-01", "hint", TARGET],
    ["SCR-REC-01", "drafts", TARGET],
    ["SCR-REC-01", "study", "j’ai failli oublier mon rendez-vous"],
    ["SCR-DIC-01", "empty", TARGET],
    ["SCR-DIC-01", "hint", TARGET],
    ["SCR-DIC-01", "step", TARGET],
    ["SCR-DIC-01", "audio-error", TARGET],
    ["SCR-DIC-01", "slow", TARGET],
  ];

  for (const [id, key, forbidden] of unrevealedExerciseStates)
    it(`${id}/${key} does not leak target anywhere in document`, async () => {
      await act(async () => resetDemo());
      await act(async () => REGISTRY.find((r) => r.id === id)!.states.find((s) => s.key === key)!.apply());
      await wait(800);
      expect(wholeDocumentSnapshot().toLowerCase()).not.toContain(forbidden.toLowerCase());
    });

  it("SCR-REC-01/techfail and SCR-DIC-01/techfail do not leak system target outside learner input", async () => {
    for (const id of ["SCR-REC-01", "SCR-DIC-01"] as const) {
      await act(async () => resetDemo());
      await act(async () => REGISTRY.find((r) => r.id === id)!.states.find((s) => s.key === "techfail")!.apply());
      const key = get().activeRun!;
      // Replace learner draft with a distinct wrong answer before techfail resolves
      await act(async () => {
        set((s) => ({
          exercises: {
            ...s.exercises,
            [key]: { ...s.exercises[key], drafts: { "0:whole:w": "J’ai oublié mon billet." } },
          },
        }));
      });
      await wait(800);
      expect(wholeDocumentSnapshot()).not.toContain(TARGET);
    }
  });

  it("Review unrevealed cards and the next card after grading do not leak their target anywhere in the document", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "answer")!.apply());
    await wait(50);
    const cards = get().review.sessionCards!;
    const card0 = cards[0];
    expect(wholeDocumentSnapshot()).not.toContain(card0.target);

    // Grade card 0, then advance to card 1 (which is from a different sentence) and verify card 1's target is not in the document.
    const ta = document.querySelector<HTMLTextAreaElement>("#rev-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, card0.target);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const checkBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Check")!;
    await act(async () => checkBtn.click());
    await wait(800);
    // Focus moved to #rev-result after Check
    expect(document.activeElement?.id).toBe("rev-result");

    const nextBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Next card")!;
    await act(async () => nextBtn.click());
    await wait(50);

    const card1 = cards[1];
    expect(card1.sentenceId).not.toBe(card0.sentenceId);
    expect(wholeDocumentSnapshot()).not.toContain(card1.target);
    // Neither card 0's sentence nor card 1's sentence leaks on card 1
    expect(wholeDocumentSnapshot()).not.toContain(card0.sentenceFr);

    // Also check unrevealed Speak card in Review
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "speak")!.apply());
    await wait(50);
    const speakCard = get().review.sessionCards![get().review.index];
    expect(speakCard.kind).toBe("Speak");
    expect(wholeDocumentSnapshot()).not.toContain(speakCard.target);
  });
});

describe("1. same-attempt retry must not hide a reveal", () => {
  it("Exercise: techfail → Show answer → Retry check records Answer known with attempt count still 1", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REC-01")!.states.find((s) => s.key === "techfail")!.apply());
    await wait(800);
    expect(get().attempts).toHaveLength(1);
    expect(get().attempts[0].status).toBe("pending");
    expect(get().attempts[0].answerKnown).toBe(false);

    const showAnswer = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Show answer")!;
    await act(async () => showAnswer.click());
    expect(get().attempts[0].answerKnown).toBe(true);

    const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry check")!;
    await act(async () => retry.click());
    await wait(800);

    expect(get().attempts).toHaveLength(1);
    expect(get().attempts[0].status).toBe("completed");
    expect(get().attempts[0].answerKnown).toBe(true);
    expect(document.getElementById("main")!.textContent).toContain("Recorded as: Answer known");
  });

  it("Review: techfail → Show answer → Retry check records Answer known", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "techfail")!.apply());
    await wait(50);
    const showAnswer = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Show answer")!;
    await act(async () => showAnswer.click());
    const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry check")!;
    await act(async () => retry.click());
    await wait(800);
    expect(document.getElementById("main")!.textContent).toContain("Answer known");
  });
});

describe("2. Review queue spacing and Speak card speaking flow", () => {
  it("orders the 40-card session so no two adjacent cards share a sentenceId and keeps 8 + 1 + 31 totals", () => {
    resetDemo();
    const s = get();
    const session = computePlannedSessionCards(s.queue, s.dailyNew, s.newUsed);
    expect(session).toHaveLength(40);
    expect(session.filter((c) => c.group === "learning")).toHaveLength(8);
    expect(session.filter((c) => c.group === "due")).toHaveLength(1);
    expect(session.filter((c) => c.group === "new")).toHaveLength(31);
    for (let i = 1; i < session.length; i++) {
      expect(session[i].sentenceId).not.toBe(session[i - 1].sentenceId);
    }
    // Check sibling spacing is at least 3 other cards between siblings (distance >= 4)
    const lastSeen = new Map<string, number>();
    session.forEach((c, idx) => {
      const prev = lastSeen.get(c.sentenceId);
      if (prev !== undefined) expect(idx - prev).toBeGreaterThanOrEqual(4);
      lastSeen.set(c.sentenceId, idx);
    });
  });

  it("Speak cards use speaking flow: English prompt, simulated recording, Show answer, and self-check", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "speak")!.apply());
    await wait(50);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("Simulated recording");
    expect(main.textContent).toContain("Start simulated recording");
    expect(document.querySelector("#rev-input")).toBeNull();

    const showBtn = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Show answer")!;
    await act(async () => showBtn.click());
    expect(main.textContent).toContain("I said it correctly");
    expect(main.textContent).toContain("Not yet");

    const saidOk = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "I said it correctly")!;
    await act(async () => saidOk.click());
    await wait(800);
    expect(main.textContent).toContain("Said correctly");
  });
});

describe("3. one source of truth for Favorite and importance", () => {
  it("5th counted lookup of failli shows Importance 4/5 in both popup and library; favoriting in popup appears under Favorites only", async () => {
    await act(async () => resetDemo());
    // Initially "failli" has 4 lookups (Importance 3/5)
    expect(get().lookups[lookupKey("failli")].count).toBe(4);

    // Open Study and click "failli" to trigger the 5th counted lookup
    await act(async () => REGISTRY.find((r) => r.id === "SCR-STU-02")!.states.find((s) => s.key === "single")!.apply());
    await wait(50);
    const wordBtn = document.querySelector<HTMLElement>('[data-word="failli"]')!;
    await act(async () => wordBtn.click());
    await wait(650);

    expect(get().lookups[lookupKey("failli")].count).toBe(5);
    expect(document.body.textContent).toContain("Importance, 4 out of 5, based on 5 lookups.");

    // Favorite "failli" inside the word popup
    const favBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Favorite")!;
    await act(async () => favBtn.click());
    expect(get().favorites[lookupKey("failli")]).toBe(true);
    // Favoriting never changes lookup count or importance
    expect(get().lookups[lookupKey("failli")].count).toBe(5);

    // Navigate to Word library and filter by Favorites only
    await act(async () => {
      set((s) => ({ libFilters: { ...s.libFilters, q: "failli", favoritesOnly: true } }));
      go("review/library");
    });
    await wait(50);
    const failliRow = document.querySelector<HTMLElement>('[data-word="failli"]')!;
    expect(failliRow).toBeTruthy();
    expect(failliRow.textContent).toContain("Importance, 4 out of 5, based on 5 lookups.");
    expect(failliRow.textContent).toContain("Favorited");

    // Whole-sentence cards do not show lookup-based importance
    await act(async () => set((s) => ({ libFilters: { ...s.libFilters, favoritesOnly: false } })));
    await wait(30);
    expect(document.getElementById("main")!.textContent).toContain("Importance: not applicable to whole-sentence cards");
    expect(document.getElementById("main")!.textContent).toContain("Applies to Fill-in word cards only");
  });
});

describe("4. clearing practice history resets derived counts", () => {
  it("complete 2 attempts, clear, start a new session, complete 1 → summary says 1 attempt; History says 1", { timeout: 15000 }, async () => {
    await act(async () => resetDemo());
    // Clear initial fixture attempts first so we start clean, then complete 2 attempts
    await act(async () => clearAttemptHistory());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REC-01")!.states.find((s) => s.key === "empty")!.apply());
    const k1 = get().activeRun!;
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [k1]: { ...s.exercises[k1], drafts: { "0:whole:w": TARGET } } } }));
      submitAnswer(k1);
    });
    await wait(1500);
    const tryAgainBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => tryAgainBtn.click());
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [k1]: { ...s.exercises[k1], drafts: { "0:whole:w": TARGET } } } }));
      submitAnswer(k1);
    });
    await wait(1500);
    expect(get().history.attempts).toHaveLength(2);

    // Clear practice attempt history
    await act(async () => clearAttemptHistory());
    expect(get().history.attempts).toHaveLength(0);

    // Start a new session and complete 1 attempt on the last item so SessionSummary renders
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states.find((s) => s.key === "final")!.apply());
    await wait(1500);

    const summary = document.querySelector('[aria-label="Session summary"]')!;
    expect(summary.textContent).toContain("1 attempt");
    expect(get().history.attempts).toHaveLength(1);

    await act(async () => go("progress/history?tab=attempts"));
    await wait(600);
    expect(document.getElementById("main")!.textContent).toContain("1 practice attempt · All demo dates · Showing all 1");
  });
});

describe("5. foreground-only counting and consistent 4-total updates", () => {
  it("hidden tab for 10 s while playing adds 0 counted seconds; 10 content minutes at 2× adds 5 counted minutes to all four totals", async () => {
    await act(async () => resetDemo());
    await act(async () => startPlayback({ kind: "episode", label: "Episode: Un samedi au marché", route: "practice/episodes/e1", episodeId: "e1" }, 1080));
    await wait(800);
    expect(get().player?.status).toBe("playing");
    // Measure from the moment the tab is hidden: the app's own clock tick may have counted a few ms before that.
    const before = { ...get().audioStats };
    const countedBefore = get().player!.countedSeconds;

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      await act(async () => {
        for (let i = 0; i < 10; i++) tick(1);
      });
      expect(get().player?.countedSeconds).toBe(countedBefore);
      expect(get().audioStats).toEqual(before);
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    }

    // 10 content minutes (600 s) at 2× adds 5 counted minutes (300 s = 5/60 h) to all four totals
    await act(async () => stopPlayback()); // so no live tick lands between the baseline and the recorded block
    const base = { ...get().audioStats };
    await act(async () => {
      recordSimulatedAudio(600, 2);
    });
    const after = get().audioStats;
    expect(after.todaySeconds - base.todaySeconds).toBe(300);
    expect(after.weekSeconds - base.weekSeconds).toBe(300);
    expect(after.lifetimeHours - base.lifetimeHours).toBeCloseTo(300 / 3600, 6);
    expect(after.last28Hours - base.last28Hours).toBeCloseTo(300 / 3600, 6);
  });
});

describe("6. independent 6-second Undo window per mastery action", () => {
  it("mark A at 0 s and B at 2 s; Undo A at 5 s succeeds; B expires at 8 s", async () => {
    await act(async () => resetDemo());
    const saved = get().cards.filter((c) => c.saved && !c.mastered);
    const cardA = saved[0];
    const cardB = saved[1];

    // Injected clock: the Shell's Undo countdown and the store read the same fake time.
    let t = 0;
    setClock(() => t);
    let idA = "";
    let idB = "";
    await act(async () => {
      idA = markMastered(cardA.id);
      t = 2000;
      idB = markMastered(cardB.id);
    });
    expect(get().cards.find((c) => c.id === cardA.id)!.mastered).toBe(true);
    expect(get().cards.find((c) => c.id === cardB.id)!.mastered).toBe(true);

    // At 5 s (5000 ms): Undo A succeeds; B is still active (5000 - 2000 = 3000 < 6000)
    let undidA = false;
    await act(async () => {
      t = 5000;
      undidA = undoMastery(idA);
    });
    expect(undidA).toBe(true);
    expect(get().cards.find((c) => c.id === cardA.id)!.mastered).toBe(false);
    expect(get().mastery.find((m) => m.id === idA)!.state).toBe("undone");
    expect(get().mastery.find((m) => m.id === idB)!.state).toBe("active");

    // At 8 s (8000 ms): B has elapsed 6000 ms (8000 - 2000 = 6000) and expires
    await act(async () => {
      t = 8000;
      expireMastery();
    });
    setClock(null);
    expect(get().mastery.find((m) => m.id === idB)!.state).toBe("expired");
    expect(get().cards.find((c) => c.id === cardB.id)!.mastered).toBe(true);
  });

  it("Undo button names the card by kind and word, never its internal id", async () => {
    await act(async () => resetDemo());
    const card = get().cards.find((c) => c.saved && !c.mastered && c.kind === "Fill-in" && c.word)!;
    await act(async () => {
      markMastered(card.id);
    });
    await wait(250);
    const undo = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label")?.startsWith("Undo mastered"))!;
    expect(undo.getAttribute("aria-label")).toBe(`Undo mastered: Fill-in card · ${card.word}`);
    expect(undo.getAttribute("aria-label")).not.toContain(card.id);
    await act(async () => undo.click());
    expect(get().cards.find((c) => c.id === card.id)!.mastered).toBe(false);
  });
});

describe("7. self-explaining Review quota numbers and frozen session cards", () => {
  it("explains 31 assigned vs 9 unassigned allowances, shows 2-of-5 from a real 5-card sentence, and freezes session cards once started", async () => {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain(
      "31 new cards this session. 9 of today’s 40 allowances aren’t used because your session holds 40 cards and 9 go to learning and due reviews. Raise Cards per review session in Settings to fit more.",
    );
    expect(main.textContent).toContain("has 5 new cards");

    // Demo state: 2 allowances remain -> 2 introduced today, 3 left for later from the 5-new-card fixture sentence
    await act(async () => REGISTRY.find((r) => r.id === "SCR-QUO-01")!.states.find((s) => s.key === "two-of-five")!.apply());
    await wait(700);
    expect(main.textContent).toContain("has 5 new cards. 2 will be introduced today");
    expect(main.textContent).toContain("and 3 left for later");

    // Start a session from default state, then lower the daily limit mid-session: only not-yet-shown new cards go
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    const startBtn = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Start review")!;
    await act(async () => startBtn.click());
    await wait(50);
    expect(get().review.sessionCards).toHaveLength(40);

    const used = get().newUsed;
    await act(async () => {
      setDailyNew(10);
      go("review");
    });
    await wait(700);
    // 8 learning + 1 due + the 10 new cards the limit still allows (shown ones plus what is left)
    expect(get().review.sessionCards).toHaveLength(19);
    expect(main.textContent).toContain("19 cards");
    expect(main.textContent).toContain(`${31 - 10} new cards removed because you lowered today’s limit.`);
    expect(used).toBeLessThanOrEqual(10);
  });
});

describe("8. feedback and copy cleanups", () => {
  it("correct result shows the answer once, with no leftover input", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states[0].apply());
    await wait(1700);
    const text = document.getElementById("main")!.textContent!;
    expect(text.split(TARGET).length - 1).toBe(1);
    expect(document.querySelector("#main textarea")).toBeNull();
    expect(text).toContain("Hint and answer flags were recorded when you checked.");
  });

  it("incorrect feedback labels each issue once on Correct answer (and without a third issue list)", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-02")!.states.find((s) => s.key === "accent")!.apply());
    await wait(1700);
    const main = document.getElementById("main")!;
    const tags = Array.from(main.querySelectorAll(".tok-tag")).map((e) => e.textContent);
    expect(tags).toEqual([" (Accent · you wrote oublie)"]);
    expect(main.querySelector(".issues")).toBeNull();
  });

  it("History analysis Open in Study loads that analysis's sentences, and Find card in Word library filters by full sentence", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-HIS-02")!.states.find((s) => s.key === "attempt")!.apply());
    await wait(600);
    const findBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Find card in Word library")!;
    await act(async () => findBtn.click());
    expect(get().libFilters.q).toBe("Nous avons pris un café près de la gare.");

    // Open analysis a2 (5 sentences) in Study
    await act(async () => go("progress/history?tab=analyses"));
    await wait(600);
    const a2Btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Le plat du jour"))!;
    await act(async () => a2Btn.click());
    const openBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Open this analysis in Study"))!;
    await act(async () => openBtn.click());
    expect(get().study.sentences).toHaveLength(5);
  });

  it("failed history saves appear in History with Not saved · Retry and retry without duplicating", async () => {
    await act(async () => resetDemo());
    await act(async () => clearAttemptHistory());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-03")!.states.find((s) => s.key === "save-failed")!.apply());
    await wait(1600);
    expect(get().history.attempts).toHaveLength(1);
    expect(get().history.attempts[0].saved).toBe("failed");

    await act(async () => go("progress/history?tab=attempts"));
    await wait(600);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("Not saved · Retry");
    const retryBtn = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Retry")!;
    await act(async () => retryBtn.click());
    await wait(800);
    expect(get().history.attempts).toHaveLength(1);
    expect(get().history.attempts[0].saved).toBe("saved");
  });

  it("responsive widths (320, 390, 768, desktop): word popup is a sheet on narrow widths and a popover on desktop", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-STU-02")!.states.find((s) => s.key === "single")!.apply());
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      for (const w of [320, 390]) {
        await act(async () => {
          root.render(
            <WidthContext.Provider value={w}>
              <StudyLearn />
            </WidthContext.Provider>,
          );
        });
        const wordBtn = host.querySelector<HTMLElement>('[data-word="failli"]')!;
        await act(async () => wordBtn.click());
        expect(host.querySelector(".overlay--sheet")).toBeTruthy();
        const closeBtn = host.querySelector<HTMLElement>('.overlay--sheet button[aria-label="Close"]')!;
        await act(async () => closeBtn.click());
      }
      for (const w of [768, 1200]) {
        await act(async () => {
          root.render(
            <WidthContext.Provider value={w}>
              <StudyLearn />
            </WidthContext.Provider>,
          );
        });
        const wordBtn = host.querySelector<HTMLElement>('[data-word="failli"]')!;
        await act(async () => wordBtn.click());
        expect(document.querySelector(".popover")).toBeTruthy();
        await act(async () => wordBtn.click());
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

/* ---------------- round 3: session size, quota, mid-session changes ---------------- */

const mainText = () => document.getElementById("main")!.textContent!;
const findButton = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text);
function fieldByLabel(label: string): HTMLInputElement {
  const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent === label)!;
  return document.getElementById(l.getAttribute("for")!) as HTMLInputElement;
}
function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const quotaState = (key: string) => REGISTRY.find((r) => r.id === "SCR-QUO-02")!.states.find((s) => s.key === key)!.apply();

describe("10. Cards per review session setting and its states", () => {
  it("accepts 10–300, keeps the previous value on invalid or failed saves, and shows saving and saved", async () => {
    await act(async () => resetDemo());
    await act(async () => go("settings"));
    await wait(50);
    const label = "Cards per review session";
    expect(fieldByLabel(label).value).toBe("40");

    for (const bad of ["5", "301", "abc", ""]) {
      await act(async () => typeInto(fieldByLabel(label), bad));
      await act(async () => findButton("Save size")!.click());
      expect(mainText()).toContain("Enter a whole number from 10 to 300.");
      expect(get().sessionSize).toBe(40);
    }

    await act(async () => typeInto(fieldByLabel(label), "10"));
    await act(async () => findButton("Save size")!.click());
    expect(mainText()).toContain("Saving…");
    expect(get().sessionSize).toBe(40); // not applied until the save finishes
    await wait(1000);
    expect(get().sessionSize).toBe(10);
    expect(mainText()).toContain("Saved. Cards per review session: 10.");
    expect(mainText()).toContain("10 is the smallest session.");

    await act(async () => typeInto(fieldByLabel(label), "300"));
    await act(async () => findButton("Save size")!.click());
    await wait(1000);
    expect(get().sessionSize).toBe(300);
    expect(mainText()).toContain("300 is the largest session.");

    await act(async () => {
      armFailure("settings");
      typeInto(fieldByLabel(label), "50");
    });
    await act(async () => findButton("Save size")!.click());
    await wait(1000);
    expect(get().sessionSize).toBe(300);
    expect(mainText()).toContain("Couldn’t save the session size");
    expect(mainText()).toContain("Your previous size (300) is still in use.");
  });

  it("registered states render: invalid, saving, saved, failed", async () => {
    for (const key of ["invalid", "saving", "saved", "failed"]) {
      await act(async () => resetDemo());
      await act(async () => quotaState(key));
      await wait(30);
      const text = mainText();
      if (key === "invalid") expect(text).toContain("Enter a whole number from 10 to 300.");
      if (key === "saving") expect(text).toContain("Saving…");
      if (key === "saved") expect(text).toContain("Saved. Cards per review session: 40.");
      if (key === "failed") expect(text).toContain("Your previous size (40) is still in use.");
    }
  });
});

describe("11. quota copy names the limit that decided the new-card count", () => {
  it("session size, daily allowance and library each get their own plain-words explanation", async () => {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    expect(mainText()).toContain("Cards per review session: 40");
    expect(mainText()).toContain(
      "31 new cards this session. 9 of today’s 40 allowances aren’t used because your session holds 40 cards and 9 go to learning and due reviews. Raise Cards per review session in Settings to fit more.",
    );
    // "Change" leads to the setting
    await act(async () => Array.from(document.querySelectorAll("#main button")).find((b) => b.textContent === "Change")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(get().route).toBe("settings");

    await act(async () => quotaState("daily-binds"));
    await wait(700);
    expect(mainText()).toContain("20 new cards — all of today’s allowance.");

    await act(async () => quotaState("library-binds"));
    await wait(700);
    expect(mainText()).toContain("Only 5 new cards are waiting in your library.");
    expect(get().review.sessionCards).toBeNull();

    await act(async () => quotaState("overflow"));
    await wait(700);
    expect(mainText()).toContain("so no new cards are added. 3 cards wait for the next session.");
    expect(mainText()).toContain("10 cards");

    await act(async () => quotaState("min"));
    await wait(700);
    expect(mainText()).toContain("1 new card this session. 39 of today’s 40 allowances aren’t used because your session holds 10 cards and 9 go to learning and due reviews.");
  });

  it("offers Start another session when allowances remain, planned from what is left", async () => {
    await act(async () => resetDemo());
    await act(async () => quotaState("another"));
    await wait(700);
    const another = Array.from(document.querySelectorAll("#main button")).find((b) => b.textContent?.startsWith("Start another session"))!;
    expect(another.textContent).toBe("Start another session (10 cards)");
    await act(async () => another.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await wait(50);
    const r = get().review;
    expect(r.phase).toBe("active");
    expect(r.completed).toBe(0);
    expect(r.sessionCards).toHaveLength(10);
    // Cards finished in the first session are not repeated; allowances already used are not reused.
    expect(r.sessionCards!.every((c) => !r.done[c.id])).toBe(true);
    expect(r.sessionCards!.every((c) => c.group === "new")).toBe(true);
  });
});

describe("12. changing limits mid-session", () => {
  async function startSession() {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    await act(async () => findButton("Start review")!.click());
    await wait(50);
    expect(get().review.sessionCards).toHaveLength(40);
  }
  const unshownNew = () => get().review.sessionCards!.filter((c) => c.group === "new" && !get().review.introduced[c.id]);

  it("lowering the daily limit to the used count removes only not-yet-shown new cards and says how many", async () => {
    await startSession();
    const used = get().newUsed;
    expect(Object.keys(get().review.introduced)).toHaveLength(used);
    await act(async () => setDailyNew(used));
    const r = get();
    expect(unshownNew()).toHaveLength(0);
    expect(r.review.sessionCards).toHaveLength(9 + used); // shown cards stay
    expect(r.review.removedNew).toBe(31 - used);
    expect(r.newUsed).toBe(used); // no allowance moved
    expect(mainText()).toContain(`Card 1 of ${9 + used}`);
    expect(mainText()).toContain(`${31 - used} new cards removed because you lowered today’s limit.`);
  });

  it("lowering it above the used count keeps exactly the allowances that remain", async () => {
    await startSession();
    const used = get().newUsed;
    await act(async () => setDailyNew(used + 5));
    expect(unshownNew()).toHaveLength(5);
    expect(get().review.sessionCards).toHaveLength(9 + used + 5);
  });

  it("a new card never appears without using an allowance", async () => {
    await startSession();
    // Force the worst case: no allowance left while the current card is a not-yet-shown new card.
    await act(async () => {
      const cards = get().review.sessionCards!;
      const idx = cards.findIndex((c) => c.group === "new" && !get().review.introduced[c.id]);
      set((s) => ({ dailyNew: s.newUsed, review: { ...s.review, index: idx } }));
    });
    await wait(50);
    expect(unshownNew()).toHaveLength(0);
    expect(get().newUsed).toBe(get().dailyNew);
    expect(Object.keys(get().review.introduced)).toHaveLength(get().newUsed);
  });

  it("changing the session size mid-session leaves the locked session alone and applies to the next one", async () => {
    await startSession();
    await act(async () => setSessionSize(10));
    expect(get().review.sessionCards).toHaveLength(40);
    await act(async () => go("review"));
    await wait(700);
    expect(mainText()).toContain("This session is locked at 40 cards.");
    expect(mainText()).toContain("Cards per review session: 10");
    await act(async () => go("settings"));
    await wait(50);
    expect(mainText()).toContain("Your session in progress stays at 40 cards. A new size applies from your next session.");

    // Finish the locked session: the next one is planned with size 10 from what is left.
    await act(async () => {
      const cards = get().review.sessionCards!;
      const newIds = cards.filter((c) => c.group === "new").map((c) => c.id);
      set((s) => ({
        newUsed: newIds.length,
        review: { ...s.review, phase: "complete", completed: cards.length, introduced: Object.fromEntries(newIds.map((id) => [id, true])), done: Object.fromEntries(cards.map((c) => [c.id, true])) },
      }));
      go("review");
    });
    await wait(700);
    // 9 allowances left (40 − 31), room for 10 → 9 cards
    expect(mainText()).toContain("Start another session (9 cards)");
  });
});

describe("13. word library order", () => {
  it("Word library lists sentences by number; Saved lists the newest saved first", async () => {
    await act(async () => resetDemo());
    set((s) => ({ libFilters: { ...s.libFilters, q: "" } }));
    await act(async () => go("review/library"));
    await wait(50);
    const numbers = () => Array.from(document.querySelectorAll("#main .lib-group .t-meta"))
        .map((e) => e.textContent!.match(/^Sentence (\d+) ·/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => Number(m[1]));
    const lib = numbers();
    expect(lib.length).toBeGreaterThan(3);
    expect(lib).toEqual([...lib].sort((a, b) => a - b));

    await act(async () => go("review/saved"));
    await wait(50);
    const s = get();
    const newest = new Map<string, number>();
    for (const c of s.cards) if (c.saved && !c.mastered) newest.set(c.sentenceId, Math.max(newest.get(c.sentenceId) ?? 0, c.savedAt));
    const expected = s.sentences.filter((x) => newest.has(x.id)).sort((a, b) => newest.get(b.id)! - newest.get(a.id)!).map((x) => x.number);
    expect(numbers().slice(0, 5)).toEqual(expected.slice(0, 5));
  });
});

describe("14. History retry and detail", () => {
  it("a live attempt's Retry stays busy until its save finishes; a failed retry is announced and stays Not saved", async () => {
    await act(async () => resetDemo());
    await act(async () => clearAttemptHistory());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-03")!.states.find((s) => s.key === "save-failed")!.apply());
    await wait(1600);
    await act(async () => go("progress/history?tab=attempts"));
    await wait(600);
    const retry = () => Array.from(document.querySelectorAll("#main button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;

    // Failing retry
    await act(async () => {
      armFailure("history");
      retry().click();
    });
    await wait(300);
    expect(retry().getAttribute("aria-busy")).toBe("true"); // still saving: not done after 300 ms
    await wait(700);
    expect(retry().getAttribute("aria-busy")).toBeNull();
    expect(get().history.attempts[0].saved).toBe("failed");
    expect(document.body.textContent).toContain("Couldn’t save to practice history");

    // Succeeding retry
    await act(async () => retry().click());
    await wait(300);
    expect(retry().getAttribute("aria-busy")).toBe("true");
    await wait(700);
    expect(get().history.attempts[0].saved).toBe("saved");
    expect(get().history.attempts).toHaveLength(1);
  });

  it("a stored (not live) failed entry also stays busy until saved, and announces when saving fails", async () => {
    await act(async () => resetDemo());
    const rec = { ...get().history.attempts[0], id: "old-failed", saved: "failed" as const };
    expect(get().attempts.some((a) => a.id === rec.id)).toBe(false);
    await act(async () => set((s) => ({ history: { ...s.history, attempts: [rec, ...s.history.attempts] } })));
    await act(async () => go("progress/history?tab=attempts"));
    await wait(600);
    const retry = () => Array.from(document.querySelectorAll("#main button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;
    await act(async () => {
      armFailure("history");
      retry().click();
    });
    await wait(300);
    expect(retry().getAttribute("aria-busy")).toBe("true");
    await wait(700);
    expect(get().history.attempts[0].saved).toBe("failed");
    expect(document.body.textContent).toContain("Couldn’t save the History entry");
    await act(async () => retry().click());
    await wait(1000);
    expect(get().history.attempts[0].saved).toBe("saved");
  });

  it("an unknown id says not found instead of showing the first record", async () => {
    await act(async () => resetDemo());
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      for (const [tab, text] of [["analyses", "Analysis not found."], ["audio", "Audio session not found."], ["attempts", "Attempt not found."]] as const) {
        await act(async () => root.render(<Detail tab={tab} id="does-not-exist" onBack={() => {}} />));
        expect(host.textContent).toContain(text);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe("15. History re-open applies the same text filtering as a new analysis", () => {
  it("keeps only French sentences from pasted text and treats an idea as the idea sentence", () => {
    const mixed = "Yesterday I went to the shop. Il y a deux jours, j’ai failli oublier mon rendez-vous.";
    const out = buildSentencesForAnalysis(mixed, "Pasted text");
    expect(out).toHaveLength(1);
    expect(out[0].fr).toContain("failli oublier");
    expect(buildSentencesForAnalysis("Yesterday I went to the shop and bought bread.", "Pasted text")).toHaveLength(0);
    expect(buildSentencesForAnalysis("I want to say I almost forgot", "My own idea")).toEqual([IDEA_SENTENCE]);
  });
});

export { armFailure };
