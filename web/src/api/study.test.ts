import { afterEach, describe, expect, it, vi } from "vitest";
import { gradeAttempt } from "./dictation";
import { cardKey, sentenceKey } from "./srs";
import { analyzeText, segmentsFor, splitForAnalysis, stepParts, stepsFor, stepText, toStudySentence, type ApiSentence, type ApiWord } from "./study";

const word = (fr: string, extra: Partial<ApiWord> = {}): ApiWord => ({
  fr,
  ipa: "",
  lemma: "",
  type: "",
  meaning: "",
  meaning_zh: "",
  why: "",
  english_link: "",
  false_friend: false,
  ...extra,
});

const sentence = (fr: string, extra: Partial<ApiSentence> = {}): ApiSentence =>
  ({ sentence: fr, translation_en: "", translation_zh: "", build_up: [], words: [], grammar_points: [], ...extra }) as ApiSentence;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response(JSON.stringify({ detail: "nope" }), { status });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("splitForAnalysis", () => {
  it("joins short sentences into parts under 90 characters", () => {
    expect(splitForAnalysis("Bonjour. Ça va ? Oui.")).toEqual(["Bonjour.\nÇa va ?\nOui."]);
  });

  it("starts a new part once a part would reach 90 characters", () => {
    const a = "Il y a deux jours, j’ai failli oublier mon rendez-vous chez le médecin du quartier.";
    const b = "Heureusement, ma sœur m’a appelé.";
    expect(splitForAnalysis(`${a} ${b}`)).toEqual([a, b]);
  });

  it("never splits inside « … » and treats line breaks as boundaries", () => {
    const text = "Il a dit « Bonjour. » Puis il est parti.\nFin";
    expect(splitForAnalysis(text)).toEqual(["Il a dit « Bonjour. » Puis il est parti.\nFin"]);
    expect(splitForAnalysis("   ")).toEqual(["   "]);
  });
});

describe("segmentsFor", () => {
  it("marks analysis words in order, folding apostrophes and case, and keeps the gaps", () => {
    const segs = segmentsFor("J’ai oublié mon rendez-vous.", [word("j'ai"), word("oublié"), word("rendez-vous")]);
    expect(segs).toEqual([
      { t: "J’ai", w: true, wi: 0 },
      { t: " " },
      { t: "oublié", w: true, wi: 1 },
      { t: " mon " },
      { t: "rendez-vous", w: true, wi: 2 },
      { t: "." },
    ]);
  });

  it("skips words the sentence doesn't contain and keeps the word index of the others", () => {
    const segs = segmentsFor("Le chat dort.", [word("chien"), word("dort")]);
    expect(segs).toEqual([{ t: "Le chat " }, { t: "dort", w: true, wi: 1 }, { t: "." }]);
  });
});

describe("build-up steps", () => {
  it("marks only the words added since the previous step", () => {
    expect(stepParts("", "J’ai oublié")).toEqual([{ t: "J’ai oublié" }]);
    expect(stepParts("J’ai oublié", "J’ai oublié mon rendez-vous.")).toEqual([{ t: "J’ai oublié " }, { t: "mon rendez-vous.", added: true }]);
    expect(stepParts("mon rendez-vous", "J’ai oublié mon rendez-vous")).toEqual([{ t: "J’ai oublié", added: true }, { t: " mon rendez-vous" }]);
  });

  it("a sentence without build-up is one whole step, and step text round-trips", () => {
    const [only] = stepsFor(sentence("Merci.", { translation_en: "Thanks." }));
    expect(only.addedLabel).toBe("Short sentence: practise it whole");
    expect(stepText(only)).toBe("Merci.");

    const steps = stepsFor(
      sentence("J’ai oublié mon rendez-vous.", {
        build_up: [
          { fr: "J’ai oublié", en: "I forgot", new: "" },
          { fr: "J’ai oublié mon rendez-vous.", en: "I forgot my appointment.", new: "mon rendez-vous" },
        ],
      }),
    );
    expect(steps.map((s) => s.addedLabel)).toEqual(["Starting phrase", "mon rendez-vous"]);
    expect(steps.map(stepText)).toEqual(["J’ai oublié", "J’ai oublié mon rendez-vous."]);
  });

  it("toStudySentence gives the same id for the same text and keeps the raw analysis", () => {
    const s = sentence("Bonjour.");
    expect(toStudySentence(s).id).toBe(toStudySentence(sentence("Bonjour. ")).id);
    expect(toStudySentence(s).raw).toBe(s);
    expect(toStudySentence(s).cards.map((c) => c.kind)).toEqual(["Listen", "Speak"]);
  });
});

