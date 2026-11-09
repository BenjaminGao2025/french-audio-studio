import { describe, expect, it } from "vitest";
import { parseLrc } from "./episodes";

describe("parseLrc", () => {
  it("reads timestamps, splits a cue's second line and skips blanks and tags", () => {
    const cues = parseLrc("[ti:Le marché]\n[00:00.00]Bonjour.\n[01:02.5]On y va. / Let's go.\n[01:05.00]   \nnot a cue\n");
    expect(cues).toEqual([
      { at: 0, text: "Bonjour.", sub: undefined },
      { at: 62.5, text: "On y va.", sub: "Let's go." },
    ]);
  });
});
