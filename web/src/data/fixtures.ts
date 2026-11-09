/* All data here is fictional demo content held in memory. */
import { importanceFor, lookupKey } from "../lib/lookup";

export const REFERENCE_DATE = new Date(Date.UTC(2026, 2, 4)); // Wednesday, March 4, 2026 (fictional "today")
export const DEMO_USER = { name: "Alex Martin", initials: "AM", label: "Fictional demo account" };

export interface Segment {
  t: string;
  /** Present when the segment is a clickable word or phrase. */
  w?: boolean;
}
export interface StepPart {
  t: string;
  added?: boolean;
}
export interface Step {
  parts: StepPart[];
  en: string;
  addedLabel: string;
  how: string;
}
export interface GrammarNote {
  title: string;
  body: string;
  example: string;
  exampleEn: string;
}
export interface DerivedCard {
  id: string;
  kind: "Listen" | "Speak" | "Fill-in";
  label: string;
}
export interface StudySentence {
  id: string;
  fr: string;
  en: string;
  segments: Segment[];
  steps: Step[];
  grammar: GrammarNote[] | null;
  cards: DerivedCard[];
  /** English meanings for each step, used as Recall prompts. */
}

const seg = (...parts: (string | [string])[]): Segment[] =>
  parts.map((p) => (Array.isArray(p) ? { t: p[0], w: true } : { t: p }));

export const SAMPLE_TEXT = "Il y a deux jours, j’ai failli oublier mon rendez-vous.";
export const EXAMPLE_TEXT =
  "Il y a deux jours, j’ai failli oublier mon rendez-vous. Heureusement, ma sœur m’a appelé ce matin. Nous avons pris un café près de la gare.";
export const IDEAS_EXAMPLE = "I want to tell my teacher that I almost forgot our meeting.";

export const S1: StudySentence = {
  id: "s1",
  fr: SAMPLE_TEXT,
  en: "Two days ago, I almost forgot my appointment.",
  segments: seg(["Il y a"], " ", ["deux"], " ", ["jours"], ", ", ["j’ai"], " ", ["failli"], " ", ["oublier"], " ", ["mon"], " ", ["rendez-vous"], "."),
  steps: [
    {
      parts: [{ t: "J’ai failli oublier.", added: true }],
      en: "I almost forgot.",
      addedLabel: "Starting phrase: j’ai failli oublier",
      how: "Listen twice, then say it aloud without looking.",
    },
    {
      parts: [{ t: "J’ai failli oublier " }, { t: "mon rendez-vous", added: true }, { t: "." }],
      en: "I almost forgot my appointment.",
      addedLabel: "Added: mon rendez-vous (what was almost forgotten)",
      how: "Say the first part, pause, then add the new words.",
    },
    {
      parts: [{ t: "Il y a deux jours, ", added: true }, { t: "j’ai failli oublier mon rendez-vous." }],
      en: "Two days ago, I almost forgot my appointment.",
      addedLabel: "Added: il y a deux jours (when it happened)",
      how: "Start with the time phrase, then say the whole sentence in one breath.",
    },
  ],
  grammar: [
    {
      title: "faillir + infinitive",
      body: "Use a form of faillir before an infinitive to say something almost happened but did not.",
      example: "J’ai failli tomber.",
      exampleEn: "I almost fell.",
    },
    {
      title: "il y a + length of time",
      body: "Put il y a before a length of time to mean “ago”. The time phrase can start the sentence.",
      example: "Il y a une semaine",
      exampleEn: "A week ago",
    },
    {
      title: "Passé composé with avoir",
      body: "J’ai failli is in the passé composé: a present form of avoir plus a past participle.",
      example: "J’ai mangé.",
      exampleEn: "I ate.",
    },
  ],
  cards: [
    { id: "s1-listen", kind: "Listen", label: "Listen card · whole sentence" },
    { id: "s1-speak", kind: "Speak", label: "Speak card · whole sentence" },
    { id: "s1-fill-failli", kind: "Fill-in", label: "Fill-in card · failli" },
    { id: "s1-fill-rdv", kind: "Fill-in", label: "Fill-in card · rendez-vous" },
  ],
};

export const S2: StudySentence = {
  id: "s2",
  fr: "Heureusement, ma sœur m’a appelé ce matin.",
  en: "Luckily, my sister called me this morning.",
  segments: seg(["Heureusement"], ", ", ["ma"], " ", ["sœur"], " ", ["m’a appelé"], " ", ["ce matin"], "."),
  steps: [
    {
      parts: [{ t: "Ma sœur m’a appelé.", added: true }],
      en: "My sister called me.",
      addedLabel: "Starting phrase: ma sœur m’a appelé",
      how: "Listen for the short m’ sound, then repeat.",
    },
    {
      parts: [{ t: "Ma sœur m’a appelé " }, { t: "ce matin", added: true }, { t: "." }],
      en: "My sister called me this morning.",
      addedLabel: "Added: ce matin (when)",
      how: "Add the time at the end without pausing.",
    },
    {
      parts: [{ t: "Heureusement, ", added: true }, { t: "ma sœur m’a appelé ce matin." }],
      en: "Luckily, my sister called me this morning.",
      addedLabel: "Added: heureusement (how you feel about it)",
      how: "Say heureusement with a small pause after it.",
    },
  ],
  grammar: [
    {
      title: "me → m’ before a vowel",
      body: "Me becomes m’ before a vowel sound, so me + a becomes m’a.",
      example: "Il m’aide.",
      exampleEn: "He helps me.",
    },
  ],
  cards: [
    { id: "s2-listen", kind: "Listen", label: "Listen card · whole sentence" },
    { id: "s2-speak", kind: "Speak", label: "Speak card · whole sentence" },
    { id: "s2-fill-soeur", kind: "Fill-in", label: "Fill-in card · sœur" },
  ],
};

