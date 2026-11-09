// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { build, findWordSpans, selectionText, tokenizeFrench, FrText, type FrSegment } from "./FrText";
import * as store from "../state/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FR = "Bonjour madame, est-ce que vous avez réservé une table pour ce soir ?";

/** An analysis that listed only 3 words, leaving the rest as plain gaps. */
const ANALYSIS_SEGMENTS: FrSegment[] = [
  { t: "Bonjour", w: true, wi: 0 },
  { t: " " },
  { t: "madame", w: true, wi: 1 },
  { t: ", " },
  { t: "est-ce que", w: true, wi: 2 },
  { t: " vous avez réservé une table pour ce soir ?" },
];

describe("build() — every word of the sentence stays tappable", () => {
  it("splits gaps the analysis did not list into words", () => {
    const { segs, full, posOf } = build(ANALYSIS_SEGMENTS);
    const words = segs.filter((s) => s.w).map((s) => s.t);
    // The sentence tokenises to 12 words; the 3 analysis words stay whole ("est-ce que"), so the
    // remaining 8 gap words join them → 11 word spans. Previously only 3 were tappable.
    expect(full).toBe(FR);
    expect(words).toEqual([
      "Bonjour", "madame", "est-ce que", "vous", "avez", "réservé", "une", "table", "pour", "ce", "soir",
    ]);
    // Words the analysis never listed are now tappable.
    for (const w of ["vous", "avez", "réservé", "une", "table", "pour", "ce", "soir"]) {
      expect(words).toContain(w);
    }
    // posOf stays exact for every piece.
    segs.forEach((s, i) => expect(full.slice(posOf[i], posOf[i] + s.t.length)).toBe(s.t));
    // wi stays only on the analysis words.
    expect(segs.filter((s) => s.wi !== undefined).map((s) => s.wi)).toEqual([0, 1, 2]);
  });

  it("with no analysis words at all, every word of the raw sentence is a word span", () => {
    const { segs, full } = build(undefined, FR);
    const words = segs.filter((s) => s.w).map((s) => s.t);
    expect(full).toBe(FR);
    expect(words).toEqual(tokenizeFrench(FR).filter((s) => s.w).map((s) => s.t));
    expect(words).toHaveLength(12);
  });

  it("carries added/mark flags onto pieces derived from a flagged gap", () => {
    const segs: FrSegment[] = [
      { t: "Bonjour ", added: true, mark: true },
      { t: "madame", w: true, wi: 0 },
      { t: " lecon", added: true },
    ];
    const built = build(segs);
    const bonjour = built.segs.find((s) => s.t === "Bonjour")!;
    expect(bonjour.added).toBe(true);
    expect(bonjour.mark).toBe(true);
    const lecon = built.segs.find((s) => s.t === "lecon")!;
    expect(lecon.added).toBe(true);
    expect(lecon.wi).toBeUndefined();
  });
});

describe("selectionText — keeps the sentence's punctuation", () => {
  it("returns the exact substring, including the comma", () => {
    expect(selectionText(FR, { pos: 8, text: "madame" }, { pos: 16, text: "est-ce que" })).toBe("madame, est-ce que");
    expect(selectionText(FR, { pos: 0, text: "Bonjour" }, { pos: 8, text: "madame" })).toBe("Bonjour madame");
  });
});

describe("findWordSpans — French word boundaries", () => {
  it("does not match a short word inside a longer one", () => {
    expect(findWordSpans("Le lecon le", "Le")).toEqual([[0, 2], [9, 11]]);
  });

  it("matches accented letters and œ, and counts only whole-word occurrences", () => {
    expect(findWordSpans("Le cœur, le café, encore le.", "le")).toEqual([[0, 2], [9, 11], [25, 27]]);
  });
});

describe("FrText — keyboard access and native selection", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
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

  const render = async (props: { segments?: FrSegment[]; text?: string }) => {
    await act(async () => root.render(<FrText {...props} onPick={() => {}} />));
  };

  it("word spans are not focusable buttons and the root is the single tab stop", async () => {
    await render({ segments: ANALYSIS_SEGMENTS });
    const spans = Array.from(host.querySelectorAll<HTMLElement>(".fr-word"));
    expect(spans.length).toBeGreaterThan(0);
    for (const sp of spans) {
      expect(sp.getAttribute("tabindex")).toBeNull();
      expect(sp.getAttribute("role")).toBeNull();
    }
    const rootEl = host.querySelector<HTMLElement>("p.fr-text")!;
    expect(rootEl.getAttribute("tabindex")).toBe("0");
    expect(rootEl.getAttribute("aria-label")).toContain("arrow keys");
  });

  it("ArrowRight moves the active word and Enter speaks it", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await render({ segments: ANALYSIS_SEGMENTS });
    const rootEl = host.querySelector<HTMLElement>("p.fr-text")!;
    const words = Array.from(host.querySelectorAll<HTMLElement>(".fr-word")).map((w) => w.dataset.word!);
    const key = (k: string) => rootEl.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await act(async () => key("ArrowRight"));
    await act(async () => key("ArrowRight"));
    // From an unfocused root (active starts at -1) two rights land on the second word.
    expect(host.querySelector(".fr-word.is-active")?.getAttribute("data-word")).toBe(words[1]);
    await act(async () => key("Enter"));
    expect(spy).toHaveBeenCalledWith(words[1]);
  });
});
