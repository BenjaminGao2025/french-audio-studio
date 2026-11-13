// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WidthContext } from "./components/ui";
import { StudyLearn } from "./screens/StudyLearn";
import { REGISTRY } from "./screens/registry";
import { fake } from "./test/fakeBackend";
import { get, go, resetDemo, set, setDailyNew, setSessionSize } from "./state/store";
import { setupSmoke, wait, mainText, statValue, findButton, fieldByLabel, typeInto, quotaState, openHistoryRow, buttonWith, studyRecord, attemptRow } from "./test/smokeHarness";

setupSmoke();

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
  it("correct result shows the answer once, as clean inline text, with no leftover input", async () => {
    await act(async () => resetDemo());
    await act(async () => REGISTRY.find((r) => r.id === "SCR-ANS-01")!.states[0].apply());
    await wait(1700);
    const text = document.getElementById("main")!.textContent!;
    expect(document.querySelectorAll('[aria-label="Correct answer"]')).toHaveLength(0);
    expect(document.querySelector('[aria-label="Inline corrections"]')?.textContent?.trim()).toBeTruthy();
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

  it("History analysis Open goes straight to Study with that analysis's sentences, and Find saved card filters by full sentence", async () => {
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
