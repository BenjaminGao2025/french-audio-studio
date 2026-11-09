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

function demoEpisodes() {
  return [
    {
      id: "e1",
      title: "Un samedi au marché",
      status: "ready",
      duration: 1200,
      error: null,
      created_at: new Date(BASE).toISOString(),
      settings: { level: "A2", minutes: 20, request: "" },
    },
  ] as Record<string, unknown>[];
}

const gameState = () => ({
  level: 3,
  level_xp: 20,
  next_level_xp: 180,
  progress: 0.33,
  xp: 140,
  max_level: 1000,
  hours_total: 2.3,
  today: { day: "2026-01-01", minutes: 25, target: 60, family_day: false, weekend: false, by_lane: { reading: 15, review: 10 }, logs: [], kills: 4, deaths: 1, best_combo: 3 },
  week: {
    number: 1,
    start: "2026-01-01",
    end: "2026-01-07",
    minutes: 25,
    target: 1440,
    maintenance: false,
    by_lane: { reading: 15, review: 10 },
    lane_targets: { listening: 480, reading: 240, speaking: 240, writing: 240, review: 240 },
    lane_weights: { car: 0.5 },
    focus_skill: { skill: "speaking", minutes: 0, target: 240 },
  },
  streak_days: 2,
  days_studied_7d: 2,
});

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
  /** Saved Study analyses (/api/history?type=study), newest first. */
  studyRecords: [] as Record<string, unknown>[],
  /** Recall/Dictation attempts as /api/dictation/history returns them, newest first. */
  attempts: [] as Record<string, unknown>[],
  episodes: demoEpisodes(),
  /** Seconds received by /api/game/heartbeat, by lane. */
  heartbeats: {} as Record<string, number>,
  reset() {
    this.srs = demoSrs();
    this.studyRecords = [];
    this.attempts = [];
    this.episodes = demoEpisodes();
    this.heartbeats = {};
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
    return json(200, { attempt_id: `a-${++seq}`, correct: g.correct, accent_only: false, accuracy: g.correct ? 100 : 50, saved, expected });
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
  if (p === "/api/history" && method === "POST") {
    fake.studyRecords.unshift({ id: `h-${++seq}`, type: "study", created_at: new Date().toISOString(), ...(body.payload as object), text: String((body.payload as { text?: string })?.text ?? "") });
    return json(200, { ok: true });
  }
  if (p === "/api/history" && method === "GET") return json(200, { records: fake.studyRecords.slice(0, Number(url.searchParams.get("limit") ?? 50)), count: fake.studyRecords.length });
  if (p === "/api/history" && method === "DELETE") {
    const deleted = fake.studyRecords.length;
    fake.studyRecords = [];
    return json(200, { deleted });
  }
  if (p === "/api/dictation/history" && method === "GET") return json(200, { attempts: fake.attempts, total: fake.attempts.length });
  if (p === "/api/dictation/history" && method === "DELETE") {
    const deleted = fake.attempts.length;
    fake.attempts = [];
    return json(200, { deleted });
  }
  if (p === "/api/episodes" && method === "GET")
    return json(200, { episodes: fake.episodes, hours: 0.3, recommended_level: "A2", levels: ["A1", "A2", "B1", "B2"], lengths: [20, 30, 45, 60] });
  if (p.startsWith("/api/episodes/") && method === "DELETE") {
    const id = p.split("/").pop();
    fake.episodes = fake.episodes.filter((e) => e.id !== id);
    return json(200, { success: true });
  }
  if (/^\/episodes\/[^/]+\.lrc$/.test(p)) return new Response("[00:00.00]Bonjour à tous.\n[00:04.50]On va au marché. / We go to the market.\n", { status: 200 });
  if (p === "/api/game/heartbeat") {
    fake.heartbeats[String(body.lane)] = (fake.heartbeats[String(body.lane)] ?? 0) + Number(body.seconds);
    return json(200, { ok: true });
  }
  if (p === "/api/game/state" || p === "/api/game/log" || p === "/api/game/family-day" || p.startsWith("/api/game/log/")) return json(200, gameState());
  if (p === "/api/game/study-time")
    return json(200, {
      today_seconds: 1500, week_seconds: 1500, total_seconds: 8280, day: "2026-01-01", week_start: "2026-01-01", timezone: "America/Vancouver",
      goal_hours: 1000, progress: 0.0023, remaining_seconds: 3_591_720, average_week_seconds: 1500, projected_finish: null,
    });
  if (p === "/api/game/days")
    return json(200, { days: [{ day: "2026-01-01", seconds: 1500, manual_seconds: 600, lanes: { reading: 900, review: 600 } }] });
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
