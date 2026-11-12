// The client grader must give exactly the server's result (dictation.py), which decides right or wrong.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { grade, tokenize } from "./grading";

interface Fixture {
  accent_credit: number;
  tokenize: { text: string; tokens: string[]; norms: string[] }[];
  grade: {
    name: string;
    expected: string;
    answer: string;
    result: {
      ops: { kind: string; expected: string; actual: string }[];
      counts: Record<string, number>;
      accuracy: number;
      correct: boolean;
    };
  }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/dictation_cases.json", import.meta.url), "utf8"),
);

describe("grading.ts matches dictation.py on every shared fixture case", () => {
  it.each(fixture.tokenize.map((c) => [c.text, c] as const))("tokenize %s", (_, c) => {
    const keys = tokenize(c.text).keys;
    expect(keys.map((k) => k.text)).toEqual(c.tokens);
    expect(keys.map((k) => k.key)).toEqual(c.norms);
  });

  it.each(fixture.grade.map((c) => [c.name, c] as const))("grade: %s", (_, c) => {
    const r = grade(c.expected, c.answer);
    expect(r.accuracy).toBe(c.result.accuracy);
    expect(r.correct).toBe(c.result.correct);
    expect(r.alignment.map((op) => ({ kind: op.mark === "different" ? "wrong" : op.mark, expected: op.expected ?? "", actual: op.given ?? "" })))
      .toEqual(c.result.ops);
    const { wrong, ...rest } = c.result.counts;
    expect(r.counts).toEqual({ ...rest, different: wrong });
  });
});
