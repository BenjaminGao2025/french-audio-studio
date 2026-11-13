import { describe, expect, it } from "vitest";
import { letterDiff } from "./letterDiff";

describe("letterDiff", () => {
  it("marks only the letters that differ", () => {
    expect(letterDiff("activities", "activités")).toEqual({
      given: [{ text: "activit", diff: false }, { text: "ie", diff: true }, { text: "s", diff: false }],
      expected: [{ text: "activit", diff: false }, { text: "é", diff: true }, { text: "s", diff: false }],
    });
  });
  it("marks an accent slip as one letter", () => {
    const d = letterDiff("societe", "société");
    expect(d.expected.filter((r) => r.diff).map((r) => r.text)).toEqual(["é", "é"]);
    expect(d.given.filter((r) => r.diff).map((r) => r.text)).toEqual(["e", "e"]);
  });
  it("marks a missing letter in the expected word only", () => {
    const d = letterDiff("aprendre", "apprendre");
    expect(d.given.every((r) => !r.diff)).toBe(true);
    expect(d.expected.filter((r) => r.diff).map((r) => r.text)).toEqual(["p"]);
  });
  it("keeps the whole word when the words share nothing", () => {
    expect(letterDiff("xyz", "abc")).toEqual({ given: [{ text: "xyz", diff: true }], expected: [{ text: "abc", diff: true }] });
  });
});