export const S3: StudySentence = {
  id: "s3",
  fr: "Nous avons pris un café près de la gare.",
  en: "We had a coffee near the station.",
  segments: seg(["Nous avons pris"], " ", ["un café"], " ", ["près de"], " ", ["la gare"], "."),
  steps: [
    {
      parts: [{ t: "Nous avons pris un café.", added: true }],
      en: "We had a coffee.",
      addedLabel: "Starting phrase: nous avons pris un café",
      how: "Repeat until it feels like one phrase.",
    },
    {
      parts: [{ t: "Nous avons pris un café " }, { t: "près de la gare", added: true }, { t: "." }],
      en: "We had a coffee near the station.",
      addedLabel: "Added: près de la gare (where)",
      how: "Link près de smoothly to la gare.",
    },
  ],
  grammar: null,
  cards: [
    { id: "s3-listen", kind: "Listen", label: "Listen card · whole sentence" },
    { id: "s3-speak", kind: "Speak", label: "Speak card · whole sentence" },
  ],
};

export const STUDY_FIXTURES = [S1, S2, S3];

/** Cards that are already in the library before the demo starts (drives the duplicate state). */
export const PRESAVED_CARD_IDS = ["s3-listen", "s3-speak"];

export interface DictEntry {
  entry: string;
  main: string;
  dictionary: string;
  context: Record<string, string>;
  meta?: string;
  why?: string;
  etymology?: string;
  more?: string[];
  source: string;
}

const D = (e: Omit<DictEntry, "source">): DictEntry => ({ source: "Demo dictionary (fictional)", ...e });

export const DICTIONARY: Record<string, DictEntry> = Object.fromEntries(
  [
    D({
      entry: "il y a",
      main: "ago",
      dictionary: "there is / there are; used with a time expression to mean ago",
      context: { s1: "two days ago" },
      meta: "fixed expression",
      why: "Followed by a length of time, it points back from now, so it reads as “ago”.",
      etymology: "Built from il (it), y (there) and a (has): literally “it has there”.",
    }),
    D({ entry: "deux", main: "two", dictionary: "two; the number 2", context: { s1: "two (days)" }, meta: "number" }),
    D({ entry: "jours", main: "days", dictionary: "days; plural of jour (day)", context: { s1: "days" }, meta: "noun, plural" }),
    D({ entry: "j’ai", main: "I have", dictionary: "I have; je + ai", context: { s1: "I (part of “I almost…”)" } }),
    D({
      entry: "failli",
      main: "almost did",
      dictionary: "almost do something",
      context: { s1: "I almost forgot my appointment." },
      meta: "form of faillir",
      why: "It says something came very close to happening but did not happen.",
      etymology: "From Latin fallere, “to deceive, to fall short”.",
      more: [
        "Rare, formal: to fail in a duty (faillir à son devoir).",
        "As a noun in business French, un failli is a person declared bankrupt.",
        "Common in speech: j’ai failli + infinitive, tu as failli + infinitive.",
        "Often heard in short reactions such as “J’ai failli !” (“I almost did!”).",
      ],
    }),
    D({ entry: "oublier", main: "to forget", dictionary: "to forget; to leave something behind", context: { s1: "forget (my appointment)" } }),
    D({ entry: "mon", main: "my", dictionary: "my (before a masculine noun or a vowel)", context: { s1: "my" } }),
    D({ entry: "rendez-vous", main: "appointment", dictionary: "appointment; meeting; date", context: { s1: "appointment" }, meta: "noun" }),
    D({ entry: "heureusement", main: "luckily", dictionary: "fortunately; luckily", context: { s2: "luckily" } }),
    D({ entry: "ma", main: "my", dictionary: "my (before a feminine noun)", context: { s2: "my" } }),
    D({ entry: "sœur", main: "sister", dictionary: "sister", context: { s2: "sister" }, meta: "noun" }),
    D({ entry: "ce matin", main: "this morning", dictionary: "this morning", context: { s2: "this morning" } }),
    D({ entry: "nous avons pris", main: "we had", dictionary: "we took; we had (prendre = to take)", context: { s3: "we had (a coffee)" } }),
    D({ entry: "un café", main: "a coffee", dictionary: "a coffee; a café", context: { s3: "a coffee" } }),
    D({ entry: "près de", main: "near", dictionary: "near; close to", context: { s3: "near" } }),
    D({ entry: "la gare", main: "the station", dictionary: "the train station", context: { s3: "the station" } }),
  ].map((d) => [lookupKey(d.entry), d]),
);

