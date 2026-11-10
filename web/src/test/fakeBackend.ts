/* A small in-memory stand-in for the FastAPI routes the app calls, installed as global fetch in jsdom tests. */
import { buildLibrary, buildQueue, type LibCard } from "../data/fixtures";
import type { ServerCard } from "../api/review";
import { grade } from "../lib/grading";
import { importanceFor, lookupKey } from "../lib/lookup";

const BASE = Date.UTC(2026, 0, 1);
const MODE = { Listen: "listen", Speak: "speak", "Fill-in": "cloze" } as const;
const STATE = { new: "new", learning: "learning", review: "review" } as const;

/** Seconds to the next review for Again/Hard/Good/Easy, as srs._preview_intervals returns. */
const PREVIEW_INTERVALS: Record<string, number> = { 1: 60, 2: 600, 3: 86400, 4: 345600 };

/** The meaning snapshot kept when a word card was saved (no live lookup needed to review it). */
function wordMeta(word: string): Record<string, string> {
  return {
    meaning_zh: "这个词的意思", meaning_en: "the meaning of this word",
    ctx_zh: "它在这句话里的意思", ctx_en: "what it means here",
    dict_zh: "词典释义", dict_en: "dictionary gloss",
    why_zh: "为什么这里用这个词。", hook: "一个记忆钩子。",
    lemma: word, pos: "noun", ipa: "ipa", snap: "1",
  };
}

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
      target_meta: c.word ? wordMeta(c.word) : {},
      intervals: { ...PREVIEW_INTERVALS },
      due: new Date(BASE).toISOString(),
      importance: 3,
      archived: c.mastered,
      state: STATE[c.status],
      created_at: new Date(BASE + c.savedAt * 1000).toISOString(),
      note: {
        id: s.id, sentence: s.fr, translation_en: s.en, translation_zh: "中文翻译。",
        extra: { grammar: [{ title: "passé composé", explanation: "An auxiliary plus a past participle.", hook: " hier = yesterday" }] },
      },
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

const demoDevices = () => [
  { id: "d1", device: "Chrome on Linux", created_at: "2026-01-01T10:00:00Z", last_seen_at: "2026-01-02T10:00:00Z", current: true },
  { id: "d2", device: "Safari on iPhone", created_at: "2026-01-01T09:00:00Z", last_seen_at: "2026-01-01T12:00:00Z", current: false },
];

const TASKS = { T1: { min_words: 60, max_words: 120, timer_seconds: 600 }, T2: { min_words: 120, max_words: 150, timer_seconds: 1200 }, T3: { min_words: 120, max_words: 180, timer_seconds: 1800 } } as const;
const taskSpecs = (writing: boolean) =>
  Object.fromEntries(
    (Object.keys(TASKS) as (keyof typeof TASKS)[]).map((id) => [
      id,
      writing
        ? { id, name: `Tâche ${id.slice(1)}`, name_en: `Task ${id.slice(1)}`, desc_en: "Write a message.", ...TASKS[id] }
        : { id, name: `Tâche ${id.slice(1)}`, name_en: `Task ${id.slice(1)}`, desc_en: "Speak.", timer_seconds: 120 },
    ]),
  );
