import { describe, expect, it } from "vitest";
import {
  clampDurationMs,
  normalizeAnalyze,
  normalizeAttempt,
  normalizeCard,
  normalizeEpisode,
  normalizeEpisodes,
  normalizeQueue,
  normalizeSpeakTasks,
  normalizeWriteTasks,
  type RawAnalyzeSentence,
  type RawAttempt,
  type RawEpisode,
  type RawSrsCard,
  type RawSrsQueue,
  type RawTasks,
} from "@/api/normalize";
import {
  episodeCreated,
  episodesList,
  speakAttemptReady,
  speakTasks,
  srsQueue,
  writeAttemptGenerating1,
  writeAttemptGenerating2,
  writeAttemptReady1,
  writeAttemptReady2,
  writeTasks,
} from "./fixtures/backend";

const queue = srsQueue as unknown as RawSrsQueue;
const card = (mode: string) => {
  const c = queue.cards.find((x) => x.mode === mode);
  if (!c) throw new Error(`fixture has no ${mode} card`);
  return c as RawSrsCard;
};

describe("normalizeCard", () => {
  it("lifts the note text to the top level for listen and speak cards", () => {
    const c = normalizeCard(card("listen"));
    expect(c.sentence).toBe("Nous habitons à Vancouver depuis deux ans.");
    expect(c.translation_en).toBe("We have lived in Vancouver for two years.");
    expect(c.translation_zh).toBe("我们在温哥华住了两年。");
    expect(c.intervals["4"]).toBeGreaterThan(0);
    expect(c.answer).toBeUndefined();
  });

  it("blanks the target in a cloze card and keeps it as the answer", () => {
    const c = normalizeCard(card("cloze"));
    expect(c.sentence).toBe("Nous ___ à Vancouver depuis deux ans.");
    // the page runs card.sentence.replace(...): it must be a string
    expect(() => c.sentence.replace(/___.*___|___/, "______")).not.toThrow();
    expect(c.answer).toBe("habitons");
    expect(c.target).toBe("habitons");
    expect(c["note"]).toBeDefined();
  });

  it("falls back to a bare blank when the target is not in the sentence", () => {
    const raw = { ...card("cloze"), target: "absent" };
    expect(normalizeCard(raw).sentence).toBe("___");
  });

  it("matches the target case-insensitively", () => {
    const raw = { ...card("cloze"), target: "NOUS" };
    expect(normalizeCard(raw).sentence).toBe("___ habitons à Vancouver depuis deux ans.");
  });

  it("shows the word and its meaning for a recognize card", () => {
    const c = normalizeCard(card("recognize"));
    expect(c.sentence).toBe("depuis");
    expect(c.translation_en).toBe("since");
    expect(c.translation_zh).toBe("自从");
  });

  it("builds the prompt of a grammar card from its meta", () => {
    const c = normalizeCard(card("grammar"));
    expect(c.sentence).toBe("Nous habitons ici ___ deux ans.");
    expect(c.answer).toBe("depuis");
    expect(c.translation_en).toBe("We have lived here for two years.");
  });

  it("survives a payload without note or intervals (list endpoints)", () => {
    const c = normalizeCard({ id: "c", note_id: "n", mode: "listen", state: "new", importance: 3 });
    expect(c.sentence).toBe("");
    expect(c.intervals).toEqual({ "1": 0, "2": 0, "3": 0, "4": 0 });
  });

  it("normalizes a whole queue and keeps the counts", () => {
    const q = normalizeQueue(queue);
    expect(q.cards).toHaveLength(queue.cards.length);
    expect(q.cards.every((c) => typeof c.sentence === "string")).toBe(true);
    expect(q.counts).toEqual(queue.counts);
  });
});

describe("clampDurationMs", () => {
  it("caps at one hour (SrsReviewRequest.duration_ms le=3_600_000)", () => {
    expect(clampDurationMs(7_200_000)).toBe(3_600_000);
    expect(clampDurationMs(1234.6)).toBe(1235);
    expect(clampDurationMs(-5)).toBe(0);
    expect(clampDurationMs(undefined)).toBeUndefined();
  });
});

