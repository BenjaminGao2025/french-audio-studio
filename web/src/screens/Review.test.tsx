// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCard } from "../data/fixtures";
import { ReviewScreen } from "../screens/Review";
import { loadLibrary, resetReviewCache } from "../api/review";
import { fake, installFakeBackend } from "../test/fakeBackend";
import * as store from "../state/store";

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
  });
});
