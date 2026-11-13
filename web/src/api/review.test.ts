import { describe, expect, it } from "vitest";
import { blankOut, ratingFor, toLibrary, toReviewCard, type ServerCard } from "./review";
import { compactDue, dueIn, shortSavedDate } from "../screens/Review";

const card = (p: Partial<ServerCard> & Pick<ServerCard, "id" | "mode">): ServerCard => ({
  note_id: "n1",
  target: "",
  target_meta: {},
  due: "2026-01-01T00:00:00Z",
  importance: 3,
  archived: false,
  state: "new",
  created_at: "2026-01-01T00:00:00Z",
  note: { id: "n1", sentence: "J’ai oublié mon rendez-vous.", translation_en: "I forgot my appointment.", translation_zh: "我忘了预约。" },
  ...p,
});

describe("toReviewCard", () => {
  it("maps listen, speak and cloze, and the server state to the session group", () => {
    expect(toReviewCard(card({ id: "a", mode: "listen", state: "learning" }))).toMatchObject({ kind: "Listen", group: "learning", target: "J’ai oublié mon rendez-vous." });
    expect(toReviewCard(card({ id: "b", mode: "speak", state: "review" }))).toMatchObject({ kind: "Speak", group: "due", prompt: "I forgot my appointment." });
    expect(toReviewCard(card({ id: "c", mode: "cloze", target: "oublié", state: "relearning" }))).toMatchObject({
      kind: "Fill-in",
      group: "learning",
      prompt: "J’ai _____ mon rendez-vous.",
      target: "oublié",
    });
  });

  it("old word and grammar cards fall back to questions the screen knows", () => {
    expect(toReviewCard(card({ id: "r", mode: "recognize", target: "j'ai" }))).toMatchObject({ kind: "Recall", prompt: "", target: "j'ai" });
    expect(
      toReviewCard(card({ id: "g", mode: "grammar", target: "passé composé", target_meta: { prompt_fr: "Hier, il ____ parti.", answer: "est" } })),
    ).toMatchObject({ kind: "Fill-in", prompt: "Hier, il ____ parti.", target: "est", sentenceFr: "Hier, il est parti." });
    // A nested word keeps its target even when the sentence cannot supply a blank.
    expect(toReviewCard(card({ id: "x", mode: "cloze", target: "chat" }))).toMatchObject({ kind: "Recall", mode: "recognize", prompt: "", target: "chat" });
  });

  it("presents short, mostly blanked, or untranslated legacy clozes as Recall", () => {
    for (const [sentence, target, en] of [["Nous partons.", "partons", "We leave."], ["Nous allons à la gare.", "allons à la gare", "We go to the station."], ["Nous avons pris le bus.", "avons", ""]]) {
      expect(toReviewCard(card({ id: "cue-test", mode: "cloze", target, note: { id: "n", sentence, translation_en: en, translation_zh: "" } }))).toMatchObject({ mode: "recognize", kind: "Recall", target });
    }
  });

  it("keeps either or both sentence cues on a usable Fill-in", () => {
    for (const [en, zh] of [["We took the bus.", "我们坐了公交车。"], ["We took the bus.", ""], ["", "我们坐了公交车。"]]) {
      expect(toReviewCard(card({ id: "cue-test", mode: "cloze", target: "avons", note: { id: "n", sentence: "Nous avons pris le bus.", translation_en: en, translation_zh: zh } }))).toMatchObject({ kind: "Fill-in", translationEn: en, translationZh: zh });
    }
  });

  it("keeps a recognize target even when its lemma is absent from the sentence", () => {
    expect(toReviewCard(card({ id: "r-missing", mode: "recognize", target: " oublier " }))).toMatchObject({
      mode: "recognize", kind: "Recall", prompt: "", target: "oublier", sentenceFr: "J’ai oublié mon rendez-vous.",
    });
  });

  it("blankOut ignores case and apostrophe style and never blanks a missing word", () => {
    expect(blankOut("C’est la vie.", "c'est")).toBe("_____ la vie.");
    expect(blankOut("C’est la vie.", "")).toBeNull();
    expect(blankOut("C’est la vie.", "mort")).toBeNull();
  });

  it("blankOut only blanks whole words, like the server's target_in_sentence", () => {
    expect(blankOut("Oui, mais j’ai laissé ma carte à la maison.", "ma")).toBe("Oui, mais j’ai laissé _____ carte à la maison.");
    expect(blankOut("Je prends le train.", "en")).toBeNull();
    expect(blankOut("Voici l’homme.", "l'")).toBe("Voici _____homme.");
    expect(blankOut("Voici l’homme.", "homme")).toBe("Voici l’_____.");
  });
});

describe("ratings and dates", () => {
  it("rates Again for wrong or answer shown, Hard with a hint, otherwise Good", () => {
    expect(ratingFor({ correct: false })).toBe(1);
    expect(ratingFor({ correct: true, answerKnown: true })).toBe(1);
    expect(ratingFor({ correct: true, hinted: true })).toBe(2);
    expect(ratingFor({ correct: true })).toBe(3);
  });

  it("says when the card comes back", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(dueIn("2026-01-01T00:10:00Z", now)).toBe("in 10 minutes");
    expect(dueIn("2026-01-02T00:00:00Z", now)).toBe("tomorrow");
    expect(dueIn("2026-01-05T00:00:00Z", now)).toBe("in 4 days");
  });
});

describe("Saved compact labels", () => {
  it("compactDue is compact and stays on one line", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(compactDue("2026-01-01T00:00:00Z", now)).toBe("now");
    expect(compactDue("2026-01-01T00:12:00Z", now)).toBe("12 min");
    expect(compactDue("2026-01-01T03:00:00Z", now)).toBe("3 h");
    expect(compactDue("2026-01-03T00:00:00Z", now)).toBe("2 d");
    expect(compactDue("2025-12-30T00:00:00Z", now)).toBe("overdue 2 d");
    expect(compactDue(undefined, now)).toBe("—");
  });

  it("shortSavedDate omits the year when it is the current year", () => {
    const now = new Date(Date.UTC(2026, 10, 9, 12));
    const sameYear = shortSavedDate(Date.UTC(2026, 10, 9, 12), now);
    expect(sameYear).not.toContain("2026");
    expect(sameYear).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/); // "9 Nov"
    expect(shortSavedDate(Date.UTC(2025, 10, 9, 12), now)).toContain("2025"); // "9 Nov 2025"
    expect(shortSavedDate(0, now)).toBe("—");
  });
});

describe("toLibrary", () => {
  it("numbers sentences from the oldest and keeps archived cards as mastered", () => {
    const n2 = { id: "n2", sentence: "Bonjour.", translation_en: "", translation_zh: "你好。" };
    const lib = toLibrary([
      card({ id: "a", mode: "listen", note_id: "n2", note: n2, created_at: "2026-02-01T00:00:00Z" }),
      card({ id: "b", mode: "cloze", target: "oublié", archived: true, state: "review" }),
    ]);
    expect(lib.sentences.map((s) => [s.id, s.number, s.en])).toEqual([
      ["n1", 1, "I forgot my appointment."],
      ["n2", 2, "你好。"],
    ]);
    expect(lib.cards.find((c) => c.id === "b")).toMatchObject({ kind: "Fill-in", word: "oublié", mastered: true, status: "review", saved: true });
  });
});
