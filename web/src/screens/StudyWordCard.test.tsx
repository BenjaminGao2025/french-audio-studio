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
  it("loads Chinese context despite a stored English gloss, with collapsed French definitions", async () => {
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
    expect(tokens.map(t => t.textContent)).toEqual(["l'homme", "l'homme"]);
    await act(async () => tokens[1].click());
    expect(picked.mock.calls[0][0].text).toBe("l'homme");
  });

  it("shows the full selected elision and a Chinese fixed expression only when present", async () => {
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
    expect(host.querySelector('[aria-label="In this sentence"] [lang="zh"]')?.textContent).toContain("droits de l’homme：人权");
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

  it("drills nuisibles → nuisible with its own deck star, source occurrence, dictionary fallback and retry", async () => {
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
    expect(context.mock.calls.at(-1)?.[0]).toMatchObject({ word: "nuisibles", occurrence: 0, sentence: sentence.fr });
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

  it("shows importance dots and lookup count beside an unsaved deck star", async () => {
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="machine" onClose={() => {}} />));
    await wait(100);
    const star = host.querySelector('[aria-label="Save word"]')!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.querySelector("svg.fill-current")).toBeNull();
    const importance = host.querySelector(".wp-importance")!;
    expect(importance.querySelectorAll("[data-filled]")).toHaveLength(5);
    expect(importance.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
    expect(importance.querySelector("svg")).toBeNull();
    expect(importance.textContent).toContain("1 lookup");
    expect(importance.textContent).toContain("Importance, 0 out of 5, based on 1 lookup.");
  });

  it("fills the deck star and three dots when saved", async () => {
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

  it.each([[2, 4], [4, 5]])("auto-saves on the next lookup after %i and shows %i dots", async (previous, dots) => {
    fake.lookups.madame = previous;
    await act(async () => root.render(<WordPanel sentence={SENTENCE} text="madame" onClose={() => {}} />));
    await wait(150);
    expect(host.querySelector('[aria-label="Saved"]')).toBeTruthy();
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(dots);
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
    expect(host.querySelectorAll('.wp-importance [data-filled="true"]')).toHaveLength(dots);
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
    expect(fake.calls.find(c => c.path === "/api/ask")?.body).toMatchObject({ sentence: FR, question: "About “madame”: What does it mean?" });
    expect(host.textContent).toContain("The surrounding words give the context.");
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
    await act(async () => findButton("French definitions").click());
    expect(panel.textContent).toContain("Définition de madame.");
    expect(panel.querySelector('a[href="https://fr.wiktionary.org/wiki/madame#fr"]')).toBeTruthy();
    expect(panel.textContent).toContain("Source: Wiktionary (CC BY-SA)");
    expect(panel.querySelector('[aria-label="In this sentence"]')?.textContent).toMatch(/\p{Script=Han}/u);
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