/** Words with no dictionary match: they go through the AI fallback. */
export const AI_FALLBACK: Record<string, string> = {
  [lookupKey("m’a appelé")]: "Here m’a appelé means “called me”: m’ is “me” and a appelé is “called”.",
};

/** Lookup count fixtures for read-only importance (0, 4, 5, 6, 9, 10). */
export const LOOKUP_FIXTURES: Record<string, number> = {
  [lookupKey("deux")]: 0,
  [lookupKey("failli")]: 4,
  [lookupKey("rendez-vous")]: 5,
  [lookupKey("oublier")]: 6,
  [lookupKey("jours")]: 9,
  [lookupKey("il y a")]: 10,
  [lookupKey("bus")]: 2,
  [lookupKey("week-end")]: 5,
  [lookupKey("pris")]: 0,
  [lookupKey("musée")]: 5,
  [lookupKey("travail")]: 6,
  [lookupKey("visité")]: 0,
  [lookupKey("sœur")]: 4,
  [lookupKey("appartement")]: 6,
  [lookupKey("bibliothèque")]: 10,
  [lookupKey("parapluie")]: 0,
  [lookupKey("restaurant")]: 5,
  [lookupKey("vélo")]: 4,
  [lookupKey("propriétaire")]: 9,
  [lookupKey("courses")]: 2,
  [lookupKey("café")]: 5,
  [lookupKey("table")]: 4,
  [lookupKey("nouvelles")]: 6,
  [lookupKey("fleuve")]: 10,
};

export const FAVORITE_FIXTURES: Record<string, boolean> = {
  [lookupKey("rendez-vous")]: true,
  [lookupKey("musée")]: true,
  [lookupKey("café")]: true,
};

/** Saved definition snapshots present before the demo starts (offline-cached). */
export const CACHED_KEYS = [lookupKey("failli"), lookupKey("il y a"), lookupKey("rendez-vous")];

/* ---------- Library: 179 sentences · 500 cards ---------- */

const OPENERS: [string, string][] = [
  ["Ce matin,", "This morning,"],
  ["Hier soir,", "Last night,"],
  ["Demain,", "Tomorrow,"],
  ["Le week-end,", "On weekends,"],
  ["Après le travail,", "After work,"],
  ["Avant le cours,", "Before class,"],
  ["En hiver,", "In winter,"],
  ["Lundi prochain,", "Next Monday,"],
  ["Pendant la pause,", "During the break,"],
  ["Ce soir,", "Tonight,"],
  ["D’habitude,", "Usually,"],
  ["La semaine dernière,", "Last week,"],
];
const ENDINGS: [string, string, string][] = [
  ["j’ai pris le bus.", "I took the bus.", "bus"],
  ["nous avons visité le musée.", "we visited the museum.", "musée"],
  ["elle a appelé sa sœur.", "she called her sister.", "sœur"],
  ["ils ont cherché un appartement.", "they looked for an apartment.", "appartement"],
  ["je vais à la bibliothèque.", "I go to the library.", "bibliothèque"],
  ["tu as oublié ton parapluie.", "you forgot your umbrella.", "parapluie"],
  ["on mange au restaurant.", "we eat at the restaurant.", "restaurant"],
  ["il a réparé son vélo.", "he fixed his bike.", "vélo"],
  ["j’ai écrit à mon propriétaire.", "I wrote to my landlord.", "propriétaire"],
  ["nous faisons les courses.", "we do the groceries.", "courses"],
  ["elle prend un café au lait.", "she has a café au lait.", "café"],
  ["j’ai failli rater le train.", "I almost missed the train.", "failli"],
  ["vous avez réservé une table.", "you booked a table.", "table"],
  ["je regarde les nouvelles.", "I watch the news.", "nouvelles"],
  ["on se promène près du fleuve.", "we walk near the river.", "fleuve"],
];

export interface LibCard {
  id: string;
  sentenceId: string;
  kind: "Listen" | "Speak" | "Fill-in";
  word?: string;
  savedAt: number; // demo order index (earlier = smaller)
  status: "new" | "learning" | "review";
  mastered: boolean;
  favorite: boolean;
  lookups: number;
  /** Saved = member of the saved card library. Favorite is a separate bookmark. */
  saved: boolean;
}
export interface LibSentence {
  id: string;
  fr: string;
  en: string;
  topic: string;
  number: number;
}

const TOPICS = ["Daily life", "Transport", "Housing", "Family", "Food", "Weekend plans", "Work", "Weather"];

export const DEFAULT_SESSION_SIZE = 40;
export const MIN_SESSION_SIZE = 10;
export const MAX_SESSION_SIZE = 300;

