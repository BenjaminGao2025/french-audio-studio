import { describe, expect, it, afterEach, vi } from "vitest";
import {
  BAR_MARGIN,
  DRAG_SLOP,
  MEANING_MAX_CHARS,
  canShowMeaning,
  endedDrag,
  hasSelectedText,
  isOffScreen,
  placeBar,
  snapOffsets,
  snapRangeToWords,
  trackGestures,
  unionRect,
  wordsText,
  type Rect,
  type Size,
} from "@/lib/read-selection";

const box = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

describe("snapOffsets", () => {
  it("widens a start or an end that falls inside a word", () => {
    expect(snapOffsets("deux enfants", 2, 8)).toEqual([0, 12]);
    expect(snapOffsets("deux enfants", 5, 8)).toEqual([5, 12]);
    expect(snapOffsets("deux enfants", 0, 6)).toEqual([0, 12]);
  });

  it("keeps a boundary that already sits between two words", () => {
    expect(snapOffsets("deux enfants", 5, 5)).toBeNull();
    expect(snapOffsets("deux enfants", 0, 5)).toEqual([0, 4]);
  });

  it("trims spaces and punctuation off both ends, keeping a trailing apostrophe", () => {
    expect(snapOffsets("deux enfants, et", 0, 13)).toEqual([0, 12]);
    expect(snapOffsets("  ma femme. ", 0, 13)).toEqual([2, 10]);
    expect(snapOffsets("qu' il", 0, 3)).toEqual([0, 3]);
    expect(snapOffsets("3,5 km", 0, 6)).toEqual([0, 6]);
  });

  it("returns null when no word is left", () => {
    expect(snapOffsets("   ", 0, 3)).toBeNull();
    expect(snapOffsets(" , . : ", 0, 7)).toBeNull();
    expect(snapOffsets("deux", 4, 0)).toBeNull();
  });
});

describe("wordsText", () => {
  it("reads a run of words as it is spoken: whitespace collapsed, no edge punctuation", () => {
    expect(wordsText("deux enfants, ")).toBe("deux enfants");
    expect(wordsText("  ma   femme. ")).toBe("ma femme");
    expect(wordsText("j'ai 3,5 kg")).toBe("j'ai 3,5 kg");
    expect(wordsText(" … ")).toBe("");
  });
});

describe("snapRangeToWords", () => {
  const html = (text: string) => {
    const host = document.createElement("p");
    host.lang = "fr";
    // One text node per word, as the FrenchWords component renders them
    text.split(" ").forEach((word, i) => {
      if (i) host.append(document.createTextNode(" "));
      const span = document.createElement("span");
      span.textContent = word;
      host.append(span);
    });
    document.body.append(host);
    return host;
  };
  const select = (host: Element, fromWord: number, toWord: number) => {
    const words = Array.from(host.querySelectorAll("span"));
    const range = document.createRange();
    range.setStartBefore(words[fromWord]!);
    range.setEndAfter(words[toWord]!);
    return range;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes the whole words a range touches", () => {
    const host = html("J'ai déjà deux enfants, et ma femme est enceinte.");
    const snapped = snapRangeToWords(select(host, 2, 3), host);
    expect(snapped?.text).toBe("deux enfants");
    expect(snapped?.range.toString()).toBe("deux enfants");
  });

  it("snaps a range that starts or ends inside a word", () => {
    const host = html("J'ai déjà deux enfants, et ma femme est enceinte.");
    const words = Array.from(host.querySelectorAll("span"));
    const range = document.createRange();
    range.setStart(words[2]!.firstChild!, 1); // inside "deux"
    range.setEnd(words[3]!.firstChild!, 4); // inside "enfants,"
    expect(snapRangeToWords(range, host)?.text).toBe("deux enfants");
  });

  it("cuts a range that runs on past either end of the text", () => {
    const host = html("J'ai déjà deux enfants, et ma femme est enceinte.");
    const words = Array.from(host.querySelectorAll("span"));
    const range = document.createRange();
    range.setStartBefore(words[1]!); // "déjà"
    range.setEndAfter(host.lastChild!); // past the last word
    expect(snapRangeToWords(range, host)?.text).toBe("déjà deux enfants, et ma femme est enceinte");
    const before = document.createRange();
    before.setStartBefore(document.body.firstChild!);
    before.setEndAfter(words[1]!);
    expect(snapRangeToWords(before, host)?.text).toBe("J'ai déjà");
  });

  it("returns null for an empty range or one outside the text", () => {
    const host = html("bonjour");
    const other = document.createElement("p");
    other.textContent = "ailleurs";
    document.body.append(other);
    const range = document.createRange();
    range.selectNodeContents(other);
    expect(snapRangeToWords(range, host)).toBeNull();
    const collapsed = document.createRange();
    collapsed.selectNodeContents(host);
    collapsed.collapse(true);
    expect(snapRangeToWords(collapsed, host)).toBeNull();
  });
});

