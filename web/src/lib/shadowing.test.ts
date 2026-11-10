import { describe, expect, it } from "vitest";
import { evaluateShadowing, frenchPhoneticNormalize } from "./shadowing";

describe("shadowing feedback", () => {
  it("matches accents and punctuation without treating pronounced endings as silent", () => {
    expect(evaluateShadowing("J’ai oublié mes clés !", "j'ai oublie mes cles").score).toBe(100);
    expect(frenchPhoneticNormalize("parlent")).toBe(frenchPhoneticNormalize("parle"));
    expect(frenchPhoneticNormalize("comment")).not.toBe(frenchPhoneticNormalize("comme"));
    expect(frenchPhoneticNormalize("fils")).not.toBe(frenchPhoneticNormalize("fil"));
  });
  it("aligns a missed word without marking the rest of the sentence wrong", () => {
    const r = evaluateShadowing("Je prends le petit train", "Je prends le train");
    expect(r.words.map((w) => w.status)).toEqual(["correct", "correct", "correct", "missed", "correct"]);
    expect(r.completeness).toBe(80);
  });
  it("shows and penalises inserted speech without losing matched words", () => {
    const r = evaluateShadowing("Je vais bien", "Je vais vraiment bien");
    expect(r.extras).toEqual(["vraiment"]);
    expect(r.completeness).toBe(100);
    expect(r.accuracy).toBe(75);
  });
  it("does not give credit to silence or repeated words that were not spoken", () => {
    expect(evaluateShadowing("Bonjour", "").score).toBe(0);
    expect(evaluateShadowing("très très bien", "très bien").words.filter((w) => w.status === "missed")).toHaveLength(1);
  });
});
