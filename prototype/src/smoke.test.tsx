// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import App from "./App";
import { WidthContext } from "./components/ui";
import { lookupKey } from "./lib/lookup";
import { submitAnswer } from "./screens/Exercise";
import { computePlannedSessionCards } from "./screens/Review";
import { StudyLearn } from "./screens/StudyLearn";
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
  startPlayback,
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
      set((s) => ({ libFilters: { ...s.libFilters, q: "", favoritesOnly: true } }));
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
    const before = { ...get().audioStats };
    await act(async () => startPlayback({ kind: "episode", label: "Episode: Un samedi au marché", route: "practice/episodes/e1", episodeId: "e1" }, 1080));
    await wait(800);
    expect(get().player?.status).toBe("playing");

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      await act(async () => {
        for (let i = 0; i < 10; i++) tick(1);
      });
      expect(get().player?.countedSeconds).toBe(0);
      expect(get().audioStats).toEqual(before);
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    }

    // 10 content minutes (600 s) at 2× adds 5 counted minutes (300 s = 5/60 h) to all four totals
    await act(async () => {
      recordSimulatedAudio(600, 2);
    });
    const after = get().audioStats;
    expect(after.todaySeconds - before.todaySeconds).toBe(300);
    expect(after.weekSeconds - before.weekSeconds).toBe(300);
    expect(after.lifetimeHours - before.lifetimeHours).toBeCloseTo(300 / 3600, 6);
    expect(after.last28Hours - before.last28Hours).toBeCloseTo(300 / 3600, 6);
  });
});

describe("6. independent 6-second Undo window per mastery action", () => {
  it("mark A at 0 s and B at 2 s; Undo A at 5 s succeeds; B expires at 8 s", async () => {
    await act(async () => resetDemo());
    const saved = get().cards.filter((c) => c.saved && !c.mastered);
    const cardA = saved[0];
    const cardB = saved[1];

    let idA = "";
    let idB = "";
    await act(async () => {
      idA = markMastered(cardA.id, 0);
      idB = markMastered(cardB.id, 2000);
    });
    expect(get().cards.find((c) => c.id === cardA.id)!.mastered).toBe(true);
    expect(get().cards.find((c) => c.id === cardB.id)!.mastered).toBe(true);

    // At 5 s (5000 ms): Undo A succeeds; B is still active (5000 - 2000 = 3000 < 6000)
    let undidA = false;
    await act(async () => {
      undidA = undoMastery(idA, 5000);
    });
    expect(undidA).toBe(true);
    expect(get().cards.find((c) => c.id === cardA.id)!.mastered).toBe(false);
    expect(get().mastery.find((m) => m.id === idA)!.state).toBe("undone");
    expect(get().mastery.find((m) => m.id === idB)!.state).toBe("active");

    // At 8 s (8000 ms): B has elapsed 6000 ms (8000 - 2000 = 6000) and expires
    await act(async () => {
      expireMastery(8000);
    });
    expect(get().mastery.find((m) => m.id === idB)!.state).toBe("expired");
    expect(get().cards.find((c) => c.id === cardB.id)!.mastered).toBe(true);
  });
});

describe("7. self-explaining Review quota numbers and frozen session cards", () => {
  it("explains 31 assigned vs 9 unassigned allowances, shows 2-of-5 from a real 5-card sentence, and freezes session cards once started", async () => {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("31 new cards are assigned to today’s session · 9 of today’s 40 allowances not assigned");
    expect(main.textContent).toContain("has 5 new cards");

    // Demo state: 2 allowances remain -> 2 introduced today, 3 left for later from the 5-new-card fixture sentence
    await act(async () => REGISTRY.find((r) => r.id === "SCR-QUO-01")!.states.find((s) => s.key === "two-of-five")!.apply());
    await wait(700);
    expect(main.textContent).toContain("has 5 new cards. 2 will be introduced today");
    expect(main.textContent).toContain("and 3 left for later");

    // Start a session from default state, then change dailyNew mid-session: session card count stays frozen at 40
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    const startBtn = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Start review")!;
    await act(async () => startBtn.click());
    await wait(50);
    expect(get().review.sessionCards).toHaveLength(40);

    await act(async () => {
      set(() => ({ dailyNew: 10 }));
      go("review");
    });
    await wait(700);
    expect(main.textContent).toContain("40 cards");
    expect(get().review.sessionCards).toHaveLength(40);
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

export { armFailure };