export function buildLibrary(): { sentences: LibSentence[]; cards: LibCard[] } {
  const sentences: LibSentence[] = [];
  const cards: LibCard[] = [];
  let n = 0;
  let savedIdx = 0;
  outer: for (let e = 0; e < ENDINGS.length; e++) {
    for (let o = 0; o < OPENERS.length; o++) {
      if (n >= 179) break outer;
      const [fo, eo] = OPENERS[o];
      const [fe, ee, word] = ENDINGS[e];
      // The last library sentence is the one already saved from an earlier Study session (S3).
      const isS3 = n === 178;
      const id = isS3 ? "s3" : `L${n + 1}`;
      sentences.push(
        isS3
          ? { id, fr: S3.fr, en: S3.en, topic: "Daily life", number: n + 1 }
          : { id, fr: `${fo} ${fe}`, en: `${eo} ${ee}`, topic: TOPICS[(o + e) % TOPICS.length], number: n + 1 },
      );
      // 2 sentences (L4 at offset 0 of new cards, and L16 at offset 38 of new cards) have 5 saved cards;
      // 136 sentences have 3 saved cards; 41 sentences have 2 saved cards → 10 + 408 + 82 = 500 saved cards.
      const extraWords =
        n === 3
          ? ["week-end", "pris"]
          : n === 15
            ? ["travail", "visité"]
            : [];
      const baseKinds: { idSuffix: string; kind: LibCard["kind"]; w?: string }[] =
        n < 138
          ? [
              { idSuffix: "listen", kind: "Listen" },
              { idSuffix: "speak", kind: "Speak" },
              { idSuffix: "fill-in", kind: "Fill-in", w: word },
              ...extraWords.map((ew, ei) => ({ idSuffix: `fill-extra-${ei + 1}`, kind: "Fill-in" as const, w: ew })),
            ]
          : [
              { idSuffix: "listen", kind: "Listen" },
              { idSuffix: "speak", kind: "Speak" },
            ];
      baseKinds.forEach(({ idSuffix, kind, w }) => {
        const i = savedIdx++;
        // First 8 saved cards (L1, L2, first 2 of L3) are learning; 9th (3rd of L3) is due review;
        // L4..L16 (indices 9..51) are un-mastered new cards; later cards mix review and new.
        const status: LibCard["status"] = i < 8 ? "learning" : i === 8 ? "review" : i < 220 ? "new" : "review";
        const mastered = i >= 55 && i % 23 === 7;
        const wKey = w ? lookupKey(w) : "";
        cards.push({
          id: isS3 ? `s3-${idSuffix}` : `${id}-${idSuffix}`,
          sentenceId: id,
          kind,
          word: w,
          savedAt: i,
          status,
          mastered,
          favorite: w ? Boolean(FAVORITE_FIXTURES[wKey]) : false,
          lookups: w ? (LOOKUP_FIXTURES[wKey] ?? 0) : 0,
          saved: true,
        });
      });
      // Sentences with two saved cards also offer one derived card that is not saved yet.
      if (n >= 138 && !isS3) {
        const uw = fe.replace(/[.,]/g, "").split(" ").slice(-1)[0];
        const wKey = lookupKey(uw);
        cards.push({
          id: `${id}-fill-in`,
          sentenceId: id,
          kind: "Fill-in",
          word: uw,
          savedAt: 10_000 + n,
          status: "new",
          mastered: false,
          favorite: Boolean(FAVORITE_FIXTURES[wKey]),
          lookups: LOOKUP_FIXTURES[wKey] ?? 0,
          saved: false,
        });
      }
      n++;
    }
  }
  return { sentences, cards };
}

/* ---------- Independent Recall / Dictation sources ---------- */

export interface PracticeItem {
  id: string;
  fr: string;
  en: string;
  steps: { fr: string; en: string }[];
  label: string; // neutral label, never the French target
}

const toItem = (s: StudySentence, label: string): PracticeItem => ({
  id: s.id,
  fr: s.fr,
  en: s.en,
  label,
  steps: s.steps.map((st) => ({ fr: st.parts.map((p) => p.t).join(""), en: st.en })),
});

export const LAST_STUDIED = [toItem(S1, "Last studied sentence · 10 words")];

export const QUEUE_PRACTICE: PracticeItem[] = [
  {
    id: "q1",
    fr: "J’ai oublié mon rendez-vous.",
    en: "I forgot my appointment.",
    label: "Review sentence 1 · 4 words",
    steps: [
      { fr: "J’ai oublié.", en: "I forgot." },
      { fr: "J’ai oublié mon rendez-vous.", en: "I forgot my appointment." },
    ],
  },
  toItem(S2, "Review sentence 2 · 7 words"),
  toItem(S3, "Review sentence 3 · 9 words"),
];

export const CHOOSABLE: PracticeItem[] = [
  ...QUEUE_PRACTICE,
  toItem(S1, "Saved sentence · Weekend plans · 10 words"),
  {
    id: "c5",
    fr: "Ma sœur arrive demain.",
    en: "My sister arrives tomorrow.",
    label: "Saved sentence · Family · 4 words",
    steps: [
      { fr: "Ma sœur arrive.", en: "My sister arrives." },
      { fr: "Ma sœur arrive demain.", en: "My sister arrives tomorrow." },
    ],
  },
];

/* ---------- Review queue pool; default session = 40 cards = 8 learning + 1 due review + 31 new ---------- */

export interface ReviewCard {
  id: string;
  sentenceId: string;
  group: "learning" | "due" | "new";
  kind: "Speak" | "Fill-in" | "Listen" | "Recall";
  prompt: string; // English prompt or fill-in sentence with a blank (never the full target)
  target: string;
  sentenceFr: string;
}

