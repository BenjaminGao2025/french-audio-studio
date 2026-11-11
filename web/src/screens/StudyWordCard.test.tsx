// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudySentence } from "../data/fixtures";
import { StudyLearn } from "../screens/StudyLearn";
import { WordPanel } from "./WordPopup";
import { fake, installFakeBackend } from "../test/fakeBackend";
import { resetLookupCaches, type DictionaryEntry } from "../api/lookup";
import * as lookupApi from "../api/lookup";
import { get, resetDemo, set, updatePlayer } from "../state/store";
import * as store from "../state/store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FR = "Bonjour madame, est-ce que vous avez réservé une table pour ce soir ?";
const STEP0 = "Bonjour";
const STEP1 = "Bonjour madame";

/** One analysed sentence whose "est-ce que" chunk stays a single selectable span. */
const SENTENCE: StudySentence = {
  id: "s-wordcard",
  fr: FR,
  en: "Hello madam, did you reserve a table for this evening?",
  segments: [
    { t: "Bonjour " },
    { t: "madame", w: true },
    { t: ", " },
    { t: "est-ce que", w: true },
    { t: " vous avez réservé une table pour ce soir ?" },
  ],
  steps: [
    { parts: [{ t: STEP0 }], en: "Hello", addedLabel: "Starting phrase", how: "" },
    { parts: [{ t: "Bonjour " }, { t: "madame", added: true }], en: "Hello madam", addedLabel: "madame", how: "" },
    { parts: [{ t: FR }], en: FR, addedLabel: "the question", how: "" },
  ],
  grammar: null,
  cards: [],
  raw: {
    sentence: FR,
    translation_en: "Hello madam, did you reserve a table for this evening?",
    translation_zh: "你好女士，您为今晚预订了桌子吗？",
    build_up: [],
    words: [],
    grammar_points: [],
  },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const findButton = (text: string): HTMLButtonElement => {
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`No button with "${text}"`);
  return b;
};
const headerWord = (word: string): HTMLElement => {
  const w = Array.from(host.querySelectorAll<HTMLElement>(".sentence-fr .fr-word")).find((x) => x.dataset.word === word);
  if (!w) throw new Error(`No header word "${word}"`);
  return w;
};