describe("analyzeText", () => {
  const long = (n: number) => `Phrase numéro ${n} avec assez de mots pour remplir une bonne partie de la limite de longueur.`;

  it("retries a 5xx part and keeps the order of parts", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      const text = JSON.parse(String(init.body)).text as string;
      calls.push(text);
      if (text === long(1) && calls.filter((c) => c === text).length === 1) return fail(502);
      return ok({ sentences: [sentence(text)] });
    });
    const progress: number[] = [];
    const p = analyzeText(`${long(1)} ${long(2)}`, { onProgress: (x) => progress.push(x.done) });
    await vi.advanceTimersByTimeAsync(1500);
    const res = await p;
    expect(res.sentences.map((s) => s.sentence)).toEqual([long(1), long(2)]);
    expect(res.failedParts).toBe(0);
    expect(calls.filter((c) => c === long(1))).toHaveLength(2);
    expect(progress).toEqual([1, 2]);
  });

  it("skips a part that keeps failing, fails only when every part fails, and never retries a 4xx", async () => {
    vi.useFakeTimers();
    let count = 0;
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      count++;
      const text = JSON.parse(String(init.body)).text as string;
      return text === long(1) ? fail(503) : ok({ sentences: [sentence(text)] });
    });
    const p = analyzeText(`${long(1)} ${long(2)}`);
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;
    expect(res.sentences.map((s) => s.sentence)).toEqual([long(2)]);
    expect(res.failedParts).toBe(1);
    expect(count).toBe(4); // 3 tries of the failing part + 1

    count = 0;
    vi.stubGlobal("fetch", async () => {
      count++;
      return fail(422);
    });
    await expect(analyzeText("Bonjour.")).rejects.toMatchObject({ status: 422 });
    expect(count).toBe(1);
  });
});

describe("dictation and card keys", () => {
  it("creates the server item once and grades Recall as write, Dictation as listen", async () => {
    const bodies: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push({ path, body });
      if (path === "/api/dictation/items") return ok({ item_id: "it-1" });
      return ok({ attempt_id: "a", correct: true, accent_only: false, accuracy: 1, saved: true, expected: "" });
    });
    const src = { fr: "Merci beaucoup.", en: "Thanks a lot.", steps: [{ fr: "Merci", en: "Thanks" }] };
    await gradeAttempt(src, "Recall", 0, "Merci beaucoup.");
    await gradeAttempt(src, "Dictation", 1, "Merci");
    expect(bodies.map((b) => b.path)).toEqual(["/api/dictation/items", "/api/dictation/attempts", "/api/dictation/attempts"]);
    expect(bodies[0].body).toEqual({ sentence: "Merci beaucoup.", translation_en: "Thanks a lot.", build_up: [{ fr: "Merci", en: "Thanks", new: "" }] });
    expect(bodies[1].body).toEqual({ item_id: "it-1", mode: "write", step: 0, answer: "Merci beaucoup." });
    expect(bodies[2].body).toEqual({ item_id: "it-1", mode: "listen", step: 1, answer: "Merci" });
  });

  it("sentenceKey matches the server's sentence_key and cloze keys use it", () => {
    expect(sentenceKey("  J’ai   oublié Mon RDV ")).toBe("j'ai oublié mon rdv");
    expect(cardKey("cloze", "Oublié")).toBe("cloze:oublié");
    expect(cardKey("listen", "ignored")).toBe("listen");
  });
});
