// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { WidthContext } from "./components/ui";
import { lookupKey } from "./lib/lookup";
import { submitAnswer } from "./screens/Exercise";
import { resetEpisodeCache } from "./screens/Episodes";
import { resetLastAnalysisOffer } from "./screens/StudyInput";
import { computePlannedSessionCards } from "./screens/Review";
import { StudyLearn } from "./screens/StudyLearn";
import { REGISTRY } from "./screens/registry";
import { fake, installFakeBackend } from "./test/fakeBackend";
import { resetReviewCache } from "./api/review";
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
  updatePlayer,
} from "./state/store";

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
            [key]: { ...s.exercises[key], mode: "whole", drafts: { "0:whole:w": "J’ai oublié mon billet." } },
          },
        }));
      });
      await wait(800);
      expect(wholeDocumentSnapshot()).not.toContain(TARGET);
    }
  });

  it("Review unrevealed cards and the next card after rating do not leak their target anywhere in the document", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "answer")!.apply());
    await wait(50);
    const cards = get().review.sessionCards!;
    const card0 = cards[0];
    expect(wholeDocumentSnapshot()).not.toContain(card0.target);

    // Space reveals the Anki-style ratings; "3" (Good) rates card 0 and advances to card 1.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    });
    expect(document.querySelector(".rev-ratings")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
    });
    await wait(800);

    const card1 = cards[1];
    expect(card1.sentenceId).not.toBe(card0.sentenceId);
    expect(wholeDocumentSnapshot()).not.toContain(card1.target);
    expect(wholeDocumentSnapshot()).not.toContain(card0.sentenceFr);

    // Also check an unrevealed Speak card in Review
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

    const showAnswer = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Answer")!;
    await act(async () => showAnswer.click());
    expect(get().attempts[0].answerKnown).toBe(true);

    const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Retry check")!;
    await act(async () => retry.click());
    await wait(800);

    expect(get().attempts).toHaveLength(1);
    expect(get().attempts[0].status).toBe("completed");
    expect(get().attempts[0].answerKnown).toBe(true);
    expect(document.getElementById("main")!.textContent).toContain("Answer known");
  });

  it("Review: a grading techfail keeps the answer revealed with its rating buttons", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "techfail")!.apply());
    await wait(50);
    const main = document.getElementById("main")!;
    // The reveal is never hidden: the correct answer and the four Anki-style ratings stay visible.
    expect(main.querySelector(".rev-ratings")).toBeTruthy();
    expect(main.textContent).toContain("Again");
    expect(main.textContent).toContain("Good");
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

  it("Speak cards show the answer, then a Good rating is recorded on the server", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REV-02")!.states.find((s) => s.key === "speak")!.apply());
    await wait(50);
    const main = document.getElementById("main")!;
    const speakCard = get().review.sessionCards![get().review.index];
    expect(speakCard.kind).toBe("Speak");
    expect(speakCard.prompt.length).toBeGreaterThan(0);
    expect(main.textContent).toContain(speakCard.prompt);
    expect(main.querySelector("[data-slot=card]")).toBeTruthy();
    expect(document.querySelector("#rev-input")).toBeNull();

    const showBtn = Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Show answer")!;
    await act(async () => showBtn.click());
    expect(main.textContent).toContain("Again");
    expect(main.textContent).toContain("Easy");

    const good = Array.from(main.querySelectorAll("button")).find((b) => b.querySelector(".rev-rate-name")?.textContent === "Good")!;
    await act(async () => good.click());
    await wait(300);
    const rated = fake.calls.filter((c) => /\/api\/srs\/cards\/.+\/review$/.test(c.path));
    expect(rated).toHaveLength(1);
    expect(rated[0].body).toMatchObject({ rating: 3 });
  });
});

describe("3. lookup importance comes from the server count", () => {
  it("opening failli counts one lookup on the server and the popup shows the returned importance", async () => {
    await act(async () => resetDemo());
    fake.lookups[lookupKey("failli")] = 4;
    await act(async () => REGISTRY.find((r) => r.id === "SCR-STU-02")!.states.find((s) => s.key === "single")!.apply());
    await wait(50);
    const wordBtn = document.querySelector<HTMLElement>('[data-word="failli"]')!;
    await act(async () => wordBtn.click());
    await wait(200);

    expect(fake.lookups[lookupKey("failli")]).toBe(5);
    expect(fake.calls.filter((c) => c.path === "/api/srs/lookups" && c.method === "POST")).toHaveLength(1);
    expect(document.body.textContent).toContain("Importance, 5 out of 5, based on 5 lookups.");
    expect(document.body.textContent).not.toContain("Définition de ");
    const french = Array.from(document.querySelectorAll<HTMLButtonElement>(".word-card button")).find(b => b.textContent === "French definitions")!;
    await act(async () => french.click());
    expect(document.body.textContent).toContain("Définition de ");
  });
});