export function wordCardImportance(c: LibCard, lookups: Record<string, { count: number }> = {}): number {
  if (c.kind !== "Fill-in" || !c.word) return 0;
  const k = lookupKey(c.word);
  const count = lookups[k]?.count ?? LOOKUP_FIXTURES[k] ?? c.lookups ?? 0;
  return importanceFor(count);
}

/** Documented new-card introduction order: earliest Saved time first, higher importance for ties, then stable card ID. */
export function sortNewCardsForIntroduction(cards: LibCard[], lookups: Record<string, { count: number }> = {}): LibCard[] {
  return [...cards].sort(
    (a, b) =>
      a.savedAt - b.savedAt ||
      wordCardImportance(b, lookups) - wordCardImportance(a, lookups) ||
      a.id.localeCompare(b.id),
  );
}

export function toReviewCard(c: LibCard, group: ReviewCard["group"], sentences: LibSentence[]): ReviewCard {
  const s = sentences.find((x) => x.id === c.sentenceId)!;
  if (c.kind === "Fill-in" && c.word) {
    const blanked = s.fr.replace(new RegExp(c.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "_____");
    return { id: c.id, sentenceId: c.sentenceId, group, kind: "Fill-in", prompt: blanked, target: c.word, sentenceFr: s.fr };
  }
  if (c.kind === "Listen") return { id: c.id, sentenceId: c.sentenceId, group, kind: "Listen", prompt: "", target: s.fr, sentenceFr: s.fr };
  return { id: c.id, sentenceId: c.sentenceId, group, kind: "Speak", prompt: s.en, target: s.fr, sentenceFr: s.fr };
}

/**
 * Orders session cards for presentation so two cards from the same sentence are never adjacent
 * (at least 3 other cards between siblings when possible), while preserving the set of chosen cards.
 */
export function spaceSessionCards(cards: ReviewCard[]): ReviewCard[] {
  const pool = [...cards];
  const out: ReviewCard[] = [];
  while (pool.length > 0) {
    const remBySentence = new Map<string, number>();
    for (const c of pool) remBySentence.set(c.sentenceId, (remBySentence.get(c.sentenceId) ?? 0) + 1);
    let pickedIdx = -1;
    for (const gap of [4, 3, 2, 1]) {
      const recent = new Set(out.slice(-(gap - 1)).map((c) => c.sentenceId));
      const candidates = pool
        .map((c, idx) => ({ c, idx, rem: remBySentence.get(c.sentenceId) ?? 1 }))
        .filter((x) => gap === 1 || !recent.has(x.c.sentenceId));
      if (!candidates.length) continue;
      // On the very first slot, keep a typed card (Listen or Fill-in) first if available;
      // and whenever a sentence has many remaining siblings relative to remaining slots, place it early so siblings stay >= 4 apart.
      const maxRem = Math.max(...candidates.map((x) => x.rem));
      const chosen =
        out.length === 0
          ? candidates.find((x) => x.rem === maxRem && x.c.kind !== "Speak") ??
            candidates.find((x) => x.c.kind !== "Speak") ??
            candidates[0]
          : candidates.find((x) => x.rem === maxRem) ?? candidates[0];
      pickedIdx = chosen.idx;
      break;
    }
    out.push(pool.splice(pickedIdx, 1)[0]);
  }
  return out;
}

/**
 * The pool of cards that can appear in Review today: all learning cards, the due review cards, and every
 * new card in introduction order. It is NOT the session: planSession() decides how much of it fits.
 */
export function buildQueue(
  sentences: LibSentence[],
  cards: LibCard[],
  lookups: Record<string, { count: number }> = {},
): ReviewCard[] {
  const nonMastered = cards.filter((c) => c.saved && !c.mastered);
  const learning = nonMastered.filter((c) => c.status === "learning").slice(0, 8);
  const due = nonMastered.filter((c) => c.status === "review").slice(0, 1);
  const newPool = sortNewCardsForIntroduction(
    nonMastered.filter((c) => c.status === "new"),
    lookups,
  );
  return [
    ...learning.map((c) => toReviewCard(c, "learning", sentences)),
    ...due.map((c) => toReviewCard(c, "due", sentences)),
    ...newPool.map((c) => toReviewCard(c, "new", sentences)),
  ];
}

export type BindingLimit = "daily" | "session" | "library";

export interface SessionPlan {
  cards: ReviewCard[];
  learning: number;
  due: number;
  newCount: number;
  /** Learning + due cards that did not fit and wait for the next session. */
  waiting: number;
  /** New-card allowances left today (daily limit minus introduced). */
  remainingAllowances: number;
  /** New cards still waiting in the library for today (not yet completed). */
  newAvailable: number;
  /** Which limit stopped more new cards from being added. */
  binding: BindingLimit;
}

/**
 * Fill order: learning, then due reviews (queue order is earliest-due first), then new cards.
 * New cards = min(remaining daily allowances, session size − learning − due, new cards available).
 * Learning and due reviews never use allowances. `done` holds cards already completed in earlier sessions today.
 */
export function planSession(
  queue: ReviewCard[],
  opts: { sessionSize: number; dailyNew: number; newUsed: number; done?: Record<string, boolean> },
): SessionPlan {
  const open = queue.filter((c) => !opts.done?.[c.id]);
  const fixed = [...open.filter((c) => c.group === "learning"), ...open.filter((c) => c.group === "due")];
  const taken = fixed.slice(0, opts.sessionSize);
  const newPool = open.filter((c) => c.group === "new");
  const remainingAllowances = Math.max(0, opts.dailyNew - opts.newUsed);
  const room = Math.max(0, opts.sessionSize - taken.length);
  const newCount = Math.min(remainingAllowances, room, newPool.length);
  const binding: BindingLimit =
    newCount === remainingAllowances && remainingAllowances <= room ? "daily" : newCount === room && room < remainingAllowances ? "session" : "library";
  return {
    cards: spaceSessionCards([...taken, ...newPool.slice(0, newCount)]),
    learning: taken.filter((c) => c.group === "learning").length,
    due: taken.filter((c) => c.group === "due").length,
    newCount,
    waiting: fixed.length - taken.length,
    remainingAllowances,
    newAvailable: newPool.length,
    binding,
  };
}

/* ---------- OCR sample photos ---------- */

export interface OcrLine {
  id: string;
  text: string;
  low?: string[]; // low-confidence words
}
export interface SamplePhoto {
  id: string;
  title: string;
  desc: string;
  outcome: "ok" | "partial" | "none" | "overlimit";
  lines: OcrLine[];
}
export const OCR_LIMIT = 10;
export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: "note",
    title: "Handwritten note",
    desc: "A short note on lined paper",
    outcome: "ok",
    lines: [
      { id: "o1", text: "Il y a deux jours, j’ai failli oublier mon rendez-vous." },
      { id: "o2", text: "Heureusement, ma sœur m’a apelé ce matin.", low: ["apelé"] },
      { id: "o3", text: "Nous avons pris un café près de la gare." },
    ],
  },
  {
    id: "board",
    title: "Café menu board",
    desc: "A chalkboard, partly covered by glare",
    outcome: "partial",
    lines: [
      { id: "b1", text: "Le plat du jour est une soupe aux légumes." },
      { id: "b2", text: "Le café est offert avec le dessert.", low: ["offert"] },
    ],
  },
  {
    id: "textbook",
    title: "Textbook page",
    desc: "A full page with many sentences",
    outcome: "overlimit",
    lines: Array.from({ length: 13 }, (_, i) => ({
      id: `t${i}`,
      text: [
        "Je m’appelle Léa et j’habite à Québec.",
        "Le matin, je prends le métro.",
        "Mon bureau est près du fleuve.",
        "À midi, je mange avec mes collègues.",
        "Le soir, je fais du sport.",
        "Le samedi, je vais au marché.",
        "J’achète des fruits et du pain.",
        "Le dimanche, je téléphone à ma mère.",
        "Elle habite à Montréal.",
        "Nous parlons pendant une heure.",
        "Ensuite, je prépare la semaine.",
        "J’aime cette routine.",
        "Elle est simple et calme.",
      ][i],
      low: i === 4 ? ["sport"] : undefined,
    })),
  },
  { id: "blur", title: "Blurry receipt", desc: "Out of focus, very low light", outcome: "none", lines: [] },
];