describe("normalizeWriteTasks", () => {
  const out = normalizeWriteTasks(writeTasks as unknown as RawTasks);

  it("turns the task dict into a list of exam tasks only", () => {
    expect(out.tasks.map((t) => t.task)).toEqual(["T1", "T2", "T3"]);
  });

  it("drops the untimed P0-P2 training tasks that would auto-submit at 00:00", () => {
    expect(out.tasks.some((t) => t.task.startsWith("P"))).toBe(false);
  });

  it("maps words, minutes and subjects", () => {
    const t1 = out.tasks[0]!;
    expect(t1.word_range).toEqual([60, 120]);
    expect(t1.minutes).toBe(10);
    expect(out.tasks[2]!.minutes).toBe(30);
    expect(t1.subjects[0]?.prompt).toContain("Montréal");
    expect(t1.subjects[0]?.id).toBe("t1_1");
  });

  it("passes the recommendation through", () => {
    expect(out.recommended_task).toBe("T1");
    expect(out.recommended_level).toBe("A1");
  });

  it("gives a task without subjects an empty list instead of crashing", () => {
    const raw = { tasks: writeTasks.tasks, subjects: {} } as unknown as RawTasks;
    expect(normalizeWriteTasks(raw).tasks[0]?.subjects).toEqual([]);
  });
});

describe("normalizeSpeakTasks", () => {
  const out = normalizeSpeakTasks(speakTasks as unknown as RawTasks);

  it("maps timer_seconds to seconds and keeps the T2 preparation time", () => {
    expect(out.tasks.map((t) => [t.task, t.seconds, t.prep_seconds])).toEqual([
      ["T1", 120, undefined],
      ["T2", 210, 120],
      ["T3", 270, undefined],
    ]);
  });

  it("defaults T2 preparation to 120 s when the backend omits it", () => {
    const raw = {
      tasks: { T2: { id: "T2", timer_seconds: 210 } },
      subjects: {},
    } as unknown as RawTasks;
    expect(normalizeSpeakTasks(raw).tasks[0]?.prep_seconds).toBe(120);
  });

  it("carries the subject object the attempt endpoint needs", () => {
    expect(out.tasks[1]?.subjects[0]).toMatchObject({
      id: "t2_s1",
      role_examiner: expect.any(String),
    });
  });
});

describe("normalizeAttempt", () => {
  const raw = (x: unknown) => x as RawAttempt;

  it("maps generating_1 and generating_2 to pending", () => {
    expect(normalizeAttempt(raw(writeAttemptGenerating1)).status).toBe("pending");
    expect(normalizeAttempt(raw(writeAttemptGenerating2)).status).toBe("pending");
  });

  it("omits feedback while it is still empty ({})", () => {
    const a = normalizeAttempt(raw(writeAttemptGenerating1));
    expect(a.feedback1).toBeUndefined();
    expect(a.feedback2).toBeUndefined();
  });

  it("derives hints from round-1 errors and keeps the rest of the feedback", () => {
    const a = normalizeAttempt(raw(writeAttemptReady1));
    expect(a.status).toBe("ready");
    expect(a.feedback1).toMatchObject({
      hints: ["Check the verb form."],
      praise: "Nice invitation!",
    });
    expect(a.feedback2).toBeUndefined();
  });

  it("does not expose empty round-2 feedback while round 2 is generating", () => {
    const a = normalizeAttempt(raw(writeAttemptGenerating2));
    expect(a.feedback2).toBeUndefined();
    expect(a.feedback1).toBeDefined();
  });

  it("maps round-2 feedback to the shape the page renders", () => {
    const fb = normalizeAttempt(raw(writeAttemptReady2)).feedback2!;
    expect(fb.corrected_text).toContain("à dîner");
    expect(fb.sentences[0]).toMatchObject({ original: "je t'invite samedi", chunk: "inviter à" });
    expect(Array.isArray(fb.structures)).toBe(true);
    // the page maps fb.sentences: it must always be an array
    expect(() => fb.sentences.map((s) => s.original)).not.toThrow();
  });

  it("uses corrected_transcript for speaking round 2", () => {
    const a = normalizeAttempt({
      id: "s",
      status: "ready",
      feedback_2: { corrected_transcript: "Bonjour.", sentences: [], structures: [] },
    });
    expect(a.feedback2?.corrected_text).toBe("Bonjour.");
  });

  it("keeps failed attempts and their error message", () => {
    const a = normalizeAttempt({ id: "a", status: "failed", error: "trial ended" });
    expect(a.status).toBe("failed");
    expect(a.error).toBe("trial ended");
  });

  it("exposes speaking stats: wpm and the T2 question count", () => {
    const a = normalizeAttempt(raw(speakAttemptReady));
    expect(a.status).toBe("ready");
    expect(a["questions_asked"]).toBe(3);
    expect(a["pause_ratio"]).toBeUndefined();
  });

  it("treats wpm 0 (not measured) as absent", () => {
    expect(normalizeAttempt({ id: "a", status: "ready", wpm: 0 }).wpm).toBeUndefined();
    expect(normalizeAttempt({ id: "a", status: "ready", wpm: 96.5 }).wpm).toBe(96.5);
  });
});

