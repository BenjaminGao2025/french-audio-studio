// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudySentence } from "../data/fixtures";
import { StudyLearn } from "../screens/StudyLearn";
import { WordsPanel } from "./StudyTools";
import { WordPanel } from "./WordPopup";
import { fake, installFakeBackend } from "../test/fakeBackend";
import { resetLookupCaches, type DictionaryEntry } from "../api/lookup";
import { resetReviewCache } from "../api/review";
import { resetSavedCards, useSavedCards, cardKey } from "../api/srs";
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
  const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((x) => x.textContent?.includes(text) || x.getAttribute("aria-label") === text);
  if (!b) throw new Error(`No button with "${text}"`);
  return b;
};
/** Opens the sentence header's More menu and returns its items. */
const openMore = async (): Promise<HTMLElement[]> => {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="More sentence actions"]');
  if (!trigger) throw new Error("No More sentence actions button");
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
};
const menuItem = (items: HTMLElement[], text: string): HTMLElement => {
  const item = items.find((x) => x.textContent?.trim() === text);
  if (!item) throw new Error(`No menu item "${text}"`);
  return item;
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
  localStorage.removeItem("explanationLanguage");
  fake.reset();
  resetReviewCache();
  resetSavedCards();
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
  it("shows Simple English by default in Settings and persists the Chinese selection", async () => {
    const { SettingsScreen } = await import("./Settings");
    await act(async () => root.render(<SettingsScreen />));
    const control = host.querySelector<HTMLButtonElement>('[aria-label="Explanation language"]')!;
    expect(control.textContent).toContain("Simple English");
    await act(async () => control.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent === "中文")!;
    await act(async () => option.click());
    expect(localStorage.getItem("explanationLanguage")).toBe("zh");
    await act(async () => root.render(<div />));
    await act(async () => root.render(<SettingsScreen />));
    expect(host.querySelector('[aria-label="Explanation language"]')?.textContent).toContain("中文");
  });

  it("reloads an open word card when the explanation language changes", async () => {
    const { chooseExplanationLanguage } = await import("../lib/explanationLanguage");
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(100);
    const context = () => host.querySelector('[aria-label="In this sentence"]')!;
    expect(context().textContent).toContain("This word describes its role");
    expect(context().textContent).not.toMatch(/\p{Script=Han}/u);
    await act(async () => chooseExplanationLanguage("zh"));
    await wait(100);
    expect(context().textContent).toContain("它在这句话里的用法说明。");
    expect(fake.calls.filter(c => c.path === "/api/word-context").map(c => (c.body as { language: string }).language)).toEqual(["en", "zh"]);
  });

  it.each(["en", "zh"] as const)("links only marked French surfaces in %s and drills elisions as one unit", async language => {
    localStorage.setItem("explanationLanguage", language);
    const dictionary = vi.spyOn(lookupApi, "lookupWord");
    vi.spyOn(lookupApi, "wordContext").mockResolvedValue({ context: {
      meaning_en: "have", meaning_zh: "已经", why_en: "With ⟦avoir⟧ and ⟦résolu⟧, ⟦Les représentants⟧ see ⟦l'homme⟧.",
      why_zh: "这里 ⟦avoir⟧ 和 ⟦résolu⟧ 配合，⟦Les représentants⟧ 看见 ⟦l'homme⟧。",
    }, state: "ready" });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="ont" onClose={() => {}} />));
    const context = host.querySelector('[aria-label="In this sentence"]')!;
    const buttons = Array.from(context.querySelectorAll<HTMLButtonElement>('button[lang="fr"]'));
    expect(buttons.map(b => b.textContent)).toEqual(["avoir", "résolu", "Les représentants", "l'homme"]);
    expect(context.querySelectorAll("button")).toHaveLength(5); // section toggle plus four marked spans
    expect(context.textContent).not.toMatch(/[⟦⟧]/);
    expect(context.textContent).toContain(language === "en" ? "With" : "这里");
    await act(async () => buttons[3].click());
    expect(host.querySelector(".wp-headword")?.textContent).toBe("l'homme");
    expect(findButton("Back to ont")).toBeTruthy();
    expect(dictionary).toHaveBeenCalledWith("l'homme", "");
    await act(async () => findButton("Back to ont").click());
    expect(host.querySelector(".wp-headword")?.textContent).toBe("ont");
  });

  it.each(["marked explanation", "base form"])("gives avoir its own sentence context via %s", async source => {
    const sentence: StudySentence = { ...SENTENCE, fr: "Les représentants ont résolu d'exposer les droits." };
    vi.spyOn(lookupApi, "lookupWord").mockImplementation(async token => ({
      token, lemma: "avoir", pos: "verb", phonetic: "", explanation_cn: "", explanation_en: "",
      entries: [{ lemma: "avoir", pos: "verb", phonetic: "", language: "en", senses: ["have"], source_url: "", history_url: "" }],
    }));
    const context = vi.spyOn(lookupApi, "wordContext").mockImplementation(async ({ word }) => ({
      context: { meaning_en: "", meaning_zh: "", why_zh: "", why_en: word === "avoir"
        ? "⟦avoir⟧ is the infinitive behind ⟦ont⟧, the auxiliary with ⟦résolu⟧."
        : "⟦ont⟧ is the 3rd person plural present tense of ⟦avoir⟧." }, state: "ready",
    }));
    await act(async () => root.render(<WordPanel sentence={sentence} text="ont" onClose={() => {}} />));
    const avoir = source === "marked explanation"
      ? Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="In this sentence"] button[lang="fr"]')).find(button => button.textContent === "avoir")!
      : findButton("avoir");
    await act(async () => avoir.click());
    expect(context.mock.calls.at(-1)?.[0]).toMatchObject({ word: "avoir", occurrence: 0, sentence: sentence.fr });
    expect(host.querySelector(".wp-headword")?.textContent).toBe("avoir");
    expect(host.querySelector('[aria-label="In this sentence"]')?.textContent).toContain("is the infinitive behind");
    expect(findButton("Back to ont")).toBeTruthy();
    await act(async () => findButton("Back to ont").click());
    expect(host.querySelector('[aria-label="In this sentence"]')?.textContent).toContain("3rd person plural");
  });

  it("selects the closest repeated surface when drilling within a sentence", async () => {
    const sentence: StudySentence = { ...SENTENCE, fr: "Ils ont résolu ceci ; ils ont résolu cela." };
    const context = vi.spyOn(lookupApi, "wordContext").mockResolvedValue({
      context: { meaning_en: "", meaning_zh: "", why_zh: "", why_en: "With ⟦résolu⟧ it forms the passé composé." }, state: "ready",
    });
    await act(async () => root.render(<WordPanel sentence={sentence} text="ont" occurrence={1} onClose={() => {}} />));
    await act(async () => findButton("résolu").click());
    expect(context.mock.calls.at(-1)?.[0]).toMatchObject({ word: "résolu", occurrence: 1 });
  });

  it("keeps unmarked French and English words plain in the explanation", async () => {
    vi.spyOn(lookupApi, "wordContext").mockResolvedValue({ context: { meaning_en: "have", meaning_zh: "", why_zh: "", why_en: "avoir is used here with résolu." }, state: "ready" });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="ont" onClose={() => {}} />));
    expect(host.querySelectorAll('[aria-label="In this sentence"] button[lang="fr"]')).toHaveLength(0);
  });

  it("loads Chinese context despite a stored English gloss, with collapsed French definitions", async () => {
    localStorage.setItem("explanationLanguage", "zh");
    const sentence: StudySentence = {
      ...SENTENCE,
      raw: { ...SENTENCE.raw!, words: [{ fr: "madame", ipa: "madam", lemma: "madame", type: "noun", meaning: "madam; a polite address", meaning_zh: "女士", why: "A polite way to address a woman.", english_link: "madam", false_friend: false }] },
    };
    await act(async () => root.render(<WordPanel sentence={sentence} text="madame" wordIndex={0} onClose={() => {}} />));
    await wait(150);
    const panel = host.querySelector(".word-card")!;
    expect(panel.querySelector(".wp-definition")?.textContent).toContain("它在这句话里的用法说明。");
    expect(fake.calls.some(c => c.path === "/api/word-context")).toBe(true);
    expect(panel.textContent).toContain("[madam]");
    expect(panel.textContent).not.toContain("Example sentence");
    expect(panel.querySelector('[aria-label="In this sentence"]')?.textContent).toMatch(/\p{Script=Han}/u);
    expect(panel.textContent).not.toContain("Définition de madame.");
    await act(async () => findButton("French definitions").click());
    expect(panel.textContent).toContain("Définition de madame.");

    expect(panel.textContent).toContain("the meaning here");
    expect(panel.querySelector('[aria-label="In this sentence"]')?.textContent).toMatch(/\p{Script=Han}/u);
  });

  it("keeps L’oubli as headword and renders elision plus Chinese meaning and role", async () => {
    localStorage.setItem("explanationLanguage", "zh");
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({
      token: "L’oubli", lemma: "oubli", pos: "noun", phonetic: "", explanation_cn: "", explanation_en: "",
      elision: { prefix: "L’", expansion: "le", note: "masculine definite article, elided before a vowel", remainder: "oubli" },
      entries: [{ lemma: "oubli", pos: "noun", phonetic: "", language: "en", senses: ["forgetting"], source_url: "", history_url: "" }],
    });
    vi.spyOn(lookupApi, "wordContext").mockResolvedValue({ context: {
      meaning_zh: "遗忘", meaning_en: "forgetting", why_zh: "这里指遗忘；le mépris 和 l’oubli 由 ou 连接，共同作主语。",
    }, state: "ready" });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="L’oubli" onClose={() => {}} />));
    expect(host.querySelector(".wp-headword")?.textContent).toBe("L’oubli");
    expect(host.querySelector('[aria-label="Elision breakdown"]')?.textContent).toContain("L’ = le");
    expect(host.querySelector('[aria-label="Dictionary"]')?.textContent).not.toContain("not in the dictionary");
    const context = host.querySelector('[aria-label="In this sentence"]')!;
    expect(context.querySelector('[lang="zh"]')?.textContent).toContain("共同作主语");
    expect(context.textContent).toContain("遗忘");
    expect(context.querySelector('[lang="en"]')?.textContent).toBe("forgetting");
  });

  it("uses the aligned surface in analysis word chips and split component alignment", async () => {
    const word = {fr:"homme",meaning:"human being",meaning_zh:"人",lemma:"homme",type:"noun",ipa:"",why:"",english_link:"",false_friend:false};
    const sentence = {...SENTENCE,fr:"Voici l'homme.",segments:[{t:"Voici l'"},{t:"homme",w:true,wi:0},{t:"."}],raw:{...SENTENCE.raw!,words:[word],alignment:[{fr:"l'",en:"the"},{fr:"homme",en:"man"}]}};
    const picked = vi.fn();
    await act(async () => root.render(<WordsPanel sentence={sentence} onPick={picked} />));
    const tokens = Array.from(host.querySelectorAll<HTMLElement>(".fr-word"));
    expect(tokens.map(t => t.textContent)).toEqual(["l'homme"]);
    await act(async () => tokens[0].click());
    expect(picked.mock.calls[0][0].text).toBe("l'homme");
  });

  it("shows the full selected elision with its own Chinese context", async () => {
    localStorage.setItem("explanationLanguage", "zh");
    const fr = "Il défend les droits de l'homme.";
    vi.spyOn(lookupApi, "phraseContext").mockResolvedValue({phrases: [{text:"droits de l’homme", phrase:"droits de l’homme", meaning_zh:"人权", meaning_en:"human rights", literal_zh:""}]});
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({token:"l'homme", lemma:"homme",pos:"noun",phonetic:"",explanation_cn:"",explanation_en:"",elision:{prefix:"l'",expansion:"le",note:"definite article",remainder:"homme"},entries:[{lemma:"homme",pos:"noun",phonetic:"",language:"en",senses:["man"],source_url:"",history_url:""}]});
    vi.spyOn(lookupApi, "wordContext").mockResolvedValue({context:{meaning_zh:"人",meaning_en:"man",why_zh:"这里泛指人。"},state:"ready"});
    const sentence = {...SENTENCE, fr, segments:[{t:"Il défend les droits de l'"},{t:"homme",w:true,wi:0},{t:"."}]};
    const picked = vi.fn();
    const { FrText } = await import("../components/FrText");
    await act(async () => root.render(<FrText segments={sentence.segments} onPick={picked} />));
    const token = Array.from(host.querySelectorAll<HTMLElement>(".fr-word")).find(s => s.textContent === "l'homme")!;
    expect(token).toBeTruthy();
    await act(async () => token.click());
    expect(picked.mock.calls[0][0].text).toBe("l'homme");
    await act(async () => root.render(<WordPanel sentence={sentence} text={picked.mock.calls[0][0].text} wordIndex={0} onClose={() => {}} />));
    expect(host.querySelector(".wp-headword")?.textContent).toBe("l'homme");
    expect(host.querySelector('[aria-label="Elision breakdown"]')?.textContent).toContain("l' = le");
    expect(host.querySelector('[aria-label="In this sentence"] [lang="zh"]')?.textContent).toContain("这里泛指人");
    expect(host.querySelector('[aria-label="In this sentence"]')?.textContent).not.toContain("人权");
    await act(async () => root.render(<WordPanel sentence={{...sentence,fr:"Il voit l'homme."}} text="l'homme" onClose={() => {}} />));
    expect(host.querySelector('[aria-label="In this sentence"]')?.textContent).not.toContain("人权");
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
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="recorrection" onClose={() => {}} />));
    const section = host.querySelector('[aria-label="Dictionary"]')!;
    expect(section.textContent).toContain("Related: correction");
    expect(section.textContent).not.toContain("Action de corriger.");
    await act(async () => findButton("French definitions").click());
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
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="objectifs différents unknownzzz" onClose={() => {}} />));
    const section = host.querySelector('[aria-label="Dictionary"]')!;
    expect(section.textContent).toContain("objectifs");
    expect(section.textContent).toContain("objective, goal, aim");
    expect(section.textContent).toContain("Related: différent");
    expect(section.textContent).toContain("different");
    expect(section.textContent).toContain("“unknownzzz” is not in the dictionary.");
    expect(section.textContent?.match(/is not in the dictionary/g)).toHaveLength(1);
    expect(section.textContent).not.toContain("No dictionary entry");
  });

  it("keeps a chunk in one card, drills into components and French definitions, and returns with Back", async () => {
    vi.spyOn(lookupApi, "phraseContext").mockResolvedValue({ phrases: [{ text: "machine à laver", phrase: "machine à laver", meaning_zh: "", literal_zh: "", meaning_en: "washing machine" }], cached: true } as Awaited<ReturnType<typeof lookupApi.phraseContext>>);
    vi.spyOn(lookupApi, "wordContext").mockResolvedValue({ context: { meaning_en: "washing machine", meaning_zh: "", why_zh: "" }, state: "ready" } as Awaited<ReturnType<typeof lookupApi.wordContext>>);
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="machine à laver" onClose={() => {}} />));
    await wait(100);
    expect(host.querySelectorAll(".word-card")).toHaveLength(1);
    expect(host.querySelector(".wp-headword")?.textContent).toBe("machine à laver");
    expect(host.querySelector('[aria-label="In this sentence"]')?.textContent?.match(/washing machine/g)).toHaveLength(1);
    const chip = host.querySelector<HTMLButtonElement>('[aria-label="Component words"] button')!;
    await act(async () => chip.click());
    await wait(100);
    expect(host.querySelectorAll(".word-card")).toHaveLength(1);
    expect(host.querySelector(".wp-headword")?.textContent).toBe("machine");
    expect(host.textContent).toContain("machine à laver › machine");
    await act(async () => findButton("French definitions").click());
    const word = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="French definitions"] button')).find(b => b.textContent === "Définition")!;
    await act(async () => word.click());
    await wait(100);
    expect(host.querySelector(".wp-headword")?.textContent).toBe("Définition");
    await act(async () => findButton("Back to machine").click());
    await act(async () => findButton("Back to machine à laver").click());
    expect(host.querySelector(".wp-headword")?.textContent).toBe("machine à laver");
  });

  it("drills nuisibles → nuisible with its own deck star, target context, dictionary fallback and retry", async () => {
    const sentence: StudySentence = { ...SENTENCE, fr: "Ces insectes sont nuisibles.", en: "These insects are harmful." };
    const lookup = vi.spyOn(lookupApi, "lookupWord").mockImplementation(async token => ({
      token, lemma: "nuisible", pos: "adj", phonetic: "", explanation_cn: "", explanation_en: "",
      entries: [{ lemma: "nuisible", pos: "adj", phonetic: "", language: "en", senses: ["harmful"], source_url: "https://en.wiktionary.org/wiki/nuisible#French", history_url: "" }],
    }));
    const context = vi.spyOn(lookupApi, "wordContext").mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<WordPanel sentence={sentence} text="nuisibles" occurrence={0} onClose={() => {}} />));
    await wait(100);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    await act(async () => findButton("nuisible").click());
    await wait(100);
    expect(host.querySelector(".wp-headword")?.textContent).toBe("nuisible");
    expect(lookup).toHaveBeenLastCalledWith("nuisible", "");
    expect(host.querySelector('[aria-label="Save word"]')?.getAttribute("aria-pressed")).toBe("false");
    const section = host.querySelector('[aria-label="In this sentence"]')!;
    expect(section.textContent).toContain("harmful");
    expect(section.textContent).toContain("Dictionary meaning");
    expect(section.textContent).not.toContain("Couldn’t load");
    expect(context.mock.calls.at(-1)?.[0]).toMatchObject({ word: "nuisible", occurrence: 0, sentence: sentence.fr });
    context.mockResolvedValue({ context: { meaning_en: "harmful to people", meaning_zh: "", why_zh: "" }, state: "ready" } as Awaited<ReturnType<typeof lookupApi.wordContext>>);
    await act(async () => findButton("Retry").click());
    await wait(100);
    expect(section.textContent).toContain("harmful to people");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    const saves = fake.calls.filter(c => c.path === "/api/srs/notes" && c.method === "POST");
    expect(saves.at(-1)?.body).toMatchObject({ sentence: sentence.fr, targets: [{ text: "nuisible" }] });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Saved"]')!.click());
    await wait(150);
    expect(get().cards.some(c => c.word === "nuisible")).toBe(false);
    expect(get().cards.some(c => c.word === "nuisibles")).toBe(true);
    await act(async () => findButton("Back to nuisibles").click());
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
  });

  it("shows importance stars and lookup count beside an unsaved deck star", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="machine" onClose={() => {}} />));
    await wait(100);
    const star = host.querySelector('[aria-label="Save word"]')!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.querySelector("svg.fill-current")).toBeNull();
    const importance = host.querySelector(".wp-importance")!;
    expect(importance.querySelectorAll("[data-filled]")).toHaveLength(5);
    expect(importance.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
    expect(importance.querySelectorAll("svg.lucide-star")).toHaveLength(5);
    expect(importance.textContent).toContain("1 lookup");
    expect(importance.textContent).toContain("Importance, 0 out of 5. Looked up 1 time.");
    // Not saved yet: nothing to rate, so the stars are not buttons.
    expect(importance.querySelector('[role="radio"]')).toBeNull();
  });

  it("saves a word with 3 stars, lets the learner choose 2-5, and adds a star every 5 lookups after that", async () => {
    fake.lookups.madame = 6;
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(3); // auto-saved at the 7th lookup
    const radios = host.querySelectorAll<HTMLButtonElement>('.wp-importance [role="radio"]');
    expect([...radios].map(r => r.getAttribute("aria-label"))).toEqual([2, 3, 4, 5].map(i => `Importance ${i} out of 5`));
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    await act(async () => radios[0].click());
    await wait(50);
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(2);
    const call = fake.calls.filter(c => c.path === "/api/srs/importance").at(-1)!;
    expect(call.body).toMatchObject({ importance: 2 });
    expect(fake.srs.cards.filter(c => c.target === "madame").every(c => c.importance === 2)).toBe(true);
    const filled: number[] = [];
    for (let i = 0; i < 5; i++) { // lookups 8-12, each outside the repeat window
      fake.lookupLast.madame = 0;
      await act(async () => { await lookupApi.recordLookup("madame", SENTENCE); });
      await wait(20);
      filled.push(host.querySelectorAll('.wp-importance [data-filled="true"]').length);
    }
    expect(filled).toEqual([2, 2, 2, 2, 3]);
  });

  it("fills the deck star and three stars when saved", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(100);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(100);
    const saved = host.querySelector('[aria-label="Saved"]');
    expect(saved?.getAttribute("aria-pressed")).toBe("true");
    expect(saved?.querySelector("svg.fill-current")).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(3);
    await act(async () => (saved as HTMLButtonElement).click());
    await wait(100);
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(0);
    expect(host.querySelector(".wp-importance")?.textContent).toContain("1 lookup");
  });

  it.each([[2, 3], [4, 3], [9, 3]])("auto-saves on the next lookup after %i and shows %i stars", async (previous, stars) => {
    fake.lookups.madame = previous;
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(stars);
    expect(host.querySelector(".wp-importance")?.textContent).toContain(`${previous + 1} lookups`);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Saved"]')!.click());
    await wait(150);
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    await act(async () => { await lookupApi.recordLookup("madame", SENTENCE); });
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(0);
    expect(host.querySelector(".wp-importance")?.textContent).toContain(`${previous + 1} lookups`);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(stars);
  });

  it("plays headword and dictionary phonetics without drilling or counting another lookup", async () => {
    const audio = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
    const entry = { lemma: "canadien", pos: "adj", phonetic: "kanadjɛ̃", language: "en" as const, senses: ["Canadian"], source_url: "https://en.wiktionary.org", history_url: "" };
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({ token: "canadien", lemma: "canadien", pos: "adj", phonetic: "kanadjɛ̃", dictionary_source: "wiktionnaire", explanation_en: "Canadian", explanation_cn: "", entries: [entry, { ...entry, language: "fr", senses: ["Du Canada."] }] });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="canadien" onClose={() => {}} />));
    await wait(100);
    await act(async () => findButton("French definitions").click());
    const ipa = host.querySelectorAll<HTMLButtonElement>('[aria-label="Pronounce “canadien”"]');
    expect(ipa).toHaveLength(3);
    for (const button of ipa) await act(async () => button.click());
    expect(audio.mock.calls).toEqual([["canadien"], ["canadien"], ["canadien"]]);
    expect(host.querySelector(".wp-headword")?.textContent).toBe("canadien");
    expect(fake.calls.filter(c => c.path === "/api/srs/lookups" && c.method === "POST")).toHaveLength(1);
  });

  it("resets the open modules on another word, nested drill, back and reopen", async () => {
    const render = (text: string) => act(async () => root.render(<WordPanel sentence={SENTENCE} text={text} onClose={() => {}} />));
    await render("machine à laver");
    await wait(100);
    const checkOpen = () => { for (const name of ["In this sentence", "Dictionary"]) expect(host.querySelector(`[aria-label="${name}"] button`)?.getAttribute("aria-expanded")).toBe("true"); };
    const collapse = async () => { for (const name of ["In this sentence", "Dictionary"]) await act(async () => findButton(name).click()); };
    await collapse();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Component words"] button')!.click());
    checkOpen();
    await collapse();
    await act(async () => findButton("Back to machine à laver").click());
    checkOpen();
    await collapse();
    await render("madame");
    checkOpen();
    await act(async () => root.render(null));
    await render("madame");
    checkOpen();
    for (const name of ["Word origin", "Ask AI", "Notes"]) expect(host.querySelector(`[aria-label="${name}"] button`)?.getAttribute("aria-expanded")).toBe("false");
    await wait(150);
  });

  it("saves exact cloze metadata and unsaves only this word across sentences", async () => {
    fake.srs.favorites.add("madame"); // A historical bookmark alone is not membership.
    function SavedStatus() { return <span data-saved={useSavedCards(SENTENCE.fr).has(cardKey("cloze", "madame"))} />; }
    await act(async () => root.render(<><WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} /><SavedStatus /></>));
    await wait(100);
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(150);
    const request = fake.calls.find(c => c.path === "/api/srs/notes" && c.method === "POST");
    expect(request?.body).toMatchObject({ sentence: SENTENCE.fr, modes: [], targets: [{ text: "madame", mode: "cloze", exact_target: true, meta: { snap: "1" } }] });
    expect(host.querySelector('[data-saved]')?.getAttribute("data-saved")).toBe("true");
    const own = get().cards.find(c => c.word === "madame")!;
    await act(async () => set(s => ({ cards: [...s.cards, { ...own, id: "other-context", sentenceId: "other-note" }, { ...own, id: "recall-fallback", mode: "recognize" }] })));
    const remaining = get().cards.filter(c => c.word !== "madame" || !["cloze", "recognize"].includes(c.mode ?? "")).map(c => c.id);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Saved"]')!.click());
    await wait(150);
    expect(get().cards.map(c => c.id)).toEqual(remaining);
    expect(fake.calls.filter(c => c.method === "DELETE").map(c => c.path)).toEqual([`/api/srs/cards/${own.id}`, "/api/srs/cards/other-context", "/api/srs/cards/recall-fallback"]);
    expect(host.querySelector('[data-saved]')?.getAttribute("data-saved")).toBe("false");
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    expect(fake.calls.some(c => c.path === "/api/srs/favorites" && c.method === "PUT")).toBe(false);
  });

  it("keeps star and importance together on save and delete failure", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(100);
    fake.failNext.add("/api/srs/notes");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    await wait(150);
    expect(host.querySelector('[aria-label="Save word"]')).toBeTruthy();
    expect(get().announce.msg).toContain("Couldn’t update");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Save word"]')!.click());
    await wait(150);
    fake.failNext.add("/api/srs/cards/");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Saved"]')!.click());
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
  });

  it("counts one initial request under StrictMode and one per nested drill", async () => {
    await act(async () => root.render(<StrictMode><WordPanel sentence={SENTENCE} text="machine à laver" onClose={() => {}} /></StrictMode>));
    await wait(150);
    expect(fake.calls.filter(c => c.path === "/api/srs/lookups" && c.method === "POST")).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Component words"] button')!.click());
    await wait(100);
    expect(fake.calls.filter(c => c.path === "/api/srs/lookups" && c.method === "POST").map(c => ({ word: (c.body as { word: string }).word }))).toEqual([{ word: "machine à laver" }, { word: "machine" }]);
  });

  it("adds a note with ⌘ Enter or Ctrl Enter, and plain Enter stays a new line", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(100);
    await act(async () => findButton("Notes").click());
    await wait(100);
    const area = host.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')!;
    const type = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value); area.dispatchEvent(new Event("input", { bubbles: true })); });
    const press = async (init: KeyboardEventInit) => act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })); });
    await type("mépris\nscorn");
    await press({});
    await wait(100);
    expect(fake.notes).toHaveLength(0);
    await press({ metaKey: true });
    await wait(150);
    expect(fake.notes.map(n => n.text)).toEqual(["mépris\nscorn"]);
    expect(area.value).toBe("");
    await type("second");
    await press({ ctrlKey: true });
    await wait(150);
    expect(fake.notes.map(n => n.text)).toEqual(["mépris\nscorn", "second"]);
    await press({ metaKey: true }); // empty: nothing is sent
    await wait(100);
    expect(fake.notes).toHaveLength(2);
  });

  it("adds, edits and deletes multiple notes, and asks AI with sentence context", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(100);
    expect(fake.calls.some(c => c.path === "/api/etymology")).toBe(false);
    await act(async () => findButton("Notes").click());
    await wait(100);
    const input = async (selector: string, value: string) => {
      const el = host.querySelector<HTMLTextAreaElement | HTMLInputElement>(selector)!;
      const prototype = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    for (const text of ["My first note", "My second note"]) {
      await input('[aria-label="Note text"]', text);
      await act(async () => findButton("Add note").click());
      await wait(150);
    }
    expect(fake.notes.map(n => n.text)).toEqual(["My first note", "My second note"]);
    expect(host.querySelectorAll("time")).toHaveLength(2);
    await act(async () => findButton("Edit").click());
    await input('[aria-label="Note text"]', "Updated note");
    await act(async () => findButton("Save note").click());
    await wait(150);
    expect(fake.notes[0].text).toBe("Updated note");
    await act(async () => findButton("Delete").click());
    await wait(150);
    expect(fake.notes.map(n => n.text)).toEqual(["My second note"]);
    await act(async () => findButton("Ask AI").click());
    await input('[aria-label="Ask about this word"]', "What does it mean?");
    await act(async () => findButton("Send").click());
    await wait(100);
    expect(fake.calls.find(c => c.path === "/api/ask")?.body).toMatchObject({ sentence: FR, question: "What does it mean?", word: "madame", translation_en: SENTENCE.en, language: "en" });
    expect(host.textContent).toContain("The surrounding words give the context.");
  });

  it.each(["en", "zh"] as const)("sends the raw mixed-language gloss question with %s context", async language => {
    localStorage.setItem("explanationLanguage", language);
    const sentence = { ...SENTENCE, fr: "Les représentants ont décidé d'exposer le plan.", en: "The representatives decided to set forth the plan." };
    await act(async () => root.render(<WordPanel sentence={sentence} text="d'exposer" onClose={() => {}} />));
    await wait(100);
    await act(async () => findButton("Ask AI").click());
    const el = host.querySelector<HTMLInputElement>('[aria-label="Ask about this word"]')!;
    const question = "啥意思？ to set forth 呢？";
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, question);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => findButton("Send").click());
    await wait(100);
    expect(fake.calls.find(c => c.path === "/api/ask")?.body).toMatchObject({
      sentence: sentence.fr, translation_en: sentence.en, word: "d'exposer", language, question, history: [],
    });
  });

  it("keeps grammar available at sentence level without a word-card entry point", async () => {
    await act(async () => headerWord("madame").click());
    expect(document.querySelector(".word-card")).toBeTruthy();
    expect(document.querySelector(".word-card")?.textContent).not.toContain("See grammar");
    expect(get().study.tab).not.toBe("grammar");
  });

  it("renders a muted explicit true miss", async () => {
    vi.spyOn(lookupApi, "lookupWord").mockResolvedValue({
      token: "unknownzzz", lemma: "unknownzzz", pos: "", phonetic: "", explanation_cn: "", explanation_en: "",
      dictionary_state: "not_found", entries: [],
    });
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="unknownzzz" onClose={() => {}} />));
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

  it("a second tap on the same word keeps the card open, and a tap outside the text still closes it", async () => {
    const tap = async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
        (el as HTMLElement).click();
        await wait(20);
      });
    };
    await tap(headerWord("madame"));
    expect(document.querySelector(".wp-headword")?.textContent).toBe("madame");
    await tap(headerWord("madame"));
    expect(document.querySelector(".wp-headword")?.textContent).toBe("madame");
    await tap(document.body);
    expect(document.querySelector(".word-card")).toBeNull();
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

  it("no Playback scope control or 'Current step' concept is rendered", async () => {
    const text = host.textContent ?? "";
    expect(text).not.toContain("Playback scope");
    expect(text).not.toContain("Current step");
    expect(document.querySelector('[aria-label="Playback scope"]')).toBeNull();
    expect(findButton("Play all steps")).toBeTruthy();
    expect(findButton("Play step 2")).toBeTruthy();
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Practise step"))).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Previous step" || b.textContent === "Next step")).toBe(false);
    // Play all sentences moved from the player bar into the sentence header's More menu.
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Play all sentences"))).toBe(false);
    expect(menuItem(await openMore(), "Play all sentences")).toBeTruthy();
  });

  it("dictionary errors retry the real source and never request generated roots", async () => {
    fake.failNext.add("dictionary");
    await act(async () => headerWord("madame").click());
    await wait(150);
    expect(document.querySelector(".word-card")?.textContent).toContain("Dictionary request failed");
    await act(async () => findButton("Retry").click());
    await wait(150);
    const panel = document.querySelector(".word-card")!;
    await act(async () => findButton("French definitions").click());
    expect(panel.textContent).toContain("Définition de madame.");
    expect(panel.querySelector('a[href="https://fr.wiktionary.org/wiki/madame#fr"]')).toBeTruthy();
    expect(panel.textContent).toContain("Source: Wiktionary (CC BY-SA)");
    expect(panel.querySelector('[aria-label="In this sentence"]')?.textContent).not.toMatch(/\p{Script=Han}/u);
    expect(fake.calls.filter((call) => call.path === "/api/etymology")).toHaveLength(0);
    fake.etymologyFails = 1;
    await act(async () => findButton("Word origin").click());
    await wait(100);
    await act(async () => findButton("Retry").click());
    await wait(100);
    for (const label of ["构成", "来源", "词义演变", "记忆提示", "ad + finem", "finis"]) expect(panel.textContent).toContain(label);
    expect(fake.calls.find(call => call.path === "/api/etymology")?.body).toMatchObject({ language: "zh" });
    await act(async () => Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "fin")!.click());
    await wait(100);
    expect(panel.querySelector(".wp-headword")?.textContent).toBe("fin");
    expect(fake.calls.filter(call => call.path === "/api/etymology")).toHaveLength(2);
  });
});

