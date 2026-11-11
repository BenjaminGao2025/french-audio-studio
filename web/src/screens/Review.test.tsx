// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCard } from "../data/fixtures";
import { ReviewScreen } from "../screens/Review";
import { loadLibrary, resetReviewCache, toReviewCard } from "../api/review";
import { resetLookupCaches } from "../api/lookup";
import { fake, installFakeBackend } from "../test/fakeBackend";
import * as store from "../state/store";
import * as feedback from "../lib/feedback";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const FR = "Nous avons pris le bus.";
const INTERVALS = { 1: 60, 2: 600, 3: 86400, 4: 345600 };

/** A real review card with a full server metadata snapshot, as api/review.ts now produces. */
function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: "c-review-1",
    sentenceId: "s-review-1",
    group: "due",
    kind: "Fill-in",
    prompt: "Nous _____ pris le bus.",
    target: "avons",
    sentenceFr: FR,
    mode: "cloze",
    intervals: { ...INTERVALS },
    meta: {
      meaning_zh: "有（助动词）",
      meaning_en: "have (auxiliary)",
      ctx_zh: "这里表示完成时",
      ctx_en: "present perfect here",
      dict_zh: "词典释义",
      dict_en: "dictionary gloss",
      why_zh: "因为主语是 nous。",
      hook: "avons ~ nous",
      lemma: "avoir",
      pos: "verb",
      ipa: "avɔ̃",
      snap: "1",
    },
    translationZh: "我们坐了公交车。",
    translationEn: "We took the bus.",
    grammar: [{ title: "passé composé", explanation: "An auxiliary plus a past participle.", hook: " hier" }],
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(() => {
  installFakeBackend();
  document.body.innerHTML = '<div id="app-root"></div>';
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  fake.reset();
  resetReviewCache();
  resetLookupCaches();
  window.getSelection()?.removeAllRanges();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

/** Mount a single-card review session with a known ReviewUI state. */
async function mount(c: ReviewCard, opts: { revealed?: boolean } = {}) {
  await act(async () => {
    store.resetDemo();
    store.set((s) => ({
      review: { ...s.review, phase: "active", index: 0, completed: 0, done: {}, introduced: {}, removedNew: 0, sessionCards: [c] },
      reviewUi: { [c.id]: { draft: "", phase: "answering" as const, hint: false, revealed: Boolean(opts.revealed) } },
      ss: {},
    }));
    root.render(<ReviewScreen sub="session" />);
  });
  await wait(40);
}

const button = (text: string): HTMLButtonElement => {
  const b = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent === text);
  if (!b) throw new Error(`No button "${text}"`);
  return b;
};

describe("Task C — Anki-style review card", () => {
  it("the four rating buttons show the server's interval previews", async () => {
    await mount(card(), { revealed: true });
    const rates = Array.from(host.querySelectorAll<HTMLButtonElement>(".rev-rate"));
    expect(rates).toHaveLength(4);
    expect(rates.map((b) => b.querySelector(".rev-rate-name")?.textContent)).toEqual(["Again", "Hard", "Good", "Easy"]);
    expect(rates.map((b) => b.querySelector(".rev-rate-interval")?.textContent)).toEqual(["1 min", "10 min", "1 d", "4 d"]);
  });

  it("Space reveals and the '3' key POSTs rating 3", async () => {
    await mount(card({ id: fake.srs.cards[0].id }));
    expect(host.querySelector(".rev-ratings")).toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
    });
    expect(host.querySelector(".rev-ratings")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
    });
    await wait(200);
    const rated = fake.calls.filter((c) => /\/api\/srs\/cards\/.+\/review$/.test(c.path));
    expect(rated).toHaveLength(1);
    expect(rated[0].body).toMatchObject({ rating: 3 });
  });

  it("a Listen card calls sayFrench(sentence) on show", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ mode: "listen", kind: "Listen", prompt: "", id: "c-listen" }));
    expect(spy).toHaveBeenCalledWith(FR);
  });

  it("a Speak card calls sayFrench(sentence) on reveal", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ mode: "speak", kind: "Speak", prompt: "We took the bus.", target: FR, id: "c-speak" }));
    expect(spy).not.toHaveBeenCalled();
    await act(async () => button("Show answer").click());
    expect(spy).toHaveBeenCalledWith(FR);
  });

  it("a word click on the back speaks it and opens the word card", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card(), { revealed: true });
    const word = host.querySelector<HTMLElement>('.fr-word[data-word="avons"]')!;
    expect(word).toBeTruthy();
    await act(async () => word.click());
    await wait(150);
    expect(spy).toHaveBeenCalledWith("avons");
    expect(document.querySelector(".word-card")).toBeTruthy();
    expect(document.querySelector(".wp-headword")?.textContent).toBe("avons");
  });

  it("a Fill-in card shows the translation and the clue", async () => {
    await mount(card());
    const text = host.textContent ?? "";
    expect(text).toContain("我们坐了公交车。");
    expect(text).toContain("Blank means:");
    expect(text).toContain("有（助动词）");
  });

  it.each([
    { mode: "cloze" as const, word: "Nous" },
    { mode: "recognize" as const, word: "avons" },
  ])("a $mode front word speaks and opens its meaning without revealing or rating the card", async ({ mode, word }) => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    const c = card({ mode });
    await mount(c);
    spy.mockClear();
    await act(async () => host.querySelector<HTMLElement>(`.fr-word[data-word="${word}"]`)!.click());
    await wait(150);

    expect(spy).toHaveBeenCalledWith(word);
    expect(document.querySelector(".word-card")).toBeTruthy();
    expect(document.querySelector(".wp-headword")?.textContent).toBe(word);
    expect(fake.calls.find((call) => call.path === "/api/word-context")?.body).toMatchObject({
      sentence: FR, word, occurrence: 0,
    });
    expect(store.get().reviewUi[c.id].revealed).toBe(false);
    expect(host.querySelector(".rev-ratings")).toBeNull();
    expect(fake.calls.filter((call) => /\/api\/srs\/cards\/.+\/review$/.test(call.path))).toHaveLength(0);
  });

  it("before the reveal, R on a cloze and a speak card never calls sayFrench", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ id: "cloze-r" }));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    });
    expect(spy).not.toHaveBeenCalled();

    await mount(card({ id: "speak-r", mode: "speak", kind: "Speak", prompt: "We took the bus.", target: FR }));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "R", bubbles: true }));
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a recognize front shows the French word, no typing, and speaks the word on show", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ id: "rec-1", mode: "recognize", kind: "Fill-in", target: "soleil", prompt: "" }));
    expect(spy).toHaveBeenCalledWith("soleil");
    expect(host.querySelector("[aria-label='Play']")).toBeTruthy();
    expect(host.textContent).not.toContain("What does it mean?");
    expect(host.querySelector('.fr-word[data-word="soleil"]')).toBeTruthy();
    expect(host.querySelector("#rev-input")).toBeNull();
  });

  it("'Blank means' is absent on a Recall card, which has no blank", async () => {
    await mount(card({ id: "recall-1", kind: "Recall", prompt: "We took the bus.", target: FR }));
    expect(host.textContent).not.toContain("Blank means:");
  });

  it("a recognize lemma missing from the sentence stays a word-only front", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(toReviewCard({
      ...fake.srs.cards[0], id: "rec-lemma", mode: "recognize", target: "aller",
      note: { id: "rec-note", sentence: "Je vais au café.", translation_en: "I go to the cafe.", translation_zh: "" },
    }));
    expect(spy).toHaveBeenCalledWith("aller");
    expect(host.querySelector('.fr-word[data-word="aller"]')).toBeTruthy();
    expect(host.querySelector("#rev-input")).toBeNull();
    expect(host.textContent).not.toContain("Je vais au café.");
    expect(host.textContent).not.toContain("I go to the cafe.");
    await act(async () => button("Show answer").click());
    expect(host.textContent).toContain("Je vais au café.");
  });

  it("the session is one card: Show answer in the footer, grades in an even row, actions in the menu", async () => {
    vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ mode: "listen", kind: "Listen", prompt: "", id: "c-card" }));
    expect(host.querySelector("[data-slot=card]")).toBeTruthy();
    expect(host.querySelector("[aria-label='Card actions']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Play']")).toBeTruthy();
    expect(host.textContent).not.toContain("Listen, then say what it means");
    expect(host.textContent).not.toContain("takes the suggestion");
    expect(host.textContent).not.toContain("Card 1 of");
    const show = button("Show answer");
    expect(show.className).toContain("w-full");
    expect(show.closest("[data-slot=card-footer]")).toBeTruthy();
    await act(async () => show.click());
    const rates = Array.from(host.querySelectorAll<HTMLButtonElement>(".rev-rate"));
    expect(rates).toHaveLength(4);
    expect(host.querySelector("[data-slot=card-footer] .rev-ratings")).toBeTruthy();
    expect(rates[2].getAttribute("data-variant")).toBe("default");
    expect(rates.filter((b) => b.getAttribute("data-variant") === "outline")).toHaveLength(3);
    expect(host.querySelector(`[data-sentence="${FR}"]`)).toBeTruthy();
    expect(host.querySelector("#rev-result [aria-label=Play]")).toBeTruthy();
  });
});