/* ---------- History ---------- */

export interface AnalysisRec {
  id: string;
  date: string;
  source: "Pasted text" | "Photo import" | "My own idea";
  sentences: number;
  preview: string;
  text: string;
}
export interface AudioRec {
  id: string;
  date: string;
  owner: string;
  contentSeconds: number;
  speed: number;
  countedSeconds: number;
}
export interface AttemptRec {
  id: string;
  date: string;
  kind: "Recall" | "Dictation";
  sentence: string;
  scope: "Whole sentence" | "Step by step";
  step?: number;
  state: "completed" | "pending";
  outcome?: "correct" | "incorrect";
  hinted: boolean;
  answerKnown: boolean;
  response?: string;
  saved: "saved" | "failed";
}

export const HISTORY_ANALYSES: AnalysisRec[] = [
  {
    id: "a1",
    date: "Mar 3",
    source: "Pasted text",
    sentences: 3,
    preview: "Il y a deux jours, j’ai failli…",
    text: EXAMPLE_TEXT,
  },
  {
    id: "a2",
    date: "Mar 2",
    source: "Photo import",
    sentences: 5,
    preview: "Le plat du jour est une soupe…",
    text: "Le plat du jour est une soupe aux légumes. Le café est offert avec le dessert. Nous avons pris une table près de la fenêtre. Le serveur nous a apporté de l’eau. C’était très bon.",
  },
  {
    id: "a3",
    date: "Feb 28",
    source: "My own idea",
    sentences: 1,
    preview: "Je voudrais changer mon rendez-vous.",
    text: "Je voudrais changer mon rendez-vous.",
  },
  {
    id: "a4",
    date: "Feb 26",
    source: "Pasted text",
    sentences: 4,
    preview: "Le samedi, je vais au marché…",
    text: "Le samedi, je vais au marché. J’achète des fruits et du pain. Ensuite, je prends un café. Je rentre chez moi à midi.",
  },
  {
    id: "a5",
    date: "Feb 23",
    source: "Pasted text",
    sentences: 2,
    preview: "Nous avons pris un café…",
    text: "Nous avons pris un café près de la gare. Heureusement, ma sœur m’a appelé ce matin.",
  },
];

