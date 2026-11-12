import { expect, it } from "vitest";
import { explanationParts } from "./MarkedExplanation";

it("preserves exact phrases and both elision apostrophes as marked units", () => {
  const parts = explanationParts("With ⟦Les représentants⟧, ⟦l'homme⟧ sees ⟦l’homme⟧.");
  expect(parts.filter(part => part.french).map(part => part.text)).toEqual(["Les représentants", "l'homme", "l’homme"]);
  expect(parts.map(part => part.text).join("")).toBe("With Les représentants, l'homme sees l’homme.");
});
it.each(["⟦avoir", "⟦⟦avoir⟧⟧", "⟦avoir⟧ and résolu⟧"])("drops malformed marks without guessing links: %s", text => {
  const parts = explanationParts(text);
  expect(parts.every(part => !part.french)).toBe(true);
  expect(parts.map(part => part.text).join("")).not.toMatch(/[⟦⟧]/);
});
