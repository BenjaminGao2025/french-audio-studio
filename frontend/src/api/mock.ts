// Mock adapter: in-memory sample data so every route renders without a backend.
// Shapes match the real adapter exactly; state mutates in-memory for the session.
import type { Api } from "./real";
import type * as T from "./types";

const delay = <V>(v: V, ms = 120): Promise<V> => new Promise((r) => setTimeout(() => r(v), ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

const lanes: T.Lane[] = ["listening", "reading", "speaking", "writing", "review", "car"];
const zeroLanes = () => Object.fromEntries(lanes.map((l) => [l, 0])) as Record<T.Lane, number>;

// ---- mutable mock state ----

const blocks: T.Block[] = [
  {
    id: "b1",
    position: 1,
    kind: "warmup",
    title: "Speaking warm-up · 10 cards",
    planned_min: 10,
    actual_sec: 612,
    status: "done",
    route: "/cards?modes=speak,listen&new_limit=0",
    lane: "review",
    material_ids: [],
    start_time: "09:00",
  },
  {
    id: "b2",
    position: 2,
    kind: "journal",
    title: "“Say what I want to say” journal",
    planned_min: 45,
    actual_sec: 0,
    status: "active",
    route: "/journal",
    lane: "speaking",
    material_ids: ["j1"],
    start_time: "09:10",
  },
  {
    id: "b3",
    position: 3,
    kind: "review",
    title: "Review queue",
    planned_min: 10,
    actual_sec: 0,
    status: "planned",
    route: "/cards",
    lane: "review",
    material_ids: [],
    start_time: "10:00",
  },
  {
    id: "b4",
    position: 4,
    kind: "listening",
    title: "Main block 1 · Listening 3-step (6–8 items)",
    planned_min: 60,
    actual_sec: 0,
    status: "planned",
    route: "/listening",
    lane: "listening",
    material_ids: ["l1"],
    start_time: "10:10",
  },
  {
    id: "b5",
    position: 5,
    kind: "writing",
    title: "Main block 2 · Writing T1 practice",
    planned_min: 35,
    actual_sec: 0,
    status: "planned",
    route: "/writing",
    lane: "writing",
    material_ids: ["w1"],
    start_time: "11:15",
  },
  {
    id: "b6",
    position: 6,
    kind: "minimal",
    title: "Wrap-up",
    planned_min: 5,
    actual_sec: 0,
    status: "planned",
    route: "/wrapup",
    lane: "review",
    material_ids: [],
    start_time: "11:55",
  },
];

const minimalBlocks: T.Block[] = [
  {
    id: "m1",
    position: 1,
    kind: "review",
    title: "Review 10 cards",
    planned_min: 8,
    actual_sec: 0,
    status: "planned",
    route: "/cards?new_limit=0",
    lane: "review",
    material_ids: [],
  },
  {
    id: "m2",
    position: 2,
    kind: "listening",
    title: "One listening 3-step item",
    planned_min: 7,
    actual_sec: 0,
    status: "planned",
    route: "/listening",
    lane: "listening",
    material_ids: ["l1"],
  },
  {
    id: "m3",
    position: 3,
    kind: "journal",
    title: "Journal-lite · 30 words + shadow + one recording",
    planned_min: 5,
    actual_sec: 0,
    status: "planned",
    route: "/journal",
    lane: "speaking",
    material_ids: ["j1"],
  },
];

let minimal = false;
let todos: T.Todo[] = [
  { id: "t2", text: "Book the placement test", due: "2026-11-29", done: false },
];

const todayPayload = (): T.Today => ({
  minimal,
  day: todayStr(),
  phase: { id: "A", name: "Phase A", hours_from: 0, hours_to: 300, week_target_min: 960 },
  blocks: minimal ? minimalBlocks : blocks,
  materials_ready: true,
  fallback: false,
  todos,
  yesterday: { blocks_done: 4, blocks_total: 5, active_minutes: 160, listening_understood_pct: 70 },
  next_milestone: { hours: 100, hours_to_go: 62 },
});

const gameState: T.GameState = {
  level: 6,
  level_xp: 1240,
  next_level_xp: 2000,
  progress: 0.62,
  xp: 1240,
  max_level: 50,
  learning: null,
  hours_total: 38,
  today: {
    day: todayStr(),
    minutes: 95,
    target: 120,
    family_day: false,
    weekend: true,
    by_lane: { ...zeroLanes(), speaking: 45, review: 20, listening: 30 },
    logs: [
      { id: "log1", lane: "speaking", minutes: 30, note: "AI speaking practice" },
      { id: "log2", lane: "reading", minutes: 45, note: "Printed article" },
    ],
    kills: 12,
    deaths: 3,
    best_combo: 8,
    combo: 4,
    first_blood: true,
    wave_cleared: false,
  },
  week: {
    number: 2,
    start: "2026-10-12",
    end: "2026-10-18",
    minutes: 570,
    target: 960,
    maintenance: false,
    by_lane: {
      ...zeroLanes(),
      listening: 150,
      speaking: 140,
      review: 90,
      writing: 60,
      reading: 130,
    },
    lane_targets: {
      listening: 240,
      reading: 180,
      speaking: 240,
      writing: 120,
      review: 120,
      car: 60,
    },
    lane_weights: {
      listening: 1,
      reading: 1,
      speaking: 1,
      writing: 1,
      review: 1,
      car: 0,
    },
    skills: {},
    focus_skill: "listening",
  },
  streak_days: 9,
};

const mkCard = (
  id: string,
  sentence: string,
  en: string,
  zh: string,
  mode: T.CardMode,
  state: T.CardState,
): T.SrsCard => ({
  id,
  note_id: `n-${id}`,
  mode,
  state,
  sentence,
  translation_en: en,
  translation_zh: zh,
  importance: 3,
  intervals: { "1": 60, "2": 480, "3": 86400, "4": 345600 },
});

let queue: T.SrsCard[] = [
  mkCard(
    "c1",
    "Je vais au marché avec mon frère.",
    "I go to the market with my brother.",
    "我和我哥哥去市场。",
    "speak",
    "review",
  ),
  mkCard(
    "c2",
    "Elle a acheté des pommes samedi.",
    "She bought apples on Saturday.",
    "她周六买了苹果。",
    "listen",
    "review",
  ),
  mkCard(
    "c3",
    "Il faut que tu ___ tes devoirs. (fasses)",
    "You have to do your homework.",
    "你必须做作业。",
    "cloze",
    "learning",
  ),
  mkCard(
    "c4",
    "Nous habitons à Vancouver depuis deux ans.",
    "We have lived in Vancouver for two years.",
    "我们在温哥华住了两年。",
    "speak",
    "new",
  ),
];

const journal: T.Journal = {
  id: "j1",
  native_text: "我想说说上周末我和家人去农贸市场的事。",
  french: "Je veux parler de ma visite au marché avec ma famille le week-end dernier.",
  parts: [
    { source: "我想说说上周末的事。", french: "Je veux parler de ma visite le week-end dernier." },
    { source: "我和家人去了农贸市场。", french: "Je suis allé au marché avec ma famille." },
  ],
  recordings: [],
  reference_url: "/api/homework/j1/reference",
  status: "prepared",
  complete: false,
  created_at: "2026-10-12T16:00:00Z",
};

const listeningSession: T.ListeningSession = {
  id: "ls1",
  material: {
    text: "Claire va au marché avec son frère samedi. Elle achète des pommes et du fromage.",
    words: [
      { w: "marché", ipa: "/maʁ.ʃe/", en: "market", note: "nasal-free; open /ɛ/" },
      { w: "samedi", ipa: "/sam.di/", en: "Saturday" },
      { w: "fromage", ipa: "/fʁɔ.maʒ/", en: "cheese" },
    ],
    breakdown:
      "Aller + au marché = to go to the market. « des pommes » = some apples (indefinite plural).",
    question: {
      prompt: "What does Claire buy?",
      options: ["Apples and cheese", "Bread and milk", "Fish and apples", "Cheese and bread"],
      answer_index: 0,
      evidence: "« Elle achète des pommes et du fromage. »",
    },
  },
  rate_stage: "normal",
  audio_url_normal: "",
  audio_url_slow: "",
  index: 3,
  total: 7,
};

const passage: T.Passage = {
  id: "p1",
  title: "Fermeture exceptionnelle de la bibliothèque",
  text: "La bibliothèque municipale sera fermée lundi pour travaux. Les livres empruntés pourront être rendus mardi. Merci de votre compréhension.",
  text_type: "notice",
  level: "A2",
  source: "generated",
  license: "generated",
  analysis: {
    sentences: [
      {
        text: "La bibliothèque municipale sera fermée lundi pour travaux.",
        translation_en: "The municipal library will be closed on Monday for works.",
        translation_zh: "市图书馆周一因施工关闭。",
        build_up: [
          "La bibliothèque",
          "La bibliothèque sera fermée",
          "La bibliothèque sera fermée lundi",
          "La bibliothèque municipale sera fermée lundi pour travaux.",
        ],
        words: [
          {
            word: "fermée",
            ipa: "/fɛʁ.me/",
            lemma: "fermer",
            pos: "adj",
            en: "closed",
            zh: "关闭的",
            why: "past participle agrees with bibliothèque (fem.)",
          },
        ],
        grammar_points: [
          {
            title: "Future simple",
            explanation: "sera fermée = will be closed (passive, future).",
            hook: "sera + participle",
          },
        ],
      },
      {
        text: "Les livres empruntés pourront être rendus mardi.",
        translation_en: "Borrowed books can be returned on Tuesday.",
        translation_zh: "借的书可以周二还。",
        build_up: [
          "Les livres",
          "Les livres empruntés",
          "Les livres empruntés pourront être rendus mardi.",
        ],
        words: [
          {
            word: "empruntés",
            ipa: "/ɑ̃.pʁœ̃.te/",
            lemma: "emprunter",
            pos: "adj",
            en: "borrowed",
            zh: "借来的",
            why: "emprunter = to borrow, not to lend",
          },
        ],
        grammar_points: [
          {
            title: "pouvoir + infinitive",
            explanation: "pourront être rendus = will be able to be returned.",
          },
        ],
      },
      {
        text: "Merci de votre compréhension.",
        translation_en: "Thank you for your understanding.",
        translation_zh: "感谢您的理解。",
        build_up: ["Merci", "Merci de votre compréhension."],
        words: [],
        grammar_points: [],
      },
      {
        text: "La bibliothèque municipale sera fermée lundi pour travaux.",
        translation_en: "(repeated heading line)",
        translation_zh: "",
        build_up: [],
        words: [],
        grammar_points: [],
      },
    ],
  },
  questions: [
    {
      kind: "main_idea",
      q: "Why is the library closed?",
      a: "Because of renovation works.",
      evidence: "« fermée lundi pour travaux »",
    },
    {
      kind: "detail",
      q: "When can books be returned?",
      a: "On Tuesday.",
      evidence: "« pourront être rendus mardi »",
    },
    {
      kind: "word_meaning",
      q: "What does « empruntés » mean here?",
      a: "Borrowed (books that were taken out).",
      evidence: "« Les livres empruntés »",
    },
  ],
};

const week8: T.Checkpoint = {
  id: "cp8",
  kind: "week_8",
  status: "open",
  triggered_at: "2026-10-15",
  hours_at: 38,
  report: {
    active_hours: 36,
    process_metrics: {
      "Blocks completed": "31 / 38",
      "Cards reviewed": 412,
      "Journal entries": 9,
      "Listening items": 44,
    },
    skills: [
      { skill: "listening", series: [42, 48, 55, 61], last: 61 },
      { skill: "reading", series: [50, 53, 57, 60], last: 60 },
      { skill: "writing", series: [38, 41, 44, 47], last: 47 },
      { skill: "speaking", series: [35, 39, 44, 50], last: 50 },
    ],
    recommendation:
      "Keep the current plan. Listening is on track; add one extra writing task per week.",
    risks: ["Writing volume below target"],
  },
};

const week16: T.Checkpoint = {
  id: "cp16",
  kind: "week_16",
  status: "upcoming",
  hours_at: 0,
};

let checkpoints: T.Checkpoint[] = [week8, week16];

let episodes: T.Episode[] = [
  { id: "ep1", title: "Un samedi au marché", level: "A2", minutes: 20, created_at: "2026-10-15" },
  { id: "ep2", title: "Ma journée au travail", level: "A2", minutes: 30, created_at: "2026-10-13" },
];

const dailyReviews: Record<string, T.DailyReview> = {};

const rubric: T.Rubric = {
  dims: [
    { dim: "Task completion", cefr: "A2", evidence: "Both points addressed" },
    { dim: "Grammar", cefr: "A2", evidence: "Passé composé mostly correct" },
    { dim: "Vocabulary", cefr: "A1", evidence: "Limited range; repeated « très »" },
    { dim: "Coherence", cefr: "A2" },
    { dim: "Spelling", cefr: "B1" },
  ],
  score_low: 8,
  score_high: 11,
  confidence: "low",
  hard_fail: null,
  prompt_version: "rubric_ee_v1",
};

const itemsSummary: T.ItemsSummary = {
  pools: {
    practice: {
      listening: { total: 64, by_source: { official_sample: 12, user: 8, llm: 40, imported: 4 } },
      reading: { total: 58, by_source: { official_sample: 10, user: 6, llm: 42 } },
      writing: { total: 22, by_source: { official_sample: 6, user: 4, llm: 12 } },
      speaking: { total: 26, by_source: { official_sample: 6, user: 8, llm: 12 } },
    },
    validation: {
      listening: { total: 18, by_source: { official_sample: 14, llm: 4 } },
      reading: { total: 16, by_source: { official_sample: 12, llm: 4 } },
      writing: { total: 8, by_source: { official_sample: 8 } },
      speaking: { total: 8, by_source: { official_sample: 8 } },
    },
  },
};

const itemRows: T.ItemRow[] = [
  {
    id: "i1",
    skill: "listening",
    task: "CO T2",
    level: "A2",
    format: "mcq4",
    source: "official_sample",
    license: "sample",
    pool: "validation",
    created_at: "2026-10-01",
  },
  {
    id: "i2",
    skill: "reading",
    task: "CE T1",
    level: "A2",
    format: "mcq4",
    source: "llm",
    license: "generated",
    pool: "practice",
    created_at: "2026-10-05",
  },
  {
    id: "i3",
    skill: "writing",
    task: "EE T1",
    level: "A2",
    format: "prompt",
    source: "user",
    license: "own",
    pool: "practice",
    created_at: "2026-10-06",
  },
  {
    id: "i4",
    skill: "speaking",
    task: "EO T2",
    level: "B1",
    format: "roleplay",
    source: "imported",
    license: "cc-by",
    pool: "practice",
    created_at: "2026-10-08",
    exposed_at: "2026-10-12",
  },
  {
    id: "i5",
    skill: "listening",
    task: "CO T3",
    level: "B1",
    format: "mcq4",
    source: "official_sample",
    license: "sample",
    pool: "validation",
    created_at: "2026-10-09",
  },
];

const writeTasks: T.WriteTaskSpec[] = [
  {
    task: "T1",
    word_range: [60, 120],
    minutes: 15,
    subjects: [{ id: "w1", prompt: "Écrivez un message à un ami pour l'inviter à dîner." }],
  },
  {
    task: "T2",
    word_range: [120, 150],
    minutes: 25,
    subjects: [{ id: "w2", prompt: "Décrivez une expérience récente dans un blog." }],
  },
  {
    task: "T3",
    word_range: [120, 180],
    minutes: 30,
    subjects: [
      {
        id: "w3",
        prompt:
          "Texte 1 : « Le télétravail réduit les déplacements et améliore l'équilibre de vie. »\nTexte 2 : « Le télétravail isole les employés et affaiblit l'esprit d'équipe. »\nRésumez les deux points de vue et donnez votre position.",
      },
    ],
  },
];

const shadowSentences: T.ShadowSentence[] = [
  { text: "J'habite à Vancouver avec ma famille.", ipa: "/ʒa.bit a vɑ̃.ku.vɛʁ a.vɛk ma fa.mij/" },
  { text: "Je vais au marché avec mon frère.", ipa: "/ʒə vɛ o maʁ.ʃe a.vɛk mɔ̃ fʁɛʁ/" },
  { text: "Elle achète des pommes et du fromage.", ipa: "/ɛl a.ʃɛt de pɔm e dy fʁɔ.maʒ/" },
  { text: "Nous habitons ici depuis deux ans.", ipa: "/nu za.bi.tɔ̃ i.si də.pɥi de.z‿ɑ̃/" },
  {
    text: "Ce soir, je vais cuisiner pour mes enfants.",
    ipa: "/sə swaʁ ʒə vɛ kɥi.zi.ne puʁ me.z‿ɑ̃.fɑ̃/",
  },
];

export const mock: Api = {
  auth: {
    login: (email) => delay({ token: "mock-token", email, is_valid: true }),
    session: () => delay(undefined),
    me: () => delay({ email: "benjamin@example.com", plan: "personal", is_valid: true }),
    logout: () => delay(undefined),
    devices: () => delay([{ id: "d1", name: "This browser", current: true }]),
    deleteDevice: () => delay(undefined),
  },
  game: {
    state: () => delay(structuredClone(gameState)),
    heartbeat: (_lane, seconds) => {
      gameState.today.minutes += seconds / 60;
      return delay({ stored_seconds: seconds });
    },
    log: (lane, minutes, note) => {
      gameState.today.logs.push({ id: uid(), lane, minutes, note });
      gameState.today.by_lane[lane] += minutes;
      gameState.week.by_lane[lane] += minutes;
      gameState.week.minutes += minutes;
      return delay(structuredClone(gameState));
    },
    deleteLog: (id) => {
      gameState.today.logs = gameState.today.logs.filter((l) => l.id !== id);
      return delay(structuredClone(gameState));
    },
    familyDay: (on) => {
      gameState.today.family_day = on;
      return delay(structuredClone(gameState));
    },
  },
  srs: {
    queue: () =>
      delay({
        cards: structuredClone(queue),
        counts: {
          learning: queue.filter((c) => c.state === "learning").length,
          review: queue.filter((c) => c.state === "review").length,
          new: queue.filter((c) => c.state === "new").length,
          total: queue.length,
        },
      }),
    review: (id) => {
      queue = queue.filter((c) => c.id !== id);
      return delay({ ...mkCard(id, "", "", "", "speak", "review"), game: { xp: 10, combo: 5 } });
    },
    practice: (card_ids) => {
      const cards = queue.filter((c) => card_ids.includes(c.id));
      return delay({
        cards,
        counts: {
          learning: cards.filter((c) => c.state === "learning").length,
          review: cards.filter((c) => c.state === "review").length,
          new: cards.filter((c) => c.state === "new").length,
          total: cards.length,
        },
      });
    },
    addNote: () => delay({ ok: true }),
    lookupNotes: (sentences) => delay({ existing: sentences.slice(0, 1) }),
  },
  coach: {
    get: () =>
      delay({
        day: todayStr(),
        setup: true,
        tasks: [{ kind: "listen", title: "Mini listening A1", done: false }],
        schedule: [],
        progress: null,
        weekly_report: null,
      }),
    complete: () => delay(undefined),
    review: () => delay({ ok: true }),
    profile: () => delay({} as T.CoachDashboard),
  },
  homework: {
    list: () => delay({ entries: [structuredClone(journal)] }),
    create: (native_text) =>
      delay({
        ...structuredClone(journal),
        id: uid(),
        native_text,
        status: "created",
        parts: [],
        french: undefined,
      }),
    get: () => delay(structuredClone(journal)),
    prepare: () => delay(structuredClone(journal)),
    referenceUrl: (id) => `/api/homework/${id}/reference`,
    practice: () => delay(undefined),
    uploadRecording: (_id, kind) =>
      delay({ ...structuredClone(journal), recordings: [{ id: uid(), kind, duration: 12 }] }),
    finish: (_id, reflection, recalled) =>
      delay({ ...structuredClone(journal), reflection, recalled, complete: true, status: "done" }),
    archiveUrl: (id) => `/api/homework/${id}/archive`,
    recite: () =>
      delay({
        similarity: 0.87,
        sentences: [
          {
            text: journal.parts[0]!.french,
            transcript: journal.parts[0]!.french,
            similarity: 0.92,
            passed: true,
          },
          {
            text: journal.parts[1]!.french,
            transcript: "Je suis allé au marché avec ma famille",
            similarity: 0.81,
            passed: false,
          },
        ],
        passed_count: 1,
        total: 2,
        new_speak_cards: 1,
      }),
  },
  shadow: { sentences: () => delay(structuredClone(shadowSentences)) },
  speech: {
    synthesize: () => delay({ audio_url: "", voice: "fr-FR-DeniseNeural" }),
    ttsUrl: (text, voice) =>
      `/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice ?? "fr-FR-DeniseNeural")}`,
    transcribe: () => delay({ text: "Je veux parler de ma visite au marché." }),
  },
  analyze: {
    text: () => delay(structuredClone(passage.analysis)),
    lookup: (word) => delay({ word, en: "…", zh: "…" }),
  },
  write: {
    tasks: () =>
      delay({ tasks: structuredClone(writeTasks), recommended: { task: "T1", level: "A2" } }),
    subject: (task) => delay(writeTasks.find((t) => t.task === task)?.subjects[0]),
    attempt: () =>
      delay({
        id: uid(),
        status: "ready",
        feedback1: { hints: ["Check passé composé agreement", "Add a closing line"] },
      }),
    getAttempt: (id) => delay({ id, status: "ready" }),
    round2: (id) =>
      delay({
        id,
        status: "ready",
        feedback2: {
          corrected_text: "Salut Marc ! Je t'invite à dîner chez moi samedi soir.",
          sentences: [
            {
              original: "Je t'invite a dîner",
              corrected: "Je t'invite à dîner",
              explanation: "à takes an accent",
              chunk: "inviter à",
            },
          ],
          structures: [],
        },
      }),
    rubric: () => delay(structuredClone(rubric)),
  },
  speak: {
    tasks: () =>
      delay({
        tasks: [
          {
            task: "T1",
            seconds: 120,
            subjects: [{ id: "s1", prompt: "Présentez-vous : nom, ville, famille, travail." }],
          },
          {
            task: "T2",
            seconds: 210,
            prep_seconds: 120,
            subjects: [{ id: "s2", prompt: "Vous appelez la mairie pour un rendez-vous." }],
          },
          {
            task: "T3",
            seconds: 270,
            subjects: [{ id: "s3", prompt: "Convaincre un ami de faire du sport." }],
          },
        ],
      }),
    attempt: () => delay({ id: uid(), status: "ready", wpm: 96 }),
    getAttempt: (id) => delay({ id, status: "ready", wpm: 96 }),
    round2: (id) => delay({ id, status: "ready" }),
    roleplayReply: () =>
      delay({ reply: "Bonjour, la mairie. À quel moment souhaitez-vous venir ?" }),
    rubric: () => delay({ ...structuredClone(rubric), score_low: 7, score_high: 10 }),
  },
  episodes: {
    list: () => delay(structuredClone(episodes)),
    create: (body) => {
      const ep = {
        id: uid(),
        title: body.request ?? "Nouvel épisode",
        level: body.level ?? "A2",
        minutes: body.minutes,
        created_at: todayStr(),
      };
      episodes = [ep, ...episodes];
      return delay(ep);
    },
    remove: (id) => {
      episodes = episodes.filter((e) => e.id !== id);
      return delay(undefined);
    },
    audioUrl: (id) => `/episodes/${id}.mp3`,
    lrcUrl: (id) => `/episodes/${id}.lrc`,
  },
  today: {
    get: () => delay(structuredClone(todayPayload())),
    startBlock: (id) => {
      const b = [...blocks, ...minimalBlocks].find((x) => x.id === id)!;
      b.status = "active";
      return delay(structuredClone(b));
    },
    finishBlock: (id) => {
      const b = [...blocks, ...minimalBlocks].find((x) => x.id === id)!;
      b.status = "done";
      return delay(structuredClone(b));
    },
    skipBlock: (id) => {
      const b = [...blocks, ...minimalBlocks].find((x) => x.id === id)!;
      b.status = "skipped";
      return delay(structuredClone(b));
    },
    minimal: (on) => {
      minimal = on;
      return delay(structuredClone(todayPayload()));
    },
  },
  hours: {
    ledger: () =>
      delay({
        active_hours: 34.5,
        manual_hours: 3.5,
        input_hours: 6,
        lanes: [
          { lane: "listening", active: 8, manual: 0, input: 6, week_target: 4 },
          { lane: "reading", active: 6, manual: 2.5, input: 0, week_target: 3 },
          { lane: "speaking", active: 9, manual: 1, input: 0, week_target: 4 },
          { lane: "writing", active: 4.5, manual: 0, input: 0, week_target: 2 },
          { lane: "review", active: 7, manual: 0, input: 0, week_target: 2 },
          { lane: "car", active: 0, manual: 0, input: 6, week_target: 1 },
        ],
        milestones: [100, 300, 500, 750, 1000],
        next_milestone: 100,
        hours_to_go: 62,
        phase: "Phase A (0–300h)",
      }),
  },
  todos: {
    list: () => delay(structuredClone(todos)),
    done: (id) => {
      todos = todos.map((t) => (t.id === id ? { ...t, done: true } : t));
      return delay(undefined);
    },
  },
  reviews: {
    add: (body) => {
      dailyReviews[body.day] = body;
      return delay(undefined);
    },
    get: (day) =>
      delay(dailyReviews[day] ?? { day, hard: "", solved: "", unsolved: "", tomorrow: "" }),
  },
  listening: {
    createSession: () => delay(structuredClone(listeningSession)),
    blind: () => delay(structuredClone(listeningSession)),
    reveal: () => delay(structuredClone(listeningSession)),
    relisten: () => delay(structuredClone(listeningSession)),
    check: (_id, answer_index) =>
      delay({
        ...structuredClone(listeningSession),
        result: { correct: answer_index === listeningSession.material.question.answer_index },
      }),
    gate: () =>
      delay({
        hours: { value: 38, target: 200 },
        understood_pct: { value: 70, target: 80 },
        unseen_quiz_pct: { value: 0, target: 60 },
        unlocked: false,
      }),
  },
  reading: {
    create: () => delay(structuredClone(passage)),
    get: () => delay(structuredClone(passage)),
    done: () => delay(undefined),
  },
  items: {
    summary: () => delay(structuredClone(itemsSummary)),
    list: (q) =>
      delay({
        rows: itemRows.filter(
          (r) => (!q.skill || r.skill === q.skill) && (!q.pool || r.pool === q.pool),
        ),
        total: itemRows.length,
      }),
  },
  checkpoints: {
    list: () => delay(structuredClone(checkpoints)),
    decide: (id, decision, note) => {
      checkpoints = checkpoints.map((c) =>
        c.id === id ? { ...c, status: "decided" as const, decision, decision_note: note } : c,
      );
      return delay(structuredClone(checkpoints.find((c) => c.id === id)!));
    },
    exportUrl: (id) => `/api/checkpoints/${id}/export.md`,
  },
  phase: {
    get: () =>
      delay({
        id: "A",
        name: "Phase A (0–300h)",
        week_target_min: 960,
        lane_targets: {
          listening: 240,
          reading: 180,
          speaking: 240,
          writing: 120,
          review: 120,
          car: 60,
        },
        new_cards_per_day: 5,
        gates: {},
      }),
    put: (p) => delay(p),
  },
};
