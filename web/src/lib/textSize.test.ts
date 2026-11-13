// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TEXT_SIZE_KEY, applyTextSize, readTextSize, saveTextSize } from "./textSize";

describe("text size", () => {
  afterEach(() => { localStorage.removeItem(TEXT_SIZE_KEY); document.documentElement.style.fontSize = ""; });

  it("defaults to 100% and ignores unknown stored values", () => {
    expect(readTextSize()).toBe(100);
    localStorage.setItem(TEXT_SIZE_KEY, "300");
    expect(readTextSize()).toBe(100);
  });

  it("saves on this device and scales the root font", () => {
    saveTextSize(130);
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe("130");
    expect(document.documentElement.style.fontSize).toBe("130%");
    document.documentElement.style.fontSize = "";
    applyTextSize();
    expect(document.documentElement.style.fontSize).toBe("130%");
    saveTextSize(100);
    expect(document.documentElement.style.fontSize).toBe("");
  });
});
