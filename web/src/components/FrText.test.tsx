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

describe("elided sentence units", () => {
  for (const apostrophe of ["'", "’"]) for (const form of ["l'homme", "l'oubli", "j'ai", "n'ai", "qu'il"]) {
    const surface = form.replace("'", apostrophe);
    it(`keeps ${surface} whole across raw, analysis and flagged prefix boundaries`, () => {
      expect(tokenizeFrench(surface)).toEqual([{ t: surface, w: true }]);
      const [prefix, rest] = surface.split(apostrophe);
      for (const flagged of [true, false]) {
        const { segs, full, posOf } = build([{ t: "Voici " }, { t: prefix + apostrophe, w: flagged, wi: flagged ? 0 : undefined }, { t: rest, w: true, wi: 1, mark: true }, { t: "." }]);
        const token = segs.find(s => s.wi === 1)!;
        expect(token).toMatchObject({ t: surface, w: true, mark: true });
        expect(segs.filter(s => s.w).map(s => s.t)).toEqual(["Voici", surface]);
        expect(selectionText(full, {pos: posOf[segs.indexOf(token)], text: token.t}, {pos: posOf[segs.indexOf(token)], text: token.t})).toBe(surface);
      }
    });
  }
});

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

  it("keeps flags and offsets when every supplied segment is a plain gap", () => {
    const { segs, full, posOf } = build([
      { t: "Bonjour ", added: true, mark: true },
      { t: "madame", mark: true },
    ]);
    expect(segs.filter((s) => s.w)).toEqual([
      { t: "Bonjour", w: true, added: true, mark: true },
      { t: "madame", w: true, added: undefined, mark: true },
    ]);
    expect(full).toBe("Bonjour madame");
    segs.forEach((s, i) => expect(full.slice(posOf[i], posOf[i] + s.t.length)).toBe(s.t));
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

  it("snaps a native selection of only homme to the full analysis-split l’homme", async () => {
    const picked = vi.fn();
    vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await act(async () => root.render(<FrText segments={[{t:"Voici l’"},{t:"homme",w:true,wi:0}]} onPick={picked} />));
    const token = host.querySelector<HTMLElement>('[data-wi="0"]')!;
    expect(token.textContent).toBe("l’homme");
    await act(async () => {
      token.dispatchEvent(new MouseEvent("pointerdown", {bubbles:true,clientX:0}));
      const range = document.createRange();
      range.setStart(token.firstChild!, 2);
      range.setEnd(token.firstChild!, 7);
      window.getSelection()!.addRange(range);
      token.dispatchEvent(new MouseEvent("pointerup", {bubbles:true,clientX:40}));
    });
    expect(picked.mock.calls[0][0].text).toBe("l’homme");
    expect(window.getSelection()?.toString()).toBe("l’homme");
  });

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

  it.each([false, true])("keeps all dragged lines on an outside release (reverse=%s)", async (reverse) => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await render({ text: FR });
    const words = Array.from(host.querySelectorAll<HTMLElement>(".fr-word"));
    words.forEach((word, i) => {
      vi.spyOn(word, "getBoundingClientRect").mockReturnValue(new DOMRect(0, Math.floor(i / 2) * 40, 80, 30));
    });
    const outside = document.createElement("div");
    outside.textContent = "Outside text";
    if (reverse) host.prepend(outside); else host.append(outside);
    const start = reverse ? words.at(-1)! : words[0];
    const end = reverse ? words[0] : words.at(-1)!;
    await act(async () => {
      start.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      end.dispatchEvent(new Event("pointermove", { bubbles: true }));
      const range = document.createRange();
      range.setStart(reverse ? outside.firstChild! : words[0].firstChild!, 0);
      const last = reverse ? words.at(-1)!.firstChild! : outside.firstChild!;
      range.setEnd(last, last.textContent!.length);
      window.getSelection()!.addRange(range);
      outside.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(FR.slice(0, FR.indexOf(" ?")));
  });

  it("a click on a word inside a kept selection speaks that word, not the old phrase", async () => {
    const spy = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    await render({ text: FR });
    const words = Array.from(host.querySelectorAll<HTMLElement>(".fr-word"));
    // Drag over the first three words.
    await act(async () => {
      words[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 10 }));
      const range = document.createRange();
      range.setStart(words[0].firstChild!, 0);
      range.setEnd(words[2].firstChild!, words[2].textContent!.length);
      window.getSelection()!.addRange(range);
      words[2].dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 10 }));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const phrase = spy.mock.calls[0][0];
    expect(phrase).toContain(words[2].textContent!);
    // Click the second word while the old selection is still there (Chrome keeps it until after the click).
    await act(async () => {
      words[1].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 90, clientY: 10 }));
      words[1].dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 90, clientY: 10 }));
      words[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 90, clientY: 10 }));
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(words[1].textContent);
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });
  it("always emits repeated word clicks, including multi-click counts and stale phrase selection", async () => {
    const picks = vi.fn();
    await act(async () => root.render(<FrText text="Ma machine à laver fuit." onPick={picks} />));
    const words = [...host.querySelectorAll<HTMLElement>(".fr-word")];
    const range = document.createRange();
    range.setStart(words[0].firstChild!, 0); range.setEnd(words[1].firstChild!, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    // A programmatic/accessibility click has no pointer sequence. Old selection is irrelevant.
    for (const [index, detail] of [[3, 1], [3, 2], [3, 3], [1, 1], [2, 1], [4, 1]]) {
      await act(async () => words[index].dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
    }
    expect(picks.mock.calls.map(([p]) => p.text)).toEqual(["laver", "laver", "laver", "machine", "à", "fuit"]);
    expect(new Set(picks.mock.calls.map(([p]) => p)).size).toBe(6);
  });
  it("tells which text a word was picked in, so a build-up step is explained in that step", async () => {
    const picks = vi.fn();
    await act(async () => root.render(<FrText text="La loi a le droit." onPick={picks} />));
    const a = [...host.querySelectorAll<HTMLElement>(".fr-word")].find(el => el.textContent === "a")!;
    await act(async () => a.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(picks.mock.calls.at(-1)?.[0]).toMatchObject({ text: "a", occurrence: 0, context: "La loi a le droit." });
  });

});