const typeInput = async (selector: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
};
const enterInput = async (input: HTMLInputElement) => {
  await act(async () => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
};

describe("Task C — revealed result and optional repetitions", () => {
  it("Enter in the compact answer checks; three correct repetitions never grade", async () => {
    const sound = vi.spyOn(feedback, "practiceFeedback").mockImplementation(() => {});
    await mount(card({ id: fake.srs.cards[0].id }));
    const answer = await typeInput("#rev-input", "avon");
    expect(answer.tagName).toBe("INPUT");
    await enterInput(answer);
    expect(host.querySelector('[aria-label="Incorrect"]')).toBeTruthy();
    expect(host.querySelector("#rev-result-heading")?.textContent).toBe("Result");
    const practice = await typeInput("#rev-retype", "avon");
    await enterInput(practice);
    expect(host.textContent).toContain("Try again");
    expect(host.textContent).toContain("0/3");
    for (let i = 1; i <= 3; i++) {
      await typeInput("#rev-retype", "avons");
      await enterInput(practice);
      expect(host.textContent).toContain(`${i}/3`);
      expect(practice.value).toBe("");
    }
    expect(sound).toHaveBeenCalledTimes(3);
    expect(fake.calls.filter((c) => /\/review$/.test(c.path))).toHaveLength(0);
    expect(store.get().review.completed).toBe(0);
    // Grading is available even while the practice input still has focus.
    await act(async () => host.querySelector<HTMLButtonElement>('[data-rating="1"]')!.click());
    await wait(200);
    expect(fake.calls.filter((c) => /\/review$/.test(c.path))).toHaveLength(1);
  });

  it("a correct Check has a check mark and no repetition input", async () => {
    await mount(card());
    await enterInput(await typeInput("#rev-input", "avons"));
    expect(host.querySelector('[aria-label="Correct"]')).toBeTruthy();
    expect(host.querySelector("#rev-retype")).toBeNull();
    expect(host.querySelector('[data-slot="accordion"]')).toBeTruthy();
    expect(host.querySelector('.rev-rate [data-slot="kbd"]')).toBeNull();
    expect(host.querySelector(".rev-ratings")?.textContent).not.toContain("Enter");
  });

  it("both phrase buttons and the word heading pronounce the whole phrase", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await mount(card({ target: "tout de suite" }));
    await enterInput(await typeInput("#rev-input", "suite"));
    spy.mockClear();
    const phraseButtons = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "tout de suite");
    expect(phraseButtons).toHaveLength(2);
    for (const phrase of phraseButtons) await act(async () => phrase.click());
    await act(async () => button("Word/phrase").click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Pronounce tout de suite"]')!.click());
    expect(spy.mock.calls).toEqual(Array.from({ length: 4 }, () => ["tout de suite"]));
  });

  it("grading before any repetitions and the Enter suggestion still work", async () => {
    await mount(card({ id: fake.srs.cards[0].id }));
    await enterInput(await typeInput("#rev-input", "avon"));
    await act(async () => {
      (document.activeElement as HTMLElement)?.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await wait(200);
    const calls = fake.calls.filter((c) => /\/review$/.test(c.path));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ rating: 1 });
  });

  it.each(["listen", "speak"] as const)("%s reveal keeps the sentence without a fabricated answer", async (mode) => {
    await mount(card({ mode, kind: mode === "listen" ? "Listen" : "Speak" }), { revealed: true });
    expect(host.textContent).toContain(FR);
    expect(host.textContent).not.toContain("Your answer");
    expect(host.querySelector("#rev-retype")).toBeNull();
  });
});

