import { describe, expect, it } from "vitest";
import { blankOut, ratingFor, toLibrary, toReviewCard, type ServerCard } from "./review";
import { dueIn } from "../screens/Review";

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
    expect(toReviewCard(card({ id: "r", mode: "recognize", target: "j'ai" }))).toMatchObject({ kind: "Fill-in", prompt: "_____ oublié mon rendez-vous." });
    expect(
      toReviewCard(card({ id: "g", mode: "grammar", target: "passé composé", target_meta: { prompt_fr: "Hier, il ____ parti.", answer: "est" } })),
    ).toMatchObject({ kind: "Fill-in", prompt: "Hier, il ____ parti.", target: "est", sentenceFr: "Hier, il est parti." });
    // A word that isn't in the sentence becomes a whole-sentence Recall from the meaning.
    expect(toReviewCard(card({ id: "x", mode: "cloze", target: "chat" }))).toMatchObject({ kind: "Recall", prompt: "I forgot my appointment.", target: "J’ai oublié mon rendez-vous." });
  });

  it("blankOut ignores case and apostrophe style and never blanks a missing word", () => {
    expect(blankOut("C’est la vie.", "c'est")).toBe("_____ la vie.");
    expect(blankOut("C’est la vie.", "")).toBeNull();
    expect(blankOut("C’est la vie.", "mort")).toBeNull();
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