export const HISTORY_AUDIO: AudioRec[] = [
  { id: "u1", date: "Mar 4", owner: "Episode · Un samedi au marché", contentSeconds: 600, speed: 2, countedSeconds: 300 },
  { id: "u2", date: "Mar 3", owner: "Study · Sentence playback", contentSeconds: 95, speed: 1, countedSeconds: 95 },
  { id: "u3", date: "Mar 3", owner: "Episode · Conversations au café", contentSeconds: 900, speed: 1, countedSeconds: 900 },
  { id: "u4", date: "Mar 2", owner: "Practice · Listen", contentSeconds: 240, speed: 1.25, countedSeconds: 192 },
  { id: "u5", date: "Mar 1", owner: "Episode · La météo de la semaine", contentSeconds: 540, speed: 1, countedSeconds: 540 },
  { id: "u6", date: "Feb 28", owner: "Audio Studio · Prepared text", contentSeconds: 180, speed: 0.75, countedSeconds: 240 },
];

const att = (
  i: number,
  kind: AttemptRec["kind"],
  outcome: AttemptRec["outcome"],
  flags: Partial<AttemptRec> = {},
): AttemptRec => ({
  id: `h${i}`,
  date: ["Mar 4", "Mar 3", "Mar 3", "Mar 2", "Mar 2", "Mar 1", "Feb 28", "Feb 28", "Feb 27", "Feb 26", "Feb 25", "Feb 24"][i],
  kind,
  sentence: ["J’ai oublié mon rendez-vous.", "Ma sœur arrive demain.", "Nous avons pris un café près de la gare."][i % 3],
  scope: i % 4 === 1 ? "Step by step" : "Whole sentence",
  step: i % 4 === 1 ? 2 : undefined,
  state: "completed",
  outcome,
  hinted: false,
  answerKnown: false,
  saved: "saved",
  ...flags,
});

export const HISTORY_ATTEMPTS: AttemptRec[] = [
  att(0, "Dictation", "correct"),
  att(1, "Recall", "correct"),
  att(2, "Dictation", "incorrect", { response: "J’ai oublié rendez-vous." }),
  att(3, "Recall", "correct"),
  att(4, "Dictation", "correct", { hinted: true }),
  att(5, "Recall", "incorrect", { hinted: true }),
  att(6, "Dictation", "correct"),
  att(7, "Recall", "correct", { answerKnown: true }),
  att(8, "Dictation", "correct"),
  att(9, "Recall", "correct", { answerKnown: true }),
  att(10, "Dictation", "correct"),
  att(11, "Recall", undefined, { state: "pending" }),
];

/* ---------- Episodes ---------- */

export interface Episode {
  id: string;
  title: string;
  desc: string;
  level: string;
  durationSeconds: number;
  position: number;
  available: boolean;
  transcript: { at: number; fr: string; en: string }[];
}

export const EPISODES: Episode[] = [
  {
    id: "e1",
    title: "Un samedi au marché",
    desc: "Two friends shop for fruit and talk about the week.",
    level: "A2",
    durationSeconds: 18 * 60,
    position: 12 * 60 + 40,
    available: true,
    transcript: [
      { at: 0, fr: "Bonjour ! Tu viens au marché avec moi ?", en: "Hi! Are you coming to the market with me?" },
      { at: 30, fr: "Oui, j’ai besoin de pommes et de pain.", en: "Yes, I need apples and bread." },
      { at: 70, fr: "Les fraises sont chères cette semaine.", en: "Strawberries are expensive this week." },
      { at: 120, fr: "On prend un café après ?", en: "Shall we get a coffee afterwards?" },
    ],
  },
  {
    id: "e2",
    title: "Le métro de Montréal",
    desc: "A short story about a first day on the metro.",
    level: "B1",
    durationSeconds: 22 * 60,
    position: 0,
    available: true,
    transcript: [
      { at: 0, fr: "C’était mon premier jour à Montréal.", en: "It was my first day in Montreal." },
      { at: 40, fr: "J’ai failli prendre la mauvaise ligne.", en: "I almost took the wrong line." },
    ],
  },
  {
    id: "e3",
    title: "Trouver un appartement",
    desc: "Calling a landlord about a flat.",
    level: "B1",
    durationSeconds: 25 * 60,
    position: 0,
    available: false,
    transcript: [],
  },
  {
    id: "e4",
    title: "Conversations au café",
    desc: "Everyday small talk at a café counter.",
    level: "A2",
    durationSeconds: 15 * 60,
    position: 15 * 60,
    available: true,
    transcript: [{ at: 0, fr: "Un café au lait, s’il vous plaît.", en: "A café au lait, please." }],
  },
  {
    id: "e5",
    title: "La météo de la semaine",
    desc: "A calm weather report for the week.",
    level: "A2",
    durationSeconds: 9 * 60,
    position: 0,
    available: true,
    transcript: [{ at: 0, fr: "Lundi, il fera froid et ensoleillé.", en: "On Monday, it will be cold and sunny." }],
  },
];

/* ---------- Practice ---------- */

