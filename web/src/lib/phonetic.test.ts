import { describe, expect, it } from "vitest";
import { formatFriendlyPhonetic } from "./phonetic";

describe("formatFriendlyPhonetic", () => {
  it("turns slash IPA with syllable dots into bracket phonetics", () => {
    expect(formatFriendlyPhonetic("/ɔʁ.di.na.tœʁ/")).toBe("[ɔrdinatœr]");
    expect(formatFriendlyPhonetic("/pʁɔ.pɔ.ze/")).toBe("[prɔpɔze]");
    expect(formatFriendlyPhonetic("/e.jɑ̃ de zɔ.bʒɛ.difɛʁ/")).toBe("[ejɑ̃ de zɔbʒɛdifɛr]");
  });

  it("keeps an already-friendly form and drops empty input", () => {
    expect(formatFriendlyPhonetic("[tɔ̃be]")).toBe("[tɔ̃be]");
    expect(formatFriendlyPhonetic("")).toBe("");
    expect(formatFriendlyPhonetic("   ")).toBe("");
    expect(formatFriendlyPhonetic(" / / ")).toBe("");
  });

  it("maps ɡ to g and does not add a second pair of brackets", () => {
    expect(formatFriendlyPhonetic("ɡaʁ")).toBe("[gar]");
    expect(formatFriendlyPhonetic("[prɔpɔze]")).toBe("[prɔpɔze]");
  });
});