beforeAll(() => {
  installFakeBackend();
  document.body.innerHTML = '<div id="app-root"></div>';
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(async () => {
  fake.reset();
  resetLookupCaches();
  window.getSelection()?.removeAllRanges();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    resetDemo();
    set((s) => ({ study: { ...s.study, sentences: [SENTENCE], index: 0, tab: "steps" } }));
    root.render(<StudyLearn />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Task B — Study word card, selection and steps", () => {
  it("shows the English meaning and the dictionary, and keeps usage notes collapsed", async () => {
    const sentence: StudySentence = {
      ...SENTENCE,
      raw: { ...SENTENCE.raw!, words: [{ fr: "madame", ipa: "madam", lemma: "madame", type: "noun", meaning: "madam; a polite address", meaning_zh: "女士", why: "A polite way to address a woman.", english_link: "madam", false_friend: false }] },
    };
    await act(async () => root.render(<WordPanel sentence={sentence} text="madame" wordIndex={0} onGrammar={() => {}} onClose={() => {}} />));
    await wait(150);
    const panel = host.querySelector(".word-card")!;
    expect(panel.querySelector(".wp-definition")?.textContent).toBe("madam; a polite address");
    expect(panel.textContent).toContain("[madam]");
    expect(panel.textContent).not.toContain("Example sentence");
    expect(panel.textContent).not.toMatch(/\p{Script=Han}/u);
    expect(panel.textContent).toContain("Définition de madame.");
    expect(panel.textContent).not.toContain("A polite way to address a woman.");
    await act(async () => findButton("Usage notes").click());
    expect(panel.textContent).toContain("A polite way to address a woman.");
    expect(panel.textContent).not.toMatch(/\p{Script=Han}/u);
  });

  it("renders English before French with a related label and short source attribution", async () => {
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({
      token: "recorrection", lemma: "correction", pos: "noun", phonetic: "", explanation_cn: "", explanation_en: "",
      match_type: "related", related: "correction", dictionary_state: "found", dictionary_source: "wiktionnaire",
      entries: [
        { lemma: "correction", pos: "noun", phonetic: "", language: "en", senses: ["correction (all senses)"], source_url: "https://en.wiktionary.org/wiki/correction#French", history_url: "" },
        { lemma: "correction", pos: "noun", phonetic: "", language: "fr", senses: ["Action de corriger."], source_url: "https://fr.wiktionary.org/wiki/correction#fr", history_url: "" },
      ], attribution: "Wiktionnaire contributors; extraction by Kaikki.", changes: "Bounded selected source senses.",
    });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="recorrection" onGrammar={() => {}} onClose={() => {}} />));
    const section = host.querySelector('[aria-label="Dictionary"]')!;
    expect(section.textContent).toContain("Related: correction");
    expect(Array.from(section.querySelectorAll(".wp-senses")).map((el) => [el.getAttribute("lang"), el.textContent])).toEqual([
      ["en", "correction (all senses)"], ["fr", "Action de corriger."],
    ]);
    const attribution = section.querySelector(".wp-attribution")!;
    expect(attribution.textContent).toBe("Source: Wiktionary (CC BY-SA)");
    expect(attribution.getAttribute("title")).toContain("Wiktionnaire contributors");
    expect(attribution.querySelector("a")?.href).toBe("https://en.wiktionary.org/wiki/correction#French");
    expect(section.textContent).not.toContain("No dictionary entry");
  });

  it("renders per-word phrase hits, related labels and only the missing component's muted miss", async () => {
    const component = (token: string, lemma: string, senses: string[]): DictionaryEntry => ({
      token, lemma, pos: "noun", phonetic: "", explanation_cn: "", explanation_en: "",
      entries: senses.length ? [{ lemma, pos: "noun", phonetic: "", language: "en", senses, source_url: `https://en.wiktionary.org/wiki/${lemma}#French`, history_url: "" }] : [],
    });
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({
      ...component("objectifs différents unknownzzz", "objectifs différents unknownzzz", []),
      match_type: "components",
      components: [component("objectifs", "objectif", ["objective, goal, aim"]),
        { ...component("différents", "différent", ["different"]), match_type: "related", related: "différent" },
        component("unknownzzz", "unknownzzz", [])],
    });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="objectifs différents unknownzzz" onGrammar={() => {}} onClose={() => {}} />));
    const section = host.querySelector('[aria-label="Dictionary"]')!;
    expect(section.textContent).toContain("objectifs");
    expect(section.textContent).toContain("objective, goal, aim");
    expect(section.textContent).toContain("Related: différent");
    expect(section.textContent).toContain("different");
    expect(section.textContent).toContain("“unknownzzz” is not in the dictionary.");
    expect(section.textContent?.match(/is not in the dictionary/g)).toHaveLength(1);
    expect(section.textContent).not.toContain("No dictionary entry");
  });

  it("renders a muted explicit true miss", async () => {
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({
      token: "unknownzzz", lemma: "unknownzzz", pos: "", phonetic: "", explanation_cn: "", explanation_en: "",
      dictionary_state: "not_found", entries: [],
    });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="unknownzzz" onGrammar={() => {}} onClose={() => {}} />));
    const section = host.querySelector('[aria-label="Dictionary"]')!;
    expect(section.querySelector("p.text-muted-foreground")?.textContent).toBe("“unknownzzz” is not in the dictionary.");
  });

  it("clicking a word calls sayFrench(word) and opens the word card", async () => {
    const spy = vi.spyOn(store, "sayFrench");
    await act(async () => {
      headerWord("madame").click();
    });
    expect(spy).toHaveBeenCalledWith("madame");
    expect(document.querySelector(".word-card")).toBeTruthy();
    expect(document.querySelector(".wp-headword")?.textContent).toBe("madame");
  });

  it("a Range across madame…que + pointerup says the phrase and asks word-context with the right occurrence", async () => {
    const spy = vi.spyOn(store, "sayFrench");
    const header = host.querySelector<HTMLElement>(".sentence-fr")!;
    const start = headerWord("madame");
    const end = headerWord("est-ce que");
    const range = document.createRange();
    range.setStart(start.firstChild!, 0);
    range.setEnd(end.firstChild!, (end.firstChild!.textContent ?? "").length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    await act(async () => {
      header.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await wait(150);
    expect(spy).toHaveBeenCalledWith("madame, est-ce que");
    expect(document.querySelector(".wp-headword")?.textContent).toBe("madame, est-ce que");
    const wc = fake.calls.filter((c) => c.path === "/api/word-context");
    expect(wc).toHaveLength(1);
    expect(wc[0].body).toMatchObject({ word: "madame, est-ce que", occurrence: 0, sentence: FR });
  });

  it("regression: after step 1 has ended, playing step 2 starts playback with step 2's text", async () => {
    await act(async () => {
      findButton("Play step 1").click();
    });
    expect(get().player!.texts).toEqual([STEP0]);
    await act(async () => {
      updatePlayer({ status: "ended" });
    });
    expect(get().player!.status).toBe("ended");
    await act(async () => {
      findButton("Play step 2").click();
    });
    expect(get().player!.texts).toEqual([STEP1]);
  });

  it("no Playback scope control or 'Current step' concept is rendered", () => {
    const text = host.textContent ?? "";
    expect(text).not.toContain("Playback scope");
    expect(text).not.toContain("Current step");
    expect(document.querySelector('[aria-label="Playback scope"]')).toBeNull();
    expect(findButton("Play all sentences")).toBeTruthy();
    expect(findButton("Play all steps")).toBeTruthy();
    expect(findButton("Play step 2")).toBeTruthy();
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Practise step"))).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Previous step" || b.textContent === "Next step")).toBe(false);
  });

  it("dictionary errors retry the real source and never request generated roots", async () => {
    fake.failNext.add("dictionary");
    await act(async () => headerWord("madame").click());
    await wait(150);
    expect(document.querySelector(".word-card")?.textContent).toContain("Dictionary request failed");
    await act(async () => findButton("Retry").click());
    await wait(150);
    const panel = document.querySelector(".word-card")!;
    expect(panel.textContent).toContain("Définition de madame.");
    expect(panel.querySelector('a[href="https://fr.wiktionary.org/wiki/madame#fr"]')).toBeTruthy();
    expect(panel.textContent).toContain("Source: Wiktionary (CC BY-SA)");
    expect(panel.textContent).not.toMatch(/\p{Script=Han}/u);
    expect(fake.calls.filter((call) => call.path === "/api/etymology")).toHaveLength(0);
    expect(panel.textContent).not.toContain("Roots & origin");
  });
});