describe("4. clearing practice history resets derived counts", () => {
  it("complete 2 attempts, clear, start a new session, complete 1 → summary says 1 attempt", { timeout: 15000 }, async () => {
    await act(async () => resetDemo());
    await act(async () => clearAttemptHistory());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-REC-01")!.states.find((s) => s.key === "empty")!.apply());
    const k1 = get().activeRun!;
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [k1]: { ...s.exercises[k1], mode: "whole", drafts: { "0:whole:w": TARGET } } } }));
      submitAnswer(k1);
    });
    await wait(300);
    const tryAgainBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => tryAgainBtn.click());
    await act(async () => {
      set((s) => ({ exercises: { ...s.exercises, [k1]: { ...s.exercises[k1], mode: "whole", drafts: { "0:whole:w": TARGET } } } }));
      submitAnswer(k1);
    });
    await wait(300);
    expect(get().attempts.filter((a) => a.sessionKey === k1 && a.status === "completed")).toHaveLength(2);
    expect(fake.calls.filter((c) => c.path === "/api/dictation/attempts")).toHaveLength(2);

    await act(async () => clearAttemptHistory());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states.find((s) => s.key === "final")!.apply());
    await wait(300);

    const summary = document.querySelector('[aria-label="Session summary"]')!;
    expect(summary.textContent).toContain("1 attempt");
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

