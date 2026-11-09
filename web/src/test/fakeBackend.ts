/* A small in-memory stand-in for the FastAPI routes the app calls, installed as global fetch in jsdom tests. */
import { grade } from "../lib/grading";
import { importanceFor, lookupKey } from "../lib/lookup";

interface Item {
  sentence: string;
  build_up: { fr: string }[];
}

export const fake = {
  /** Server-side lookup counts by lookupKey. */
  lookups: {} as Record<string, number>,
  /** Path prefixes whose next request fails with a 503. */
  failNext: new Set<string>(),
  /** The next N graded attempts report saved: false (history write failed). */
  saveFails: 0,
  /** Response delay in ms. */
  delay: 40,
  calls: [] as { method: string; path: string; body: unknown }[],
  items: new Map<string, Item>(),
  reset() {
    this.lookups = {};
    this.failNext.clear();
    this.saveFails = 0;
    this.delay = 40;
    this.calls = []; // items stay: the app caches item ids for the page's lifetime
  },
};

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let seq = 0;

function route(method: string, url: URL, body: Record<string, unknown>): Response {
  const p = url.pathname;
  if (p === "/api/auth/session") return new Response(null, { status: 204 });
  if (p === "/api/dictation/items") {
    const id = `item-${++seq}`;
    fake.items.set(id, { sentence: String(body.sentence), build_up: (body.build_up as { fr: string }[]) ?? [] });
    return json(200, { item_id: id });
  }
  if (p === "/api/dictation/attempts") {
    const item = fake.items.get(String(body.item_id));
    if (!item) return json(404, { detail: "Item not found" });
    const step = Number(body.step);
    const expected = step === 0 ? item.sentence : item.build_up[step - 1]?.fr;
    if (!expected) return json(422, { detail: "Bad step" });
    const g = grade(expected, String(body.answer));
    const saved = fake.saveFails > 0 ? (fake.saveFails--, false) : true;
    return json(200, { attempt_id: `a-${++seq}`, correct: g.correct, accent_only: false, accuracy: g.correct ? 1 : 0.5, saved, expected });
  }
  if (p === "/api/lookup") {
    const word = url.searchParams.get("word") ?? "";
    return json(200, { token: word, lemma: word, pos: "", phonetic: "", explanation_cn: "", explanation_en: `dictionary: ${word}` });
  }
  if (p === "/api/srs/lookups") {
    const k = lookupKey(String(body.word));
    const count = (fake.lookups[k] ?? 0) + 1;
    fake.lookups[k] = count;
    return json(200, { count, importance: importanceFor(count), incremented: true });
  }
  if (p === "/api/srs/notes/lookup") return json(200, { notes: [] });
  if (p === "/api/srs/notes") {
    const id = `note-${++seq}`;
    const cards = [
      ...((body.modes as string[]) ?? []).map((m) => ({ id: `c-${++seq}`, note_id: id, mode: m, target: "", target_meta: {}, archived: false })),
      ...((body.targets as { text: string }[]) ?? []).map((t) => ({ id: `c-${++seq}`, note_id: id, mode: "cloze", target: t.text, target_meta: {}, archived: false })),
    ];
    return json(200, { id, sentence: body.sentence, translation_en: body.translation_en, translation_zh: body.translation_zh, cards });
  }
  if (p === "/api/history") return json(200, { ok: true });
  return json(404, { detail: `No fake route for ${method} ${p}` });
}

export function installFakeBackend() {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    fake.calls.push({ method, path: url.pathname, body });
    await new Promise((r) => setTimeout(r, fake.delay));
    for (const prefix of fake.failNext) {
      if (url.pathname.startsWith(prefix)) {
        fake.failNext.delete(prefix);
        return json(503, { detail: "Service unavailable" });
      }
    }
    return route(method, url, body);
  }) as typeof fetch;
}
