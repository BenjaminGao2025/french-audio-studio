import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { findContextSpans } from "./FrText";

const fixture: { context_spans: { sentence: string; word: string; spans: [number, number][] }[] } = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/word_context_cases.json", import.meta.url), "utf8"),
);
it.each(fixture.context_spans)("matches the server's contextual spans: $word in $sentence", ({ sentence, word, spans }) => {
  expect(findContextSpans(sentence, word)).toEqual(spans);
});
