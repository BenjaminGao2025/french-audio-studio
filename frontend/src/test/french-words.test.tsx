import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "@/api";
import { FrenchWords } from "@/components/fr/words";
import { audioController } from "@/lib/audio-controller";
import {
  WORD_TAP_SLOP,
  glossFor,
  nearestElement,
  normalizeLookup,
  tokenizeFrench,
} from "@/lib/french-words";

vi.mock("@/api", () => ({
  api: {
    speech: { ttsUrl: (text: string) => `/tts?text=${encodeURIComponent(text)}` },
    analyze: { lookup: vi.fn() },
  },
}));

// vitest turns CSS imports into empty strings, so read the stylesheet itself
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

// jsdom gives Ranges no geometry; the floating bar only needs a box to sit next to
window.Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;

const SENTENCE = "J'ai déjà deux enfants, et ma femme est enceinte.";
const glosses = [
  { word: "enfants", ipa: "ɑ̃.fɑ̃", pos: "noun", lemma: "enfant", en: "children", zh: "孩子" },
  { word: "enceinte", en: "pregnant", why: "Said of a woman only." },
];

const plays: string[] = [];
const clips: { src: string; paused: boolean }[] = [];
beforeEach(() => {
  plays.length = 0;
  clips.length = 0;
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      onended = null;
      onerror = null;
      paused = false;
      constructor(src: string) {
        this.src = src;
        clips.push(this);
      }
      play() {
        plays.push(this.src);
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
      addEventListener() {}
      dispatchEvent() {
        return true;
      }
    },
  );
  vi.mocked(api.analyze.lookup).mockResolvedValue({ explanation_en: "looked up", phonetic: "x" });
});
afterEach(() => {
  cleanup();
  audioController.stop();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const word = (name: string) => screen.getByRole("button", { name });

describe("tokenizeFrench", () => {
  it("never changes the text", () => {
    const text = "Bonjour, j'ai 3,5 kg… « c'est vrai » ? À 15h30, aujourd'hui.";
    expect(
      tokenizeFrench(text)
        .map((t) => t.text)
        .join(""),
    ).toBe(text);
  });

  it("keeps punctuation stuck to a word inside that word's tap target", () => {
    const tokens = tokenizeFrench(SENTENCE).filter((t) => t.word !== undefined);
    expect(tokens.map((t) => t.word)).toEqual([
      "J'ai",
      "déjà",
      "deux",
      "enfants",
      "et",
      "ma",
      "femme",
      "est",
      "enceinte",
    ]);
    expect(tokens.find((t) => t.word === "enfants")?.text).toBe("enfants,");
    expect(tokens.find((t) => t.word === "enceinte")?.text).toBe("enceinte.");
    expect(tokens.find((t) => t.word === "déjà")?.text).toBe("déjà");
  });

  it("treats numbers, times and aujourd'hui as single words", () => {
    const words = tokenizeFrench("3,5 15h30 1er aujourd’hui d'accord")
      .map((t) => t.word)
      .filter(Boolean);
    expect(words).toEqual(["3,5", "15h30", "1er", "aujourd’hui", "d'accord"]);
  });

  it("handles empty text", () => {
    expect(tokenizeFrench("")).toEqual([]);
  });
});

describe("nearestElement", () => {
  const box = (left: number, top: number, right: number, bottom: number) => {
    const el = document.createElement("span");
    el.getClientRects = () => [{ left, top, right, bottom }] as unknown as DOMRectList;
    return el;
  };
  const deux = box(100, 100, 140, 120);
  const enfants = box(146, 100, 212, 120);
  const et = box(20, 144, 40, 164);
  const all = [deux, enfants, et];

  it("picks the word under the point, then the nearest one", () => {
    expect(nearestElement(all, 120, 110, WORD_TAP_SLOP)).toBe(deux);
    expect(nearestElement(all, 142, 110, WORD_TAP_SLOP)).toBe(deux);
    expect(nearestElement(all, 144, 110, WORD_TAP_SLOP)).toBe(enfants);
    expect(nearestElement(all, 120, 134, WORD_TAP_SLOP)).toBe(deux);
    expect(nearestElement(all, 30, 132, WORD_TAP_SLOP)).toBe(et);
  });

  it("ignores taps far from every word, missing positions and boxless elements", () => {
    expect(nearestElement(all, 300, 110, WORD_TAP_SLOP)).toBeNull();
    expect(nearestElement(all, NaN, NaN, WORD_TAP_SLOP)).toBeNull();
    expect(nearestElement([document.createElement("i")], 10, 10, WORD_TAP_SLOP)).toBeNull();
    expect(nearestElement([], 10, 10, WORD_TAP_SLOP)).toBeNull();
  });
});

describe("glossFor / normalizeLookup", () => {
  it("finds a word by its form, its base form or what follows an elision", () => {
    expect(glossFor("Enfants", glosses)?.en).toBe("children");
    expect(glossFor("enfant", glosses)?.en).toBe("children");
    expect(glossFor("l'enceinte", glosses)?.en).toBe("pregnant");
    expect(glossFor("femme", glosses)).toBeNull();
  });

  it("reads the lookup endpoint's answer and drops empty ones", () => {
    expect(
      normalizeLookup("viens", {
        explanation_en: "come",
        explanation_cn: "来",
        phonetic: "vjɛ̃",
        lemma: "venir",
      }),
    ).toEqual({ word: "viens", en: "come", zh: "来", ipa: "vjɛ̃", lemma: "venir", pos: undefined });
    expect(normalizeLookup("x", { explanation_en: "  " })).toBeNull();
    expect(normalizeLookup("x", null)).toBeNull();
    expect(normalizeLookup("x", "nope")).toBeNull();
  });
});

describe("FrenchWords", () => {
  const mount = (extra: { onWord?: (w: string) => void } = {}) =>
    render(<FrenchWords text={SENTENCE} glosses={glosses} className="fr" {...extra} />);

  it("makes every word a button and keeps the text intact", () => {
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(document.querySelector(".fr-words")?.textContent).toBe(SENTENCE);
    expect(document.querySelector(".fr-words")?.getAttribute("lang")).toBe("fr");
    expect(word("enfants,")).toHaveAttribute("data-fr-word", "enfants");
  });

  it("plays the bare word once through the shared controller and opens its card", async () => {
    const play = vi.spyOn(audioController, "play");
    mount();
    fireEvent.click(word("enfants,"));
    expect(plays).toEqual(["/tts?text=enfants"]);
    expect(play).toHaveBeenCalledTimes(1);
    const card = screen.getByRole("dialog", { name: "Meaning of enfants" });
    expect(card).toHaveTextContent("children");
    expect(card).toHaveTextContent("孩子");
    expect(card).toHaveTextContent("ɑ̃.fɑ̃");
    expect(card).toHaveTextContent("noun · base form: enfant");
    expect(word("enfants,")).toHaveAttribute("aria-expanded", "true");
    expect(api.analyze.lookup).not.toHaveBeenCalled();
    // The Hear button replays it through the same controller
    fireEvent.click(screen.getByRole("button", { name: "Hear enfants" }));
    expect(plays).toEqual(["/tts?text=enfants", "/tts?text=enfants"]);
  });

  it("looks up a word the analysis does not know, and says so when there is no answer", async () => {
    mount();
    fireEvent.click(word("femme"));
    expect(screen.getByRole("status")).toHaveTextContent("Looking up");
    expect(await screen.findByText("looked up")).toBeInTheDocument();
    expect(api.analyze.lookup).toHaveBeenCalledWith("femme");
    vi.mocked(api.analyze.lookup).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(word("déjà"));
    expect(await screen.findByText("No meaning found for this word.")).toBeInTheDocument();
  });

  it("opens the nearest word when the tap lands between words or beside the glyphs", () => {
    const opened = vi.fn();
    mount({ onWord: opened });
    const line = document.querySelector(".fr-words") as HTMLElement;
    const spans = Array.from(line.querySelectorAll<HTMLElement>("[data-fr-word]"));
    spans.forEach((el, i) => {
      el.getClientRects = () =>
        [{ left: i * 50, top: 0, right: i * 50 + 44, bottom: 20 }] as unknown as DOMRectList;
    });
    // In the 6px gap after "J'ai" (x 44..50), a little below the glyphs
    fireEvent.click(line, { clientX: 46, clientY: 32, detail: 1 });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of J'ai");
    expect(opened).toHaveBeenCalledWith("J'ai");
    // Closer to the next word
    fireEvent.click(line, { clientX: 49, clientY: 10, detail: 1 });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of déjà");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // Far from every word, with no position, or after selecting text: not a tap
    fireEvent.click(line, { clientX: 900, clientY: 10, detail: 1 });
    fireEvent.click(line, { clientX: 49, clientY: 10, detail: 0 });
    const selected = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "ma femme",
    } as unknown as Selection);
    fireEvent.click(line, { clientX: 99, clientY: 10, detail: 1 });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of déjà");
    expect(plays).toEqual(["/tts?text=J'ai", "/tts?text=d%C3%A9j%C3%A0"]);
    selected.mockRestore();
  });

  it("works from the keyboard, and Escape, the close button or another press dismiss the card", () => {
    mount();
    fireEvent.keyDown(word("enceinte."), { key: "Enter" });
    expect(screen.getByRole("dialog")).toHaveTextContent("Said of a woman only.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(word("enfants,"), { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(word("ma"), { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(word("ma"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A press on the word that is open (or on the card) keeps it open
    fireEvent.click(word("ma"));
    fireEvent.pointerDown(word("ma"));
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the card clear of the whole text, on the side nearer the word", () => {
    mount();
    const host = document.querySelector(".fr-words")!.parentElement as HTMLElement;
    host.getBoundingClientRect = () =>
      ({ top: 400, bottom: 520, left: 0, right: 300, height: 120, width: 300 }) as DOMRect;
    const place = (name: string, top: number) => {
      word(name).getBoundingClientRect = () =>
        ({ top, bottom: top + 20, left: 50, right: 90, width: 40, height: 20 }) as DOMRect;
      fireEvent.click(word(name));
      return screen.getByRole("dialog").style;
    };
    // A word on the first line: the card goes above the text, not just above the word
    let style = place("J'ai", 410);
    expect(style.bottom).toBe("128px");
    expect(style.top).toBe("");
    // A word on the last line: below the text
    style = place("enceinte.", 490);
    expect(style.top).toBe("128px");
    expect(style.bottom).toBe("");
    // No room above: below, whichever word it is
    host.getBoundingClientRect = () =>
      ({ top: 100, bottom: 220, left: 0, right: 300, height: 120, width: 300 }) as DOMRect;
    style = place("déjà", 110);
    expect(style.top).toBe("128px");
  });

  it("keeps a single card open across several texts and stops the old audio", () => {
    render(
      <>
        <FrenchWords text="Bonjour tout le monde" />
        <FrenchWords text="Merci beaucoup" />
      </>,
    );
    fireEvent.click(word("Bonjour"));
    fireEvent.click(word("Merci"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of Merci");
  });

  it("reports an audio failure without closing the card", async () => {
    vi.spyOn(audioController, "play").mockRejectedValueOnce(new Error("blocked"));
    mount();
    fireEvent.click(word("enfants,"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Audio unavailable");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hear enfants" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not play when the word cannot be spoken", () => {
    const original = api.speech.ttsUrl;
    api.speech.ttsUrl = () => null;
    mount();
    fireEvent.click(word("enfants,"));
    expect(plays).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    api.speech.ttsUrl = original;
  });
});

describe("FrenchWords selection", () => {
  const mountPlain = () => render(<FrenchWords text={SENTENCE} glosses={glosses} className="fr" />);
  const mountControls = () =>
    render(<FrenchWords text={SENTENCE} glosses={glosses} className="fr" sentenceControls />);
  const bar = () => screen.getByRole("toolbar", { name: "Selection actions" });
  const readButton = () => screen.getByRole("button", { name: "Read selection" });

  // A mouse drag: press on one word, move to another, release
  const drag = (from: HTMLElement, to: HTMLElement) => {
    fireEvent.mouseDown(from, { clientX: 100, clientY: 10, button: 0 });
    fireEvent.mouseMove(to, { clientX: 200, clientY: 10 });
    fireEvent.mouseUp(document);
  };

  it("reads exactly the dragged words through the shared controller, and opens no card", () => {
    mountPlain();
    drag(word("deux"), word("enfants,"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bar()).toBeInTheDocument();
    fireEvent.click(readButton());
    expect(plays).toEqual(["/tts?text=deux%20enfants"]);
    // The click that ends a drag is not a tap on the word it lands on
    fireEvent.click(word("enfants,"), { clientX: 200, clientY: 10 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Meaning for a short selection, which opens the phrase card", async () => {
    mountPlain();
    drag(word("ma"), word("femme"));
    fireEvent.click(screen.getByRole("button", { name: "Meaning" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of ma femme");
    expect(await screen.findByText("looked up")).toBeInTheDocument();
  });

  it("shows the bar for a selection made by the system (a long press with handles)", async () => {
    mountPlain();
    const ma = word("ma");
    const femme = word("femme");
    const range = document.createRange();
    range.setStartBefore(ma);
    range.setEndAfter(femme);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
    fireEvent.click(readButton());
    expect(plays).toEqual(["/tts?text=ma%20femme"]);
  });

  it("keeps a single selected word out of the card but offers to read it", async () => {
    mountPlain();
    const femme = word("femme");
    const range = document.createRange();
    range.selectNodeContents(femme.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    expect(await screen.findByRole("toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(readButton());
    expect(plays).toEqual(["/tts?text=femme"]);
  });

  it("picks a span word by word in range mode and reads it", () => {
    mountControls();
    fireEvent.click(screen.getByRole("button", { name: "Select words" }));
    expect(screen.getByRole("status")).toHaveTextContent("Tap the first word");
    fireEvent.click(word("deux"));
    expect(screen.getByRole("status")).toHaveTextContent("Tap the last word");
    fireEvent.click(word("enfants,"));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(readButton());
    expect(plays).toEqual(["/tts?text=deux%20enfants"]);
    // Clear drops the span, and the switch leaves range mode
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select words" }));
    expect(screen.queryByRole("status")).toBeNull();
    // A tap on a word opens it again once range mode is off
    fireEvent.click(word("femme"));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Meaning of femme");
  });

  it("reads the whole sentence from the per-sentence button", () => {
    mountControls();
    const button = screen.getByRole("button", { name: "Read sentence" });
    expect(button.className).toMatch(/min-h-11/);
    fireEvent.click(button);
    expect(plays).toEqual([`/tts?text=${encodeURIComponent(SENTENCE)}`]);
  });

  it("reads through the shared controller, which stops the audio already playing", () => {
    mountPlain();
    // A word is playing…
    fireEvent.click(word("femme"));
    expect(plays).toEqual(["/tts?text=femme"]);
    const playing = clips[clips.length - 1]!;
    // …and reading the selection takes the player over from it
    drag(word("deux"), word("enfants,"));
    fireEvent.click(readButton());
    expect(plays).toEqual(["/tts?text=femme", "/tts?text=deux%20enfants"]);
    expect(playing.paused).toBe(true);
  });
});

describe("read-selection CSS", () => {
  const rule = (selector: string) => {
    const start = styles.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return styles.slice(start, styles.indexOf("}", start));
  };

  it("floats the bar near the selection with 44px buttons on touch screens", () => {
    expect(rule(".fr-read-bar")).toMatch(/position: fixed;/);
    expect(rule(".fr-read-bar")).toMatch(/z-index: 60;/);
    expect(rule(".fr-read-bar")).toMatch(/user-select: none;/);
    expect(rule(".fr-read-btn")).toMatch(/min-height: 36px;/);
    expect(styles).toMatch(
      /@media \(pointer: coarse\) \{\s*\.fr-read-btn \{\s*min-height: 44px;\s*min-width: 44px;/,
    );
    expect(rule(".fr-read-btn-main")).toMatch(/background-color: var\(--primary\);/);
  });

  it("paints the picked span at the height of the glyphs and stops selection in range mode", () => {
    expect(rule(".fr-word.fr-word-range")).toMatch(/background-color: color-mix/);
    expect(rule(".fr-words.is-range-mode,\n.fr-words.is-range-mode .fr-word")).toMatch(
      /user-select: none;/,
    );
  });
});

describe("hit-target CSS", () => {
  const rule = (selector: string) => {
    const start = styles.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return styles.slice(start, styles.indexOf("}", start));
  };

  it("gives every word an invisible hit area that is 44px tall on touch screens", () => {
    expect(rule(".fr-word")).toMatch(/position: relative;/);
    expect(rule(".fr-word")).toMatch(/touch-action: manipulation;/);
    expect(rule(".fr-word")).toMatch(/-webkit-tap-highlight-color: color-mix/);
    const hit = rule(".fr-word::after");
    expect(hit).toMatch(/position: absolute;/);
    expect(hit).toMatch(/height: max\(100%, var\(--word-tap-height, 0px\)\);/);
    expect(hit).toMatch(/left: -0\.15em;\s*right: -0\.15em;/);
    expect(hit).not.toMatch(/pointer-events: none/);
    // Behind the word's own text, so a drag that starts on the word selects from inside it
    // (an overlay on top would move the selection anchor to the end of the word)
    expect(hit).toMatch(/z-index: -1;/);
    expect(rule(".fr-word")).toMatch(/isolation: isolate;/);
    expect(styles).toMatch(
      /@media \(pointer: coarse\) \{\s*\.fr-words \{\s*--word-tap-height: 44px;\s*line-height: var\(--word-tap-height\);/,
    );
  });

  it("highlights on hover only where a pointer hovers, and keeps words selectable on touch", () => {
    expect(styles).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.fr-word:hover \{/);
    // A long press selects with the system handles; only range mode switches selection off
    expect(styles).toMatch(
      /@media \(pointer: coarse\) \{\s*\.fr-word \{\s*-webkit-user-select: text;\s*user-select: text;\s*-webkit-touch-callout: default;/,
    );
    expect(styles).not.toMatch(
      /@media \(pointer: coarse\) \{\s*\.fr-word \{\s*-webkit-user-select: none;/,
    );
    expect(rule('.fr-word:active,\n.fr-word[aria-expanded="true"]')).toMatch(/background-color/);
  });
});