it("a whole-step selection speaks once and the trailing row click never starts the store player", async () => {
  const say = vi.spyOn(store, "sayFrench").mockImplementation(() => {});
  const start = vi.spyOn(store, "startPlayback");
  const row = host.querySelectorAll("ol li")[2] as HTMLElement;
  const paragraph = row.querySelector(".step-fr")!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection()!.addRange(range);
  await act(async () => paragraph.dispatchEvent(new Event("pointerup", { bubbles: true })));
  await act(async () => row.click());
  expect(say).toHaveBeenCalledTimes(1);
  expect(say).toHaveBeenCalledWith(FR.replace(/ \?$/, ""));
  expect(start).not.toHaveBeenCalled();
});

it.each(["en", "zh"])("uses exact phrase context in %s and clears it on a long pick", async language => {
  localStorage.setItem("explanationLanguage", language);
  const sentence = { ...SENTENCE, fr: "Les représentants ont résolu d'exposer les droits de l'homme." };
  vi.spyOn(lookupApi, "phraseContext").mockResolvedValue({phrases:[{text:"droits de l'homme",phrase:"droits de l'homme",meaning_en:"human rights",meaning_zh:"人权",literal_zh:""}]});
  const exact = "ont résolu";
  fake.wordContexts[exact] = {meaning_en:"have resolved",why_en:`⟦${exact}⟧ describes their completed decision.`,meaning_zh:"已经决定",why_zh:`⟦${exact}⟧ 表示他们已经作出决定。`};
  const context = vi.spyOn(lookupApi, "wordContext");
  await act(async () => root.render(<WordPanel sentence={sentence} text={exact} onClose={() => {}} />));
  await wait(100);
  expect(context.mock.calls.at(-1)?.[0]).toMatchObject({word:exact, language});
  expect(host.querySelector('[aria-label="In this sentence"]')?.textContent).toContain(language === "en" ? "completed decision" : "作出决定");
  await act(async () => root.render(<WordPanel sentence={sentence} text={sentence.fr} onClose={() => {}} />));
  const section = host.querySelector('[aria-label="In this sentence"]')!;
  expect(section.textContent).toContain("Select a word or a short phrase");
  expect(section.textContent).not.toMatch(/human rights|人权|completed decision|作出决定|droits de l'homme/);
  expect(context).toHaveBeenCalledTimes(1);
});

it("Steps Review saves one listen card, shares state and removes it", async () => {
  await act(async () => set(s => ({study:{...s.study,sentences:[{...SENTENCE, steps:[SENTENCE.steps[0], SENTENCE.steps[0]]}]}})));
  const row = host.querySelector("ol li")!;
  const review = () => [...row.querySelectorAll("button")].find(b => /^(Review|In review)$/.test(b.getAttribute("aria-label") ?? ""))!;
  await act(async () => { review().click(); await new Promise(r => setTimeout(r, 100)); });
  const posts = fake.calls.filter(c => c.path === "/api/srs/notes");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toMatchObject({sentence:STEP0,translation_en:"Hello",modes:["listen"],targets:[]});
  expect(review().getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelectorAll('ol button[aria-pressed="true"]')).toHaveLength(2);
  expect(fake.srs.cards.filter(c => c.note?.sentence === STEP0 && c.mode === "listen")).toHaveLength(1);
  await act(async () => { review().click(); await new Promise(r => setTimeout(r, 100)); });
  expect(review().getAttribute("aria-pressed")).toBe("false");
  expect(fake.srs.cards.filter(c => c.note?.sentence === STEP0 && c.mode === "listen")).toHaveLength(0);
  expect(fake.calls.filter(c => c.path === "/api/srs/notes")).toHaveLength(1);
});

it("removes a pre-existing step listen card using lookup metadata before the library is loaded", async () => {
  const { saveNote } = await import("../api/srs");
  const { StepReview } = await import("../components/StepReview");
  await act(async () => {
    await saveNote({sentence:STEP0,translation_en:"Hello",translation_zh:"",modes:["listen"],targets:[]});
    resetSavedCards();
    set(() => ({cards:[], sentences:[]}));
    root.render(<StepReview sentence={STEP0} english="Hello" />);
  });
  await wait(100);
  const button = host.querySelector("button")!;
  expect(button.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { button.click(); await new Promise(r => setTimeout(r, 100)); });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(fake.srs.cards.filter(c => c.note?.sentence === STEP0 && c.mode === "listen")).toHaveLength(0);
});

describe("1.3.8 Study layout", () => {
  const SECOND: StudySentence = { ...SENTENCE, id: "s-second", fr: "Nous avons pris un café.", en: "We had a coffee.", segments: [{ t: "Nous avons pris un café." }] };
  const mouseDown = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
  const tab = (list: Element, name: string) => {
    const t = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).find((x) => x.textContent === name);
    if (!t) throw new Error(`No tab "${name}"`);
    return t;
  };

  it("one sentence has no header row; the single More menu sits at the end of the player row", async () => {
    await act(async () => set((s) => ({ study: { ...s.study, sentences: [SENTENCE], index: 0 } })));
    expect(host.querySelector("[data-sentence-header]")).toBeNull();
    const more = host.querySelectorAll('button[aria-label="More sentence actions"]');
    expect(more).toHaveLength(1);
    expect(host.querySelector("[data-sentence-player]")?.contains(more[0])).toBe(true);
    expect(host.querySelector('button[aria-label="More playback controls"]')).toBeNull();
    expect((await openMore()).map((x) => x.textContent?.trim())).toEqual(["Play all sentences", "Analyses in History", "New text", "Edit source"]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  });

  it("the sentence header More menu plays and pauses all sentences like the old bar button", async () => {
    await act(async () => set((s) => ({ study: { ...s.study, sentences: [SENTENCE, SECOND], index: 0 } })));
    const header = host.querySelector("[data-sentence-header]")!;
    expect(header.textContent).toContain("Sentence 1 of 2");
    const prev = header.querySelector('button[aria-label="Previous sentence"]')!;
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(prev.textContent).toBe("This is the first sentence.");
    expect(header.querySelector('button[aria-label="Next sentence"]')?.getAttribute("aria-disabled")).toBeNull();
    expect(host.querySelector("[data-sentence-player]")?.querySelector('button[aria-label="Next sentence"]')).toBeNull();

    await act(async () => menuItem(await openMore(), "Play all sentences").click());
    expect(get().player?.owner.label).toBe("Study audio · All sentences");
    expect(get().player?.texts).toEqual([FR, SECOND.fr]);
    expect(get().player?.status).not.toBe("paused");

    await act(async () => menuItem(await openMore(), "Pause all sentences").click());
    expect(get().player?.status).toBe("paused");
    expect(menuItem(await openMore(), "Play all sentences")).toBeTruthy();
  });

  it("level-1 navigation is a Tool group tablist and each group remembers its sub-tab", async () => {
    const groups = host.querySelector('[role="tablist"][aria-label="Tool group"]')!;
    expect(groups).toBeTruthy();
    expect(Array.from(groups.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(["Understand", "Listen & speak", "Check yourself"]);
    expect(tab(groups, "Listen & speak").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("learn-panel")?.getAttribute("aria-labelledby")).toBe("learn-tab-steps");
    expect(document.getElementById("learn-tab-steps")?.getAttribute("role")).toBe("tab");

    await mouseDown(tab(groups, "Understand"));
    expect(get().study.tab).toBe("words");
    await mouseDown(tab(host.querySelector('[role="tablist"][aria-label="Understand"]')!, "Grammar"));
    expect(get().study.tab).toBe("grammar");
    await mouseDown(tab(groups, "Listen & speak"));
    expect(get().study.tab).toBe("steps");
    await mouseDown(tab(groups, "Understand"));
    expect(get().study.tab).toBe("grammar");
    expect(tab(groups, "Understand").getAttribute("aria-selected")).toBe("true");
  });

  it("a step row exposes compact icon actions with their names and state", async () => {
    const row = host.querySelector("ol li")!;
    const byName = (name: string) => row.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    for (const name of ["Play step 1", "Repeat this step", "Say this step", "Review"]) {
      expect(byName(name)?.textContent).toBe("");
      expect(byName(name)?.getAttribute("data-variant")).toBe("ghost");
    }
    expect(byName("Repeat this step")?.getAttribute("aria-pressed")).toBe("false");
    expect(byName("Say this step")?.getAttribute("aria-expanded")).toBe("false");
    expect(byName("Review")?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => byName("Play step 1")!.click());
    expect(get().player?.texts).toEqual([STEP0]);
    expect(byName("Pause step 1")).toBeTruthy();

    await act(async () => byName("Repeat this step")!.click());
    expect(get().player?.repeat).toBe(true);
    expect(byName("Repeat this step")?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => byName("Say this step")!.click());
    expect(byName("Close recorder")?.getAttribute("aria-expanded")).toBe("true");
    expect(row.querySelector('[aria-label="Step shadowing"]')).toBeTruthy();

    await act(async () => { byName("Review")!.click(); await new Promise((r) => setTimeout(r, 100)); });
    expect(byName("In review")?.getAttribute("aria-pressed")).toBe("true");
  });
});