describe("normalizeEpisodes", () => {
  it("unwraps the list and lifts settings.level/minutes", () => {
    const list = normalizeEpisodes(episodesList as unknown as { episodes: RawEpisode[] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ level: "A2", minutes: 20, status: "generating" });
  });

  it("normalizes a bare created episode", () => {
    const ep = normalizeEpisode(episodeCreated as unknown as RawEpisode);
    expect(ep.level).toBe("A2");
    expect(ep.title).toBe("");
  });

  it("keeps ready and failed statuses and survives missing settings", () => {
    const base = { id: "e", created_at: "2026-10-17T00:00:00Z" };
    expect(normalizeEpisode({ ...base, status: "ready", title: "T" }).status).toBe("ready");
    const failed = normalizeEpisode({ ...base, status: "failed", error: "boom" });
    expect(failed).toMatchObject({ status: "failed", error: "boom", level: "", minutes: 0 });
  });
});

describe("normalizeAnalyze", () => {
  // tts_service.py request_french_analysis(): V2 sentence (words/build_up/alignment)
  const v2: RawAnalyzeSentence = {
    sentence: "Nous habitons ici.",
    original: "Nous habitons ici.",
    translation_en: "We live here.",
    translation_zh: "我们住在这里。",
    alignment: [{ fr: "Nous habitons", en: "We live" }],
    order_note: "",
    build_up: [
      { fr: "Nous", en: "We", new: "Nous" },
      { fr: "Nous habitons", en: "We live", new: "habitons" },
    ],
    words: [
      {
        fr: "habitons",
        ipa: "a.bi.tɔ̃",
        lemma: "habiter",
        type: "verb",
        meaning: "live",
        meaning_zh: "居住",
        why: "present, nous",
        english_link: "inhabit",
        false_friend: false,
      },
    ],
    grammar_points: [{ title: "Present", explanation: "-ons ending", hook: "" }],
    pronunciation_tips: ["Liaison: nous_habitons", "Nasal vowel in -ons"],
  };

  it("maps V2 words to the fields the pages read", () => {
    const [s] = normalizeAnalyze({ sentences: [v2] }).sentences;
    expect(s?.text).toBe("Nous habitons ici.");
    expect(s?.build_up).toEqual(["Nous", "Nous habitons"]);
    expect(s?.words[0]).toMatchObject({
      word: "habitons",
      lemma: "habiter",
      pos: "verb",
      en: "live",
      zh: "居住",
      english_link: "inhabit",
    });
    expect(s?.words[0]?.false_friend).toBeUndefined();
    expect(s?.pronunciation_tips).toBe("Liaison: nous_habitons\nNasal vowel in -ons");
  });

  it("flags false friends", () => {
    const flagged = { ...v2, words: [{ ...v2.words![0]!, false_friend: true }] };
    expect(normalizeAnalyze({ sentences: [flagged] }).sentences[0]?.words[0]?.false_friend).toBe(
      true,
    );
  });

  it("gives every word a defined `word` so Add to cards never posts an undefined sentence", () => {
    const [s] = normalizeAnalyze({ sentences: [v2] }).sentences;
    expect(s?.words.every((w) => typeof w.word === "string" && w.word.length > 0)).toBe(true);
  });

  it("reads a legacy V1 sentence (tokens, no words) without crashing", () => {
    const v1: RawAnalyzeSentence = {
      original: "Bonjour.",
      sentence: "Bonjour.",
      translation_en: "Hello.",
      tokens: [
        {
          token: "Bonjour",
          lemma: "bonjour",
          pos: "noun",
          phonetic: "bɔ̃.ʒuʁ",
          explanation_en: "hello",
          explanation_cn: "你好",
        },
      ],
    };
    const [s] = normalizeAnalyze({ sentences: [v1] }).sentences;
    expect(s?.text).toBe("Bonjour.");
    expect(s?.build_up).toEqual([]);
    expect(s?.grammar_points).toEqual([]);
    expect(s?.words[0]).toMatchObject({ word: "Bonjour", en: "hello", zh: "你好" });
  });

  it("falls back to an empty word list when a sentence has neither words nor tokens", () => {
    const [s] = normalizeAnalyze({ sentences: [{ sentence: "Salut." }] }).sentences;
    expect(s?.words).toEqual([]);
  });
});