export const WRITE_TASK = {
  prompt: "Écrivez un message à un ami pour proposer une sortie samedi. Donnez le lieu, l’heure et une raison.",
  promptEn: "Write a message to a friend suggesting an outing on Saturday. Give the place, the time and a reason.",
  min: 40,
  max: 120,
};

export const SPEAK_TASK = {
  prompt: "Parlez de votre quartier : qu’est-ce que vous aimez, et qu’est-ce que vous voudriez changer ?",
  promptEn: "Talk about your neighbourhood: what you like, and what you would change.",
};

export const LISTEN_TASK = {
  title: "Annonce à la gare",
  transcript: "Mesdames et messieurs, le train de 9 h 15 à destination de Québec partira du quai 4 avec dix minutes de retard.",
  questions: [
    {
      id: "lq1",
      q: "Where is the train going?",
      options: ["Montréal", "Québec", "Ottawa", "Toronto"],
      answer: 1,
      why: "The announcement says “à destination de Québec”.",
    },
    {
      id: "lq2",
      q: "What is the problem?",
      options: ["The train is cancelled", "The platform changed", "The train is 10 minutes late", "Tickets are sold out"],
      answer: 2,
      why: "“Avec dix minutes de retard” means ten minutes late.",
    },
  ],
};

export const STUDIO_SAMPLES = [
  { id: "st1", title: "Weekend message", text: "Salut ! On se retrouve samedi à 14 h devant la bibliothèque ?" },
  { id: "st2", title: "Appointment call", text: "Bonjour, je voudrais déplacer mon rendez-vous à jeudi matin." },
];

/* ---------- Exam preview (original fictional content, structure only) ---------- */

export const EXAM_STRUCTURE = [
  { key: "listening", name: "Listening", detail: "39 questions · four options each", minutes: 35, slots: 39 },
  { key: "reading", name: "Reading", detail: "39 questions · four options each", minutes: 60, slots: 39 },
  { key: "writing", name: "Writing", detail: "3 tasks", minutes: 60, slots: 3 },
  { key: "speaking", name: "Speaking", detail: "3 tasks · 12 minutes total, including 2 minutes of preparation", minutes: 12, slots: 3 },
] as const;
export const EXAM_TOTAL_MINUTES = 35 + 60 + 60 + 12; // 167 = 2 h 47 min

export interface McQ {
  id: string;
  q: string;
  options: string[];
  answer: number;
  why: string;
}
export const EXAM_LISTENING: McQ[] = [
  {
    id: "x-l1",
    q: "(Sample audio) Why is the caller phoning the clinic?",
    options: ["To cancel an appointment", "To move an appointment", "To ask for directions", "To pay a bill"],
    answer: 1,
    why: "The caller says “je voudrais déplacer mon rendez-vous”.",
  },
  {
    id: "x-l2",
    q: "(Sample audio) When does the library close on Saturday?",
    options: ["At noon", "At 5 p.m.", "At 6 p.m.", "It is closed"],
    answer: 2,
    why: "“Le samedi, nous fermons à 18 h.”",
  },
  {
    id: "x-l3",
    q: "(Sample audio) What does the speaker recommend?",
    options: ["Take the bus", "Walk", "Take a taxi", "Drive"],
    answer: 0,
    why: "“Le plus simple, c’est de prendre le bus 24.”",
  },
];
export const EXAM_READING_PASSAGE =
  "Avis aux résidents : à partir du lundi 9 mars, la collecte des déchets recyclables aura lieu le mardi matin au lieu du jeudi. Merci de sortir vos bacs la veille, après 19 h. Pour toute question, contactez le bureau municipal.";
export const EXAM_READING: McQ[] = [
  {
    id: "x-r1",
    q: "What changes on March 9?",
    options: ["The office hours", "The recycling day", "The bin colour", "The bus route"],
    answer: 1,
    why: "Recycling moves from Thursday to Tuesday morning.",
  },
  {
    id: "x-r2",
    q: "When should residents put their bins out?",
    options: ["Tuesday after 7 a.m.", "Monday after 7 p.m.", "Thursday morning", "Any time"],
    answer: 1,
    why: "“La veille, après 19 h” — the evening before, after 7 p.m.",
  },
  {
    id: "x-r3",
    q: "Who should residents contact with questions?",
    options: ["Their neighbour", "The recycling company", "The municipal office", "The police"],
    answer: 2,
    why: "“Contactez le bureau municipal.”",
  },
];
export const EXAM_WRITING = [
  { id: "w1", title: "Task 1", prompt: "Écrivez un court message à un collègue pour l’inviter à un dîner (60–120 mots)." },
  { id: "w2", title: "Task 2", prompt: "Racontez une expérience récente dans un nouveau quartier (120–150 mots)." },
  { id: "w3", title: "Task 3", prompt: "Comparez deux opinions sur le télétravail et donnez votre avis (120–180 mots)." },
];
export const EXAM_SPEAKING = [
  { id: "sp1", title: "Task 1", prompt: "Présentez-vous : votre travail, vos loisirs, vos projets." },
  { id: "sp2", title: "Task 2", prompt: "Vous voulez louer un appartement. Posez des questions au propriétaire." },
  { id: "sp3", title: "Task 3", prompt: "Selon vous, faut-il interdire les voitures au centre-ville ? Expliquez." },
];
