// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { lookupKey } from "./lib/lookup";
import { submitAnswer } from "./screens/Exercise";
import { computePlannedSessionCards } from "./screens/Review";
import { REGISTRY } from "./screens/registry";
import { fake } from "./test/fakeBackend";
import { clearAttemptHistory, expireMastery, get, markMastered, recordSimulatedAudio, resetDemo, set, setClock, startPlayback, stopPlayback, tick, undoMastery } from "./state/store";
import { setupSmoke, wait, TARGET, wholeDocumentSnapshot } from "./test/smokeHarness";

setupSmoke();

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
    expect(document.body.textContent).toContain("Importance, 4 out of 5. Looked up 5 times.");
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
