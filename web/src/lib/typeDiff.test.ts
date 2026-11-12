import { describe, expect, it } from "vitest";
import { typeDiff } from "./typeDiff";

describe("typeDiff", () => {
  it("equal answers have only matches", () => expect(typeDiff("autorisé", "autorisé").every(c => c.match)).toBe(true));
  it("aligns an extra letter", () => expect(typeDiff("autorissé", "autorisé").filter(c => !c.match)).toEqual([{ typed: "s", correct: "", match: false }]));
  it("aligns a missing letter", () => expect(typeDiff("avon", "avons").at(-1)).toEqual({ typed: "", correct: "s", match: false }));
  it("keeps accent differences", () => expect(typeDiff("ete", "été").filter(c => !c.match)).toHaveLength(2));
  it("compares a whole phrase", () => {
    const diff = typeDiff("tout suite", "tout de suite");
    expect(diff.filter(c => !c.typed).map(c => c.correct).join("")).toBe(" de");
    expect(diff.map(c => c.typed).join("")).toBe("tout suite");
    expect(diff.map(c => c.correct).join("")).toBe("tout de suite");
  });
  it("normalizes NFC", () => expect(typeDiff("e\u0301", "é")).toEqual([{ typed: "é", correct: "é", match: true }]));
  it.each(["Adossé", "ADOSSÉ"])("ignores case in %s while preserving display", typed => {
    const diff = typeDiff(typed, "adossé");
    expect(diff.every(c => c.match)).toBe(true);
    expect(diff.map(c => c.typed).join("")).toBe(typed);
    expect(diff.map(c => c.correct).join("")).toBe("adossé");
  });
  it("keeps only the real accent mismatch in mixed case phrases", () => {
    expect(typeDiff("ADOSSÉ Ici", "adosse ici").filter(c => !c.match)).toEqual([{ typed: "É", correct: "e", match: false }]);
    expect(typeDiff("adossé", "adosse").filter(c => !c.match)).toHaveLength(1);
  });
  it("handles empty strings and non-BMP characters", () => {
    expect(typeDiff("", "à")).toEqual([{ typed: "", correct: "à", match: false }]);
    expect(typeDiff("😀", "")).toEqual([{ typed: "😀", correct: "", match: false }]);
  });
});
