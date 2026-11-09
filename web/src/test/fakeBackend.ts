/* A small in-memory stand-in for the FastAPI routes the app calls, installed as global fetch in jsdom tests. */
import { buildLibrary, buildQueue, type LibCard } from "../data/fixtures";
import type { ServerCard } from "../api/review";
import { grade } from "../lib/grading";
import { importanceFor, lookupKey } from "../lib/lookup";

const BASE = Date.UTC(2026, 0, 1);
const MODE = { Listen: "listen", Speak: "speak", "Fill-in": "cloze" } as const;
const STATE = { new: "new", learning: "learning", review: "review" } as const;

/** The demo library as the server would hold it (saved cards only). */
function demoSrs() {
  const { sentences, cards } = buildLibrary();
  const byId = new Map(sentences.map((x) => [x.id, x]));
  const toServer = (c: LibCard): ServerCard => {
    const s = byId.get(c.sentenceId)!;
    return {
      id: c.id,
      note_id: c.sentenceId,
      mode: MODE[c.kind],
      target: c.word ?? "",
      target_meta: {},
      due: new Date(BASE).toISOString(),
      importance: 3,
      archived: c.mastered,
      state: STATE[c.status],
      created_at: new Date(BASE + c.savedAt * 1000).toISOString(),
      note: { id: s.id, sentence: s.fr, translation_en: s.en, translation_zh: "" },
    };
  };
  return {
    cards: cards.filter((c) => c.saved).map(toServer),
    /** Today's pool in the demo's order (learning, due, new). */
    queueIds: buildQueue(sentences, cards).map((c) => c.id),
    favorites: new Set<string>(),
    newLimit: 40,
    newToday: 0,
    sessionSize: null as number | null,
  };
}

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
  srs: demoSrs(),
  reset() {
    this.srs = demoSrs();
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
  if (p === "/api/srs/lookups" && method === "POST") {
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
  return srsRoute(method, url, body);
}

function srsRoute(method: string, url: URL, body: Record<string, unknown>): Response {
  const p = url.pathname;
  const db = fake.srs;
  const find = (id: string) => db.cards.find((c) => c.id === id);
  if (p === "/api/srs/queue") {
    // Reviewed cards leave today's queue until they are due again (learning steps come back within minutes).
    const soon = Date.now() + 20 * 60_000;
    const open = db.queueIds.map(find).filter((c): c is ServerCard => !!c && !c.archived && Date.parse(c.due) <= soon);
    const fixed = open.filter((c) => c.state !== "new");
    const fresh = open.filter((c) => c.state === "new").slice(0, Math.max(0, db.newLimit - db.newToday));
    const cards = [...fixed, ...fresh];
    return json(200, {
      cards,
      counts: {
        learning: cards.filter((c) => c.state === "learning").length,
        review: cards.filter((c) => c.state === "review").length,
        new: fresh.length,
        total: cards.length,
        reviewed_today: 0,
        new_today: db.newToday,
        new_limit: db.newLimit,
      },
      day_start: new Date(BASE).toISOString(),
    });
  }
  if (p === "/api/srs/settings" && method === "GET")
    return json(200, { new_limit: db.newLimit, default_new_limit: 10, session_size: db.sessionSize, default_session_size: 40 });
  if (p === "/api/srs/settings" && method === "PUT") {
    const out: Record<string, number> = {};
    if (typeof body.new_limit === "number") out.new_limit = db.newLimit = body.new_limit;
    if (typeof body.session_size === "number") out.session_size = db.sessionSize = body.session_size;
    return json(200, out);
  }
  if (p === "/api/srs/cards") return json(200, { cards: db.cards });
  if (p === "/api/srs/favorites" && method === "GET") return json(200, { words: [...db.favorites] });
  if (p === "/api/srs/favorites" && method === "PUT") {
    const w = lookupKey(String(body.word));
    if (body.favorite) db.favorites.add(w);
    else db.favorites.delete(w);
    return json(200, { word: w, favorite: Boolean(body.favorite) });
  }
  if (p === "/api/srs/lookups" && method === "GET") return json(200, { counts: fake.lookups });
  const m = p.match(/^\/api\/srs\/cards\/([^/]+)\/(review|archive)$/);
  if (m) {
    const c = find(decodeURIComponent(m[1]));
    if (!c) return json(404, { detail: { message: "卡片不存在。" } });
    if (m[2] === "archive") {
      c.archived = Boolean(body.archived);
      return json(200, { id: c.id, archived: c.archived });
    }
    if (c.state === "new") db.newToday++;
    const again = Number(body.rating) === 1;
    c.state = again ? "learning" : "review";
    c.due = new Date(Date.now() + (again ? 10 * 60_000 : 86_400_000)).toISOString();
    return json(200, { ...c, game: {} });
  }
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
