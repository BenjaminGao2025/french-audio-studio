import { describe, expect, it } from "vitest";
import { planSession, type ReviewCard } from "../data/fixtures";
import { grade } from "./grading";
import { countLookup, importanceFor, lookupKey, wordIsSaved, type LookupCounter } from "./lookup";
import { countedMinutesFor, mergeIntervals, pace, splitAtMidnight } from "./progress";

const T = "J’ai oublié mon rendez-vous.";

describe("grading", () => {
  it.each([
    ["NFD answer", "Les représentants ont résolu d'exposer les droits.", "Les représentants ont résolu d'exposer les droits".normalize("NFD")],
    ["NFD target", "Les représentants ont résolu d'exposer les droits.".normalize("NFD"), "Les représentants ont résolu d'exposer les droits"],
    ["curly answer", "d'exposer", "d’exposer"],
    ["curly target", "d’exposer", "d'exposer"],
    ["Ben's exact pair", "Les représentants ont résolu d'exposer les droits.", "Les représentants ont résolu d'exposer les droits"],
    ["prime apostrophe", "d'exposer", "d′exposer"],
  ])("fully accepts %s", (_, target, answer) => {
    const r = grade(target, answer);
    expect(r.correct).toBe(true);
    expect(r.accuracy).toBe(100);
    expect(r.alignment.every(w => w.mark === "ok")).toBe(true);
    expect(r.counts.accent + r.counts.different + r.counts.missing + r.counts.extra).toBe(0);
  });
  it("accepts equivalent forms", () => {
    expect(grade(T, "j'ai oublié mon rendez vous").correct).toBe(true);
    expect(grade(T, "  J’ai   OUBLIÉ mon rendez-vous ").correct).toBe(true);
    expect(grade("Ma sœur arrive.", "ma soeur arrive").correct).toBe(true);
  });
  it("is strict on accents and apostrophes", () => {
    expect(grade("C’était l’été.", "c’était l’ete").correct).toBe(false);
    expect(grade("Ça va.", "ca va").issues[0].kind).toBe("accent");
    expect(grade(T, "jai oublié mon rendez-vous").issues[0].kind).toBe("different");
  });
  it("scores the aligned reference with half credit for accents", () => {
    const r = grade("Ma machine à laver fuit.", "Ma machine a lav fui");
    expect(r.accuracy).toBe(50);
    expect(r.counts).toEqual({ ok: 2, accent: 1, different: 2, missing: 0, extra: 0 });
    expect(r.alignment).toEqual([
      { mark: "ok", given: "Ma", expected: "Ma" },
      { mark: "ok", given: "machine", expected: "machine" },
      { mark: "accent", given: "a", expected: "à" },
      { mark: "different", given: "lav", expected: "laver" },
      { mark: "different", given: "fui", expected: "fuit" },
    ]);
  });
  it("includes extras in the score denominator and keeps missing words in alignment order", () => {
    const r = grade("Ma machine à laver fuit.", "Oh Ma machine à laver fuit vraiment");
    expect(r.accuracy).toBe(71);
    expect(r.counts.extra).toBe(2);
    const missing = grade("Ma machine à laver fuit.", "Ma machine fuit");
    expect(missing.alignment.map(w => w.mark)).toEqual(["ok", "ok", "missing", "missing", "ok"]);
    expect(missing.accuracy).toBe(60);
    expect(grade("Rendez-vous ici !", "RENDEZ vous ici").accuracy).toBe(100);
  });
  it("labels the prompt examples", () => {
    const accent = grade(T, "J’ai oublie mon rendez-vous.");
    expect(accent.issues).toEqual([{ kind: "accent", expected: "oublié", given: "oublie" }]);
    const missing = grade(T, "J’ai oublié rendez-vous.");
    expect(missing.issues).toEqual([{ kind: "missing", expected: "mon" }]);
    const word = grade(T, "J’ai oublié mon billet.");
    expect(word.issues[0]).toMatchObject({ kind: "different", given: "billet" });
    expect(word.target[3].mark).toBe("different");
  });
});