describe("canShowMeaning", () => {
  it("fits the word card's limit and needs a letter", () => {
    expect(canShowMeaning("ma femme")).toBe(true);
    expect(canShowMeaning("a".repeat(MEANING_MAX_CHARS))).toBe(true);
    expect(canShowMeaning("a".repeat(MEANING_MAX_CHARS + 1))).toBe(false);
    expect(canShowMeaning("3,5")).toBe(false);
    expect(canShowMeaning("")).toBe(false);
  });
});

describe("unionRect", () => {
  it("takes the smallest box around the given ones", () => {
    expect(unionRect([box(10, 20, 30, 40), box(5, 25, 35, 30)])).toEqual(box(5, 20, 35, 40));
    expect(unionRect([box(1, 2, 3, 4)])).toEqual(box(1, 2, 3, 4));
    expect(unionRect([])).toBeNull();
  });
});

describe("placeBar", () => {
  const viewport: Size = { width: 400, height: 800 };
  const bar: Size = { width: 200, height: 44 };

  it("puts a mouse bar above the selection, and a touch bar below it", () => {
    const rect = box(100, 300, 300, 320);
    expect(placeBar(rect, bar, viewport, false).top).toBe(300 - 10 - 44);
    expect(placeBar(rect, bar, viewport, true).top).toBe(320 + 28);
  });

  it("falls back to the other side, then to the bottom of the screen", () => {
    const nearTop = box(100, 20, 300, 40); // no room above
    expect(placeBar(nearTop, bar, viewport, false)).toEqual({ left: 100, top: 50, docked: false });
    const nearBottom = box(100, 700, 300, 780); // no room below (touch)
    const placed = placeBar(nearBottom, bar, viewport, true);
    expect(placed.top).toBe(700 - 10 - 44);
    expect(placed.docked).toBe(false);
    const huge = box(100, 30, 300, 770); // room on neither side
    const docked = placeBar(huge, bar, viewport, false);
    expect(docked.docked).toBe(true);
    expect(docked.top).toBe(800 - 44 - BAR_MARGIN);
  });

  it("stays inside the viewport horizontally", () => {
    const left = placeBar(box(0, 300, 20, 320), bar, viewport, false);
    expect(left.left).toBe(BAR_MARGIN);
    const right = placeBar(box(380, 300, 400, 320), bar, viewport, false);
    expect(right.left).toBe(400 - bar.width - BAR_MARGIN);
  });
});

describe("isOffScreen", () => {
  const viewport: Size = { width: 400, height: 800 };
  it("is true only when the box is entirely outside", () => {
    expect(isOffScreen(box(-50, -50, -10, -10), viewport)).toBe(true);
    expect(isOffScreen(box(410, 810, 450, 850), viewport)).toBe(true);
    expect(isOffScreen(box(-50, 100, 10, 120), viewport)).toBe(false);
    expect(isOffScreen(box(390, 100, 450, 120), viewport)).toBe(false);
    expect(isOffScreen(box(10, 790, 30, 900), viewport)).toBe(false);
  });
});

describe("tap or drag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const gesture = (moves: [number, number][], up: boolean = true) => {
    const fire = (type: string, x: number, y: number) =>
      document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    let last: [number, number] = [0, 0];
    for (const [i, point] of moves.entries()) {
      fire(i === 0 ? "pointerdown" : "pointermove", point[0], point[1]);
      last = point;
    }
    if (up) fire("pointerup", last[0], last[1]);
  };

  it("calls a still pointer a tap and a moved one a drag", () => {
    const stop = trackGestures();
    gesture([
      [100, 100],
      [103, 104],
      [103, 104],
    ]);
    expect(endedDrag()).toBe(false);
    gesture([
      [100, 100],
      [140, 100],
    ]);
    expect(endedDrag()).toBe(true);
    stop();
    // After the last tracker stops, a stale gesture says nothing
    gesture([
      [100, 100],
      [103, 104],
      [103, 104],
    ]);
    expect(endedDrag()).toBe(false);
  });

  it("only treats a recent gesture as the drag behind a click", () => {
    const stop = trackGestures();
    gesture([
      [100, 100],
      [140, 100],
    ]);
    const later = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 5000);
    expect(endedDrag()).toBe(false);
    later.mockRestore();
    stop();
  });

  it("knows when text is selected", () => {
    const host = document.createElement("p");
    host.textContent = "ma femme";
    document.body.append(host);
    expect(hasSelectedText()).toBe(false);
    const range = document.createRange();
    range.selectNodeContents(host);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(hasSelectedText()).toBe(true);
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("shares one set of listeners between texts", () => {
    const first = trackGestures();
    const second = trackGestures();
    gesture([
      [10, 10],
      [60, 10],
    ]);
    expect(endedDrag()).toBe(true);
    first();
    expect(endedDrag()).toBe(true); // still tracked by the second
    second();
    gesture([
      [10, 10],
      [12, 10],
    ]);
    expect(endedDrag()).toBe(false);
  });
});

describe("constants", () => {
  it("matches the legacy page", () => {
    expect(DRAG_SLOP).toBe(8);
    expect(MEANING_MAX_CHARS).toBe(40);
  });
});