describe("Task C — Saved as a table", () => {
  it("shows at most 50 tbody rows plus a pager, and a sentence card's Importance cell is —", async () => {
    await act(async () => {
      store.resetDemo();
      store.set((s) => ({ ss: {}, libFilters: { ...s.libFilters, q: "", mastered: "hide" } }));
    });
    // Populate the library from the fake server cards (real due/meaning/savedAt values).
    await act(async () => { await loadLibrary(true); });
    await act(async () => { root.render(<ReviewScreen sub="saved" />); });
    await wait(200);

    const table = host.querySelector("table.saved-table")!;
    expect(table).toBeTruthy();
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(50);
    expect(host.querySelector(".saved-pager")).toBeTruthy();
    expect(host.querySelector(".saved-pager")?.textContent).toContain("Page 1 of");
    expect(host.querySelector(".saved-pager")?.textContent).toMatch(/Rows 1–50 of \d+/);

    // Whole-sentence cards (no word) have no importance: the cell is a dash, not stars.
    const sentenceRow = rows.find((r) => r.querySelector(".saved-sentence"));
    expect(sentenceRow).toBeTruthy();
    expect(sentenceRow!.querySelector('[data-col="imp"]')?.textContent?.trim()).toBe("—");

    // Due and Saved stay compact and on one line (no "in a minute" / "9 Nov 2026" wrapping).
    const cells = rows[0].querySelectorAll("td");
    const dueCell = cells[4];  // French, Type, Meaning, Status, Due, Importance, Saved, Actions
    const savedCell = cells[6];
    expect(dueCell.textContent).toMatch(/^(now|overdue \d+ d|\d+ min|\d+ h|\d+ d|—)$/);
    expect(savedCell.textContent!.length).toBeLessThan(12);
    expect(table.textContent).not.toContain("in a minute");
  });
});