describe("7. Review quota numbers and frozen session cards", () => {
  it("shows the planned new-card count and freezes session cards once started", async () => {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    const main = document.getElementById("main")!;
    expect(statValue("Learning")).toBe("8");
    expect(statValue("Due")).toBe("1");
    expect(statValue("New")).toBe("31");
    expect(main.textContent).toContain("Cards per review session: 40");
    expect(main.textContent).not.toContain("How new cards are introduced");

    await act(async () => REGISTRY.find((r) => r.id === "SCR-QUO-01")!.states.find((s) => s.key === "two-left")!.apply());
    await wait(100);
    expect(statValue("New")).toBe("2");
    expect(statValue("New cards introduced today")).toBe("38");
    expect(statValue("Daily new-card limit")).toBe("40 cards");

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
  it("correct result shows one correct-answer block and clean inline text, with no leftover input", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states[0].apply());
    await wait(1700);
    const text = document.getElementById("main")!.textContent!;
    expect(document.querySelectorAll('[aria-label="Correct answer"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="Inline corrections"] del')).toBeNull();
    expect(document.querySelector("#main textarea")).toBeNull();
    expect(text).not.toContain("Hint and answer flags were recorded when you checked.");
  });

  it("incorrect feedback shows inline accent corrections without an issue list", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-02")!.states.find((s) => s.key === "accent")!.apply());
    await wait(1700);
    const main = document.getElementById("main")!;
    expect(main.querySelector(".tok-tag")).toBeNull();
    expect(main.textContent).not.toContain("Accent: you wrote");
    expect(main.querySelector('[data-mark="accent"] del')?.textContent).toBe("oublie");
    expect(main.querySelector('[aria-label="Accent correction: oublié"]')?.textContent).toBe("oublié");
    expect(main.querySelector(".issues")).toBeNull();
  });

  it("History analysis Open in Study loads that analysis's sentences, and Find saved card filters by full sentence", async () => {
    await act(async () => resetDemo());
    fake.attempts = [attemptRow("t1", "Nous avons pris un café près de la gare.")];
    fake.studyRecords = [studyRecord("r1", ["Le plat du jour est excellent.", "Nous avons pris un café."])];
    await act(async () => go("progress/history?tab=attempts"));
    await wait(200);
    await act(async () => openHistoryRow("Nous avons pris un café près de la gare.").click());
    await act(async () => buttonWith("Find saved card").click());
    expect(get().libFilters.q).toBe("Nous avons pris un café près de la gare.");

    await act(async () => go("progress/history?tab=analyses"));
    await wait(200);
    await act(async () => openHistoryRow("Le plat du jour").click());
    await act(async () => buttonWith("Open this analysis in Study").click());
    expect(get().study.sentences.map((x) => x.fr)).toEqual(["Le plat du jour est excellent.", "Nous avons pris un café."]);
    expect(get().route).toBe("study");
  });

  it("a failed history save offers Retry saving, which resends the same attempt", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-03")!.states.find((s) => s.key === "save-failed")!.apply());
    await wait(50);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("Couldn’t save to practice history");
    const attempts = get().attempts.length;

    fake.saveFails = 1;
    const retry = () => Array.from(main.querySelectorAll("button")).find((b) => b.textContent === "Retry saving")!;
    await act(async () => retry().click());
    expect(main.textContent).toContain("Saving to practice history…");
    await wait(200);
    expect(main.textContent).toContain("Couldn’t save to practice history");

    await act(async () => retry().click());
    await wait(200);
    expect(main.textContent).not.toContain("Couldn’t save to practice history");
    expect(get().attempts.some((a) => a.history === "saved")).toBe(true);
    expect(get().attempts).toHaveLength(attempts);
    expect(fake.calls.filter((c) => c.path === "/api/dictation/attempts")).toHaveLength(2);
  });

  it("responsive widths (320, 390, 768, desktop): word card is a bottom drawer below md and a floating popover from md up", async () => {
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
        expect(document.querySelector("[data-slot=drawer-content] .word-card")).toBeTruthy();
        expect(host.querySelector(".sentence-fr")).toBeTruthy();
        const closeBtn = document.querySelector<HTMLElement>('[data-slot=drawer-content] button[aria-label="Close"]')!;
        await act(async () => closeBtn.click());
        expect(document.querySelector("[data-slot=drawer-content]")).toBeNull();
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
        expect(document.querySelector("[data-slot=popover-content] .word-card")).toBeTruthy();
        expect(document.querySelector(".word-dock, .popover")).toBeNull();
        expect(host.querySelector(".sentence-fr")).toBeTruthy();
        expect(document.querySelector("[data-slot=sheet-content]")).toBeNull();
        const close = document.querySelector<HTMLButtonElement>('[data-slot=popover-content] button[aria-label="Close"]')!;
        await act(async () => close.click());
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

/* ---------------- round 3: session size, quota, mid-session changes ---------------- */

const mainText = () => document.getElementById("main")!.textContent!;
const statValue = (label: string) => {
  const dt = Array.from(document.querySelectorAll("dt")).find((el) => el.textContent === label);
  return dt?.nextElementSibling?.textContent?.replace(/\s+/g, " ").trim() ?? "";
};
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
      fake.failNext.add("/api/srs/settings");
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

describe("11. quota numbers name the limit that decided the new-card count", () => {
  it("session size, daily allowance and library each show up in the session stats", async () => {
    await act(async () => resetDemo());
    await act(async () => go("review"));
    await wait(700);
    expect(mainText()).toContain("Cards per review session: 40");
    expect(statValue("New")).toBe("31");
    expect(statValue("Daily new-card limit")).toBe("40 cards");
    // "Change" leads to the setting
    await act(async () => Array.from(document.querySelectorAll("#main button")).find((b) => b.textContent === "Change")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(get().route).toBe("settings");

    await act(async () => quotaState("daily-binds"));
    await wait(700);
    expect(statValue("New")).toBe("20");
    expect(statValue("Daily new-card limit")).toBe("20 cards");

    await act(async () => quotaState("library-binds"));
    await wait(700);
    expect(statValue("New")).toBe("5");
    expect(get().review.sessionCards).toBeNull();

    await act(async () => quotaState("overflow"));
    await wait(700);
    expect(statValue("New")).toBe("0");
    expect(document.getElementById("today-h")!.nextElementSibling!.textContent).toBe("10");

    await act(async () => quotaState("min"));
    await wait(700);
    expect(statValue("New")).toBe("1");
    expect(mainText()).toContain("Cards per review session: 10");
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
    expect(mainText()).toContain(`1 / ${9 + used}`);
    expect(mainText()).not.toContain(`Card 1 of ${9 + used}`);
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
    await act(async () => {
      setSessionSize(10); // what Settings does once the server saved it
      fake.srs.sessionSize = 10;
    });
    expect(get().review.sessionCards).toHaveLength(40);
    await act(async () => go("review"));
    await wait(700);
    expect(get().review.sessionCards).toHaveLength(40);
    expect(mainText()).toContain("Cards per review session: 10");
    await act(async () => go("settings"));
    await wait(50);
    expect(mainText()).toContain("Your session in progress stays at 40 cards. A new size applies from your next session.");

    // Finish the locked session (the server now holds those reviews): the next one is planned with size 10 from what is left.
    await act(async () => {
      const cards = get().review.sessionCards!;
      const ids = new Set(cards.map((c) => c.id));
      for (const c of fake.srs.cards)
        if (ids.has(c.id)) {
          if (c.state === "new") fake.srs.newToday++;
          c.state = "review";
          c.due = new Date(Date.now() + 86_400_000).toISOString();
        }
      set((s) => ({ review: { ...s.review, phase: "complete", completed: cards.length } }));
      go("review");
    });
    await wait(700);
    // 9 allowances left (40 − 31), room for 10 → 9 cards
    expect(mainText()).toContain("Start another session (9 cards)");
  });
});

describe("13. saved cards order", () => {
  it("keeps the Saved table and sends the legacy library route to it", async () => {
    await act(async () => resetDemo());
    set((s) => ({ libFilters: { ...s.libFilters, q: "" } }));
    await act(async () => go("review/library"));
    await wait(300);
    expect(get().route).toBe("review/saved");
    expect(location.pathname).toBe("/app/review/saved");
    expect(document.querySelector('#review-tab-library')).toBeNull();
    expect(mainText()).not.toContain("Word library");
    expect(document.querySelector("#main .lib-group")).toBeNull();
    const table = document.querySelector("#main table.saved-table")!;
    expect(table).toBeTruthy();
    // Saved is now a table whose default sort is newest saved first.
    const savedTh = Array.from(table.querySelectorAll("th")).find((th) => th.textContent?.trim().startsWith("Saved"))!;
    expect(savedTh.getAttribute("aria-sort")).toBe("descending");
    const savedOrder = Array.from(table.querySelectorAll("tbody tr")).map((r) => Number(r.getAttribute("data-saved")));
    expect(savedOrder.length).toBeGreaterThan(0);
    expect(savedOrder).toEqual([...savedOrder].sort((a, b) => b - a));
  });
});

describe("14. History, Progress and Episodes on the server", () => {
  it("clearing attempts deletes them on the server and leaves study records alone", async () => {
    await act(async () => resetDemo());
    fake.attempts = [attemptRow("t1", "Bonjour."), attemptRow("t2", "Merci.", false)];
    fake.studyRecords = [studyRecord("r1", ["Bonjour."])];
    await act(async () => go("progress/history?tab=attempts"));
    await wait(200);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("2 practice attempts");
    await act(async () => buttonWith("Clear practice attempt history").click());
    await act(async () => buttonWith("Clear attempt history").click());
    await wait(300);
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/dictation/history")).toBe(true);
    expect(fake.attempts).toHaveLength(0);
    expect(fake.studyRecords).toHaveLength(1);
    expect(main.textContent).toContain("No practice attempts");
  });

  it("an analysis saved without sentences can't be reopened, only put back as text", async () => {
    await act(async () => resetDemo());
    fake.studyRecords = [{ ...studyRecord("r1", []), sentences: undefined, sentenceCount: 3, text: "Texte ancien." }];
    await act(async () => go("progress/history?tab=analyses"));
    await wait(200);
    await act(async () => openHistoryRow("Texte ancien.").click());
    expect(document.getElementById("main")!.textContent).toContain("can’t be opened");
    await act(async () => buttonWith("Put the text in Study").click());
    expect(get().study.drafts.text).toBe("Texte ancien.");
    expect(get().route).toBe("study/new");
  });

  it("study time lists each day with its lanes and hand-logged time", async () => {
    await act(async () => resetDemo());
    await act(async () => go("progress/history?tab=time"));
    await wait(200);
    const t = document.getElementById("main")!.textContent!;
    expect(t).toContain("25 min");
    expect(t).toContain("Reading 15 min");
    expect(t).toContain("Review 10 min");
    expect(t).toContain("10 min logged by hand");
  });

  it("after a reload Study offers the last saved analysis", async () => {
    await act(async () => resetDemo());
    fake.studyRecords = [studyRecord("r1", ["Il fait beau.", "On sort ?"])];
    await act(async () => go("study/new"));
    await wait(200);
    expect(document.getElementById("main")!.textContent).toContain("Continue");
    expect(document.getElementById("main")!.textContent).toContain("2 sentences saved");
    await act(async () => buttonWith("Continue").click());
    expect(get().study.sentences).toHaveLength(2);
    expect(get().route).toBe("study");
  });

  it("Progress shows the server's totals and the episode player shows the transcript", async () => {
    await act(async () => resetDemo());
    await act(async () => go("progress"));
    await wait(200);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("40 XP to level 4");
    expect(main.textContent).not.toContain("Demo data");
    await act(async () => go("practice/episodes/e1"));
    await wait(200); // the list arrives, then the player asks for the transcript
    await wait(200);
    expect(main.textContent).toContain("Un samedi au marché");
    expect(main.textContent).toContain("On va au marché.");
  });
});

describe("15. Practice, Settings and the exam placeholder on the server", () => {
  beforeAll(() => {
    // jsdom has no media playback; the shared player is driven by hand below.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  const main = () => document.getElementById("main")!;
  const area = (id: string) => document.getElementById(id) as HTMLTextAreaElement;
  const typeArea = (el: HTMLTextAreaElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("Write: hints first, then corrections, and a corrected sentence goes to Review", { timeout: 20000 }, async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/write"));
    await wait(200);
    expect(main().textContent).toContain("Invitez un ami à dîner.");
    await typeArea(area("write-ta"), "Samedi je suis allé au marché avec ma sœur.");
    await act(async () => buttonWith("Get feedback").click());
    await wait(3400);
    expect(main().textContent).toContain("Check the past participle.");
    expect(main().textContent).not.toContain("Je suis allée au marché.");
    await typeArea(area("write-rev"), "Samedi je suis allée au marché avec ma sœur.");
    await act(async () => buttonWith("Get corrections").click());
    await wait(3400);
    expect(main().textContent).toContain("Writing practice complete");
    expect(main().textContent).toContain("Je suis allée au marché.");
    await act(async () => buttonWith("Add to review").click());
    await wait(100);
    const note = fake.calls.find((c) => c.path === "/api/srs/notes" && c.method === "POST")!;
    expect(note.body).toMatchObject({ sentence: "Je suis allée au marché.", modes: ["listen", "speak"], targets: [{ text: "suis allée", mode: "cloze" }] });
    expect(main().textContent).toContain("In Review");
  });

  it("Speak: a recording is transcribed into the editable transcript and gets feedback", { timeout: 20000 }, async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const nav = navigator as unknown as { mediaDevices?: unknown };
    class FakeRecorder {
      static isTypeSupported = (t: string) => t === "audio/webm";
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    g.MediaRecorder = FakeRecorder;
    nav.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
    g.URL = Object.assign(URL, { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });
    try {
      await act(async () => resetDemo());
      await act(async () => go("practice/speak"));
      await wait(200);
      expect(main().textContent).toContain("Comment vous appelez-vous ?");
      await act(async () => buttonWith("Start recording").click());
      await wait(50);
      await act(async () => buttonWith("Stop recording").click());
      await wait(200);
      expect(area("speak-ta").value).toBe("Bonjour, je m’appelle Léa.");
      const up = fake.calls.find((c) => c.path === "/api/transcribe")!;
      expect(up.method).toBe("POST");
      await act(async () => buttonWith("Get feedback").click());
      await wait(3400);
      const sent = fake.calls.find((c) => c.path === "/api/speak/attempts" && c.method === "POST")!;
      expect(sent.body).toMatchObject({ task: "T1", transcript: "Bonjour, je m’appelle Léa.", audio_duration: 4 });
      expect(main().textContent).toContain("Clear and polite.");
    } finally {
      delete g.MediaRecorder;
      delete nav.mediaDevices;
    }
  });

  it("Speak without a microphone says to type instead", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/speak"));
    await wait(200);
    await act(async () => buttonWith("Start recording").click());
    await wait(50);
    expect(main().textContent).toContain("This browser can’t record audio. Type your answer instead.");
  });

  it("Listen: blind play, self-rating, text, three relistens unlock the question", { timeout: 15000 }, async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/listen"));
    await wait(100);
    await act(async () => buttonWith("Start listening").click());
    await wait(200);
    expect(main().textContent).not.toContain("On va au marché.");
    const end = async () => {
      await wait(20);
      await act(async () => updatePlayer({ status: "ended" }));
      await wait(150);
    };
    await act(async () => buttonWith("Play the clip").click());
    await end();
    await act(async () => (Array.from(main().querySelectorAll("label")).find((l) => l.textContent === "Most or all of it")!.querySelector("button, input") as HTMLElement).click());
    await act(async () => buttonWith("Continue").click());
    await wait(150);
    await act(async () => buttonWith("Show the text").click());
    await wait(150);
    expect(main().textContent).toContain("On va au marché.");
    expect(main().textContent).not.toContain("Où vont-ils ?");
    for (const label of ["Play · Slow", "Play · Normal speed", "Play · Normal speed again"]) {
      await act(async () => buttonWith(label).click());
      await end();
    }
    const stages = fake.calls.filter((c) => c.path.endsWith("/relisten")).map((c) => (c.body as { stage: string }).stage);
    expect(stages).toEqual(["slow20", "normal", "normal"]);
    expect(main().textContent).toContain("Où vont-ils ?");
    await act(async () => (Array.from(main().querySelectorAll("label")).find((l) => l.textContent?.startsWith("Au marché"))!.querySelector("button, input") as HTMLElement).click());
    await act(async () => buttonWith("Check").click());
    await wait(150);
    expect(main().textContent).toContain("Correct");
    const check = fake.calls.find((c) => c.path.endsWith("/check"))!;
    expect(check.body).toMatchObject({ answer_index: 0, seconds: 0 });
  });

  it("Listen with nothing studied sends the learner to Study", async () => {
    await act(async () => resetDemo());
    fake.noListening = true;
    await act(async () => go("practice/listen"));
    await wait(100);
    await act(async () => buttonWith("Start listening").click());
    await wait(150);
    expect(main().textContent).toContain("Nothing to listen to yet");
  });

  it("Audio Studio: own words to French, then audio with a download link", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/studio"));
    await wait(50);
    await typeArea(area("studio-in"), "I would like a coffee");
    await act(async () => buttonWith("Make it French").click());
    await wait(150);
    expect(area("studio-fr").value).toBe("Je voudrais un café, s’il vous plaît.");
    await act(async () => buttonWith("Make audio").click());
    await wait(150);
    expect(fake.calls.find((c) => c.path === "/api/speech")!.body).toMatchObject({ text: "Je voudrais un café, s’il vous plaît.", voice: "fr-FR-DeniseNeural" });
    expect(main().querySelector('a[href="/files/fake.mp3?download=true"]')).toBeTruthy();
    await typeArea(area("studio-fr"), "Un thé, merci.");
    expect(buttonWith("Make audio again")).toBeTruthy();
  });

  it("Settings lists signed-in devices and signs another one out; nothing is simulated", async () => {
    await act(async () => resetDemo());
    await act(async () => go("settings"));
    await wait(200);
    const t = main().textContent!;
    expect(t).toContain("Chrome on Linux");
    expect(t).toContain("This device");
    expect(t).not.toMatch(/Demo|simulated|Sync/);
    const row = Array.from(main().querySelectorAll("li")).find((li) => li.textContent?.includes("Safari on iPhone"))!;
    await act(async () => row.querySelector("button")!.click());
    await wait(150);
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/auth/devices/d2")).toBe(true);
    expect(main().textContent).not.toContain("Safari on iPhone");
  });

  it("Exam practice is an honest placeholder", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/exams"));
    await wait(50);
    expect(main().textContent).toContain("not yet verified");
    expect(document.querySelector(".demo-banner")).toBeNull();
  });

  it("Removed pages (old /coach, /grammar, /homework links) say they moved, without a demo banner", async () => {
    await act(async () => resetDemo());
    await act(async () => go("moved"));
    await wait(50);
    expect(main().textContent).toContain("This page has moved");
    expect(document.querySelector(".demo-banner")).toBeNull();
  });
});

function openHistoryRow(snippet: string): HTMLButtonElement {
  const row = Array.from(document.querySelectorAll("#main tr")).find((tr) => tr.textContent?.includes(snippet));
  const btn = row && Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Open");
  if (!btn) throw new Error(`No Open button in a row containing "${snippet}"`);
  return btn;
}
function buttonWith(text: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>("#main button, [role=dialog] button")).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`No button with "${text}"`);
  return b;
}

function studyRecord(id: string, frs: string[]) {
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

function attemptRow(id: string, sentence: string, correct = true) {
  return { id, item_id: "i", mode: "write", step: 0, answer: sentence, expected: sentence, accuracy: correct ? 100 : 50, correct, created_at: "2026-01-01T10:00:00Z", sentence };
}

export { armFailure };