describe("lookup", () => {
  it("normalizes keys without merging forms", () => {
    expect(lookupKey("  J’ai   failli ")).toBe("j'ai failli");
    expect(lookupKey("failli")).not.toBe(lookupKey("faillir"));
    expect(lookupKey("sœur")).not.toBe(lookupKey("soeur"));
    expect(lookupKey("Rendez-vous")).toBe("rendez-vous");
  });
  it("shares elision keys and saved membership without changing phrases", () => {
    for (const prefix of ["l", "d", "j", "n", "m", "t", "s", "c", "qu", "jusqu", "lorsqu", "puisqu"]) {
      for (const apostrophe of ["'", "’"]) expect(lookupKey(`${prefix}${apostrophe}homme`)).toBe("homme");
    }
    expect(lookupKey(" L’HOMME ")).toBe(lookupKey("homme"));
    expect(lookupKey("droits de l'homme")).toBe("droits de l'homme");
    expect(wordIsSaved([{saved:true, mode:"cloze", kind:"Fill-in", word:"l'homme"}], "homme")).toBe(true);
  });
  it("throttles from the last counted event", () => {
    let c: LookupCounter = { count: 0, lastCounted: null };
    const counts = [0, 4, 4.999, 5.0, 6, 9, 11].map((t) => {
      c = countLookup(c, t).next;
      return c.count;
    });
    expect(counts).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });
  it("maps counts to importance", () => {
    expect([0, 1, 3, 5, 10].map(n => importanceFor(n, true))).toEqual([3, 3, 4, 5, 5]);
    expect([0, 1, 3, 5, 10].map(n => importanceFor(n, false))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("audio time", () => {
  it("counts wall-clock time", () => {
    expect(countedMinutesFor(10, 2)).toBe(5);
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 25 }])).toEqual([
      { start: 0, end: 15 },
      { start: 20, end: 25 },
    ]);
    const day = 86_400_000;
    expect(splitAtMidnight({ start: day - 1000, end: day + 1000 }, 0)).toHaveLength(2);
  });
  it("computes the pace fixture", () => {
    const p = pace(125, 14, new Date(Date.UTC(2026, 2, 4)));
    expect(p.remainingHours).toBe(875);
    expect(p.dailyAverageMinutes).toBe(30);
    expect(p.etaDays).toBe(1750);
    expect(pace(125, 0, new Date()).etaDate).toBeNull();
    expect(pace(1003, 14, new Date()).etaDays).toBeNull();
  });
});

describe("planSession (cards per review session)", () => {
  const card = (id: string, group: ReviewCard["group"]): ReviewCard => ({ id, sentenceId: `s-${id}`, group, kind: "Listen", prompt: "", target: "", sentenceFr: "" });
  const make = (learning: number, due: number, fresh: number) => [
    ...Array.from({ length: learning }, (_, i) => card(`l${i}`, "learning")),
    ...Array.from({ length: due }, (_, i) => card(`d${i}`, "due")),
    ...Array.from({ length: fresh }, (_, i) => card(`n${i}`, "new")),
  ];

  it("defaults give 8 learning + 1 due + 31 new, bound by the session size", () => {
    const p = planSession(make(8, 1, 200), { sessionSize: 40, dailyNew: 40, newUsed: 0 });
    expect([p.learning, p.due, p.newCount, p.cards.length]).toEqual([8, 1, 31, 40]);
    expect(p.binding).toBe("session");
    expect(p.waiting).toBe(0);
  });

  it("is bound by the daily allowance when it is the smallest of the three", () => {
    const p = planSession(make(8, 1, 200), { sessionSize: 100, dailyNew: 40, newUsed: 15 });
    expect(p.newCount).toBe(25);
    expect(p.binding).toBe("daily");
    expect(p.remainingAllowances).toBe(25);
  });

  it("is bound by the library when fewer new cards are waiting than either limit", () => {
    const p = planSession(make(8, 1, 5), { sessionSize: 40, dailyNew: 40, newUsed: 0 });
    expect(p.newCount).toBe(5);
    expect(p.newAvailable).toBe(5);
    expect(p.binding).toBe("library");
  });

  it("takes learning and due first without using allowances, adds no new cards and counts the cards that wait", () => {
    const p = planSession(make(12, 3, 50), { sessionSize: 10, dailyNew: 40, newUsed: 0 });
    expect(p.cards).toHaveLength(10);
    expect(p.cards.every((c) => c.group === "learning")).toBe(true);
    expect(p.newCount).toBe(0);
    expect(p.waiting).toBe(5);
    // Learning and due cards ignore the allowance: with 0 allowances they are still planned.
    const none = planSession(make(8, 1, 50), { sessionSize: 40, dailyNew: 0, newUsed: 0 });
    expect([none.learning, none.due, none.newCount]).toEqual([8, 1, 0]);
    expect(none.binding).toBe("daily");
  });

  it("leaves out cards finished earlier today, so another session only holds what remains", () => {
    const queue = make(8, 1, 50);
    const done = Object.fromEntries(queue.slice(0, 20).map((c) => [c.id, true]));
    const p = planSession(queue, { sessionSize: 10, dailyNew: 40, newUsed: 11, done });
    expect(p.learning + p.due).toBe(0);
    expect(p.cards.every((c) => !done[c.id])).toBe(true);
    expect(p.newCount).toBe(10);
  });
});
