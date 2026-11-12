// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { lookupWord, recordLookup, resetLookupCaches } from "./lookup";

afterEach(() => { vi.restoreAllMocks(); resetLookupCaches(); });

it("keeps surface case and sentence POS separate in the dictionary cache", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ entries: [] }), { status: 200 }));
  await lookupWord("ma", "det");
  await lookupWord("MA");
  await lookupWord("ma", "noun");
  await lookupWord("ma", "det");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/lookup?word=ma&pos=det", "/api/lookup?word=MA&pos=", "/api/lookup?word=ma&pos=noun",
  ]);
});

it("passes both original sentence translations to lookup auto-save", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ count: 1 }), { status: 200 }));
  await recordLookup("ma", { fr: "J’ai laissé ma carte.", en: "", raw: { translation_en: "I left my card.", translation_zh: "我落下了我的卡。" } });
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({ translation_en: "I left my card.", translation_zh: "我落下了我的卡。" });
});