const writeSubjects = {
  T1: [{ id: "w1", title: "Invitation", prompt: "Invitez un ami à dîner.", requirements: ["Dire la date", "Proposer un plat"] }],
  T2: [{ id: "w2", title: "Article", prompt: "Racontez un voyage." }],
  T3: [{ id: "w3", title: "Débat", prompt: "Pour ou contre ?", doc1: "Document un.", doc2: "Document deux." }],
};
const speakSubjects = {
  T1: [{ id: "s1", title: "Présentation", prompt: "Présentez-vous.", questions: ["Comment vous appelez-vous ?"] }],
  T2: [{ id: "s2", title: "Location", prompt: "Vous louez un vélo.", role_examiner: "Le loueur", target_points: ["Prix", "Horaires"] }],
  T3: [{ id: "s3", title: "Télétravail", prompt: "Le télétravail est-il une bonne idée ?", structure_hints: ["Opinion", "Exemple"] }],
};
const feedback1 = {
  checklist: [{ point: "Dire la date", covered: true, note: "" }],
  praise: "Clear and polite.",
  errors: [{ span: "je suis allé", type: "agreement", hint: "Check the past participle." }],
};
const feedback2 = (text: string) => ({
  fixed_errors: [{ span: "je suis allé", fixed: true, comment: "Good." }],
  remaining_errors: [],
  corrected_text: text,
  corrected_transcript: text,
  sentences: [{ original: "je suis allé", corrected: "Je suis allée au marché.", explanation: "Agreement with a female subject.", chunk: "suis allée" }],
  structures: [],
});
const listeningSession = (id: string) => ({
  id,
  material: {
    text: "On va au marché.",
    translation_en: "We are going to the market.",
    source: "studied",
    words: [{ w: "marché", ipa: "maʁʃe", en: "market", note: "" }],
    question: { prompt: "Où vont-ils ?", options: ["Au marché", "À la plage"] } as { prompt: string; options: string[]; answer_index?: number; explanation?: string },
  },
  rate: 1,
  rate_stage: "normal",
  blind_plays: 0,
  relisten_stages: [] as string[],
  revealed: false,
  blind_self: null as number | null,
  audio_url_normal: `/api/listening/sessions/${id}/audio?stage=normal`,
  audio_url_slow: `/api/listening/sessions/${id}/audio?stage=slow20`,
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
  /** Writing and speaking attempts by id; feedback is ready on the first poll. */
  practice: new Map<string, Record<string, unknown>>(),
  listening: new Map<string, Record<string, unknown>>(),
  /** /api/listening/sessions answers 409 (no studied sentences yet). */
  noListening: false,
  devices: demoDevices(),
  /** The next N /api/etymology requests fail with a 503 (for Retry-state tests). */
  etymologyFails: 0,
  reset() {
    this.practice = new Map();
    this.listening = new Map();
    this.noListening = false;
    this.devices = demoDevices();
    this.srs = demoSrs();
    this.studyRecords = [];
    this.attempts = [];
    this.episodes = demoEpisodes();
    this.heartbeats = {};
    this.lookups = {};
    this.etymologyFails = 0;
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
  /* ---------- word card context (routers/tutor.py) ---------- */
  if (p === "/api/word-context" && method === "POST") {
    return json(200, {
      context: { meaning_zh: "这里的意思", meaning_en: "the meaning here", why_zh: "它在这句话里的用法说明。" },
      state: "ready",
    });
  }
  if (p === "/api/phrase-context" && method === "POST") return json(200, { phrases: [], cached: true });
  if (p === "/api/etymology" && method === "POST") {
    if (fake.etymologyFails > 0) {
      fake.etymologyFails--;
      return json(503, { detail: "etymology_failed" });
    }
    return json(200, { text: body.language === "en" ? "A short English note about the word’s origin." : "这是一个示例词根词源说明。", cached: false });
  }
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
  /* ---------- Practice ---------- */
  if (p === "/api/write/tasks") return json(200, { recommended_task: "T1", recommended_level: "A2", tasks: taskSpecs(true), subjects: writeSubjects, attempts: [...fake.practice.values()].filter((a) => a.kind === "write") });
  if (p === "/api/speak/tasks") return json(200, { recommended_task: "T1", recommended_level: "A2", tasks: taskSpecs(false), subjects: speakSubjects });
  const pa = p.match(/^\/api\/(write|speak)\/attempts(?:\/([^/]+))?(\/round2)?$/);
  if (pa) {
    const [, kind, id, r2] = pa;
    const field = kind === "write" ? "text" : "transcript";
    if (!id && method === "POST") {
      const a = { id: `${kind}-${++seq}`, kind, task: body.task, subject: body.subject, level: body.level, status: "generating_1", [`${field}_1`]: body[field], feedback_1: {}, [`${field}_2`]: null, feedback_2: {}, seconds: body.seconds, error: null, created_at: "2026-01-01T10:00:00Z" };
      fake.practice.set(a.id, a);
      return json(200, a);
    }
    const a = id && fake.practice.get(decodeURIComponent(id));
    if (!a) return json(404, { detail: { message: "Not found." } });
    if (r2) {
      Object.assign(a, { status: "generating_2", [`${field}_2`]: body[field] });
      return json(200, a);
    }
    // A poll finishes whichever round is running.
    if (a.status === "generating_1") Object.assign(a, { status: "ready", feedback_1: kind === "speak" ? { ...feedback1, stats: { duration_sec: 30, wpm: 90, pace_note: "Good pace." } } : feedback1 });
    if (a.status === "generating_2") Object.assign(a, { status: "ready", feedback_2: feedback2(String(a[`${field}_2`])) });
    return json(200, a);
  }
  if (p === "/api/speak/roleplay/reply") return json(200, { reply: "Bien sûr, c’est dix euros." });
  if (p === "/api/listening/sessions" && method === "POST") {
    if (fake.noListening) return json(409, { detail: { message: "No studied sentences yet." } });
    const x = listeningSession(`ls-${++seq}`);
    fake.listening.set(x.id, x);
    return json(200, x);
  }
  const ls = p.match(/^\/api\/listening\/sessions\/([^/]+)(?:\/(blind|reveal|relisten|check))?$/);
  if (ls) {
    const x = fake.listening.get(decodeURIComponent(ls[1])) as ReturnType<typeof listeningSession> & Record<string, unknown>;
    if (!x) return json(404, { detail: { message: "Not found." } });
    if (ls[2] === "blind") Object.assign(x, { blind_self: body.self, blind_plays: body.plays });
    if (ls[2] === "reveal") x.revealed = true;
    if (ls[2] === "relisten") x.relisten_stages = [...x.relisten_stages, String(body.stage)];
    if (ls[2] === "check") {
      x.material.question = { ...x.material.question, answer_index: 0, explanation: "Ils vont au marché." };
      Object.assign(x, { answer_index: body.answer_index, result: { correct: body.answer_index === 0 } });
    }
    return json(200, x);
  }
  if (p === "/api/transform") return json(200, { text: "Je voudrais un café, s’il vous plaît.", task_mode: "translate", task_label: "Translated", quality_check: "passed" });
  if (p === "/api/speech") return json(200, { audio_url: "/files/fake.mp3", srt_url: "/files/fake.srt", voice: body.voice });
  if (p === "/api/transcribe") return json(200, { text: "Bonjour, je m’appelle Léa.", duration: 4 });
  if (p === "/api/auth/devices") return json(200, { devices: fake.devices, max_devices: 3 });
  const dv = p.match(/^\/api\/auth\/devices\/([^/]+)$/);
  if (dv && method === "DELETE") {
    fake.devices = fake.devices.filter((d) => d.id !== decodeURIComponent(dv[1]));
    return json(200, { success: true });
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
