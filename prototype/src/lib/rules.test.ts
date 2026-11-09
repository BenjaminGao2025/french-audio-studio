import { describe, expect, it } from "vitest";
import { grade } from "./grading";
import { countLookup, importanceFor, lookupKey, type LookupCounter } from "./lookup";
import { countedMinutesFor, mergeIntervals, pace, splitAtMidnight } from "./progress";

const T = "J’ai oublié mon rendez-vous.";

describe("grading", () => {
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
  it("throttles from the last counted event", () => {
    let c: LookupCounter = { count: 0, lastCounted: null };
    const counts = [0, 4, 4.999, 5.0, 6, 9, 11].map((t) => {
      c = countLookup(c, t).next;
      return c.count;
    });
    expect(counts).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });
  it("maps counts to importance", () => {
    expect([0, 4, 5, 6, 9, 10].map(importanceFor)).toEqual([3, 3, 4, 4, 4, 5]);
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
