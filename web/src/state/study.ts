import { STUDY_FIXTURES, type AnalysisRec, type StudySentence } from "../data/fixtures";
import { ApiError } from "../api/client";
import { loadSavedCards } from "../api/srs";
import { analyzeText, cleanInput, ideaToFrench, saveStudyHistory, toStudySentence } from "../api/study";
import { announce, get, go, patchStudy } from "./store";

export const LIMITS = { text: 2000, ideas: 300 } as const;
export const STAGES = ["Finding sentences", "Looking up words and phrases", "Preparing steps"];

const FRENCH_HINT =
  /[àâçéèêëîïôûùüÿœ’]|\b(le|la|les|un|une|des|je|j'|tu|il|elle|nous|vous|ils|elles|est|et|de|du|au|aux|avec|pour|pas|mon|ma|mes|ce|cette|qui|que|dans|sur|très|bonjour|merci)\b/i;

const norm = (s: string) => s.normalize("NFC").replace(/[’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export const IDEA_SENTENCE: StudySentence = {
  id: "idea1",
  fr: "J’ai failli oublier notre rendez-vous.",
  en: "I almost forgot our meeting.",
  segments: [
    { t: "J’ai", w: true }, { t: " " }, { t: "failli", w: true }, { t: " " }, { t: "oublier", w: true }, { t: " " },
    { t: "notre", w: true }, { t: " " }, { t: "rendez-vous", w: true }, { t: "." },
  ],
  steps: [
    { parts: [{ t: "J’ai failli oublier.", added: true }], en: "I almost forgot.", addedLabel: "Starting phrase: j’ai failli oublier", how: "Say it three times, slowly then at normal speed." },
    { parts: [{ t: "J’ai failli oublier " }, { t: "notre rendez-vous", added: true }, { t: "." }], en: "I almost forgot our meeting.", addedLabel: "Added: notre rendez-vous", how: "Add the new words without a pause." },
  ],
  grammar: STUDY_FIXTURES[0].grammar,
  cards: [
    { id: "idea1-listen", kind: "Listen", label: "Listen card · whole sentence" },
    { id: "idea1-speak", kind: "Speak", label: "Speak card · whole sentence" },
  ],
};

function genericSentence(fr: string, i: number): StudySentence {
  const words = fr.split(/\s+/).filter(Boolean);
  const segments = words.flatMap((w, k) => {
    const m = w.match(/^(.*?)([.,;:!?…]*)$/)!;
    const parts = [{ t: m[1], w: true }];
    if (m[2]) parts.push({ t: m[2], w: false });
    if (k < words.length - 1) parts.push({ t: " ", w: false });
    return parts;
  });
  const third = Math.max(1, Math.ceil(words.length / 3));
  const cuts = [third, third * 2, words.length].filter((v, k, a) => v <= words.length && a.indexOf(v) === k);
  const steps = cuts.map((c, k) => {
    const prev = k === 0 ? 0 : cuts[k - 1];
    const before = words.slice(0, prev).join(" ");
    const added = words.slice(prev, c).join(" ");
    return {
      parts: [{ t: before ? before + " " : "" }, { t: added, added: true }],
      en: "Simulated English meaning for this part (demo).",
      addedLabel: `Added: ${added.replace(/[.,;:!?…]+$/, "")}`,
      how: "Listen, then repeat the whole part aloud.",
    };
  });
  return {
    id: `c${i}-${norm(fr).length}`,
    fr,
    en: "Simulated English meaning for this custom sentence (demo).",
    segments,
    steps,
    grammar: null,
    cards: [
      { id: `c${i}-${norm(fr).length}-listen`, kind: "Listen", label: "Listen card · whole sentence" },
      { id: `c${i}-${norm(fr).length}-speak`, kind: "Speak", label: "Speak card · whole sentence" },
    ],
  };
}

/** Splits pasted text into sentences and keeps only the ones that look French (shared by analysis and re-opening from History). */
function frenchSentences(text: string): StudySentence[] {
  return splitSentences(text)
    .filter((p) => FRENCH_HINT.test(p))
    .map((p, i) => STUDY_FIXTURES.find((f) => norm(f.fr) === norm(p)) ?? genericSentence(p, i));
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validate(text: string, mode: "text" | "ideas"): "empty" | "invalid" | "over" | null {
  if (!text.trim()) return "empty";
  if (text.length > LIMITS[mode]) return "over";
  if (!/\p{L}/u.test(text)) return "invalid";
  return null;
}

let timers: ReturnType<typeof setTimeout>[] = [];
let controller: AbortController | null = null;

/** After this long the status says it is slower than usual (a long text is analysed part by part). */
export const LONG_AFTER_MS = 25_000;

const SOURCE_KEY = { "Pasted text": "text", "Photo import": "photo", "My own idea": "idea" } as const;

/** Analyses the current draft on the server. A cancelled or outdated run never replaces newer content. */
export async function runAnalysis(source: "Pasted text" | "Photo import" | "My own idea" = "Pasted text") {
  const s = get().study;
  const mode = source === "My own idea" ? "ideas" : "text";
  const input = mode === "ideas" ? s.drafts.ideas : s.drafts.text;
  const v = validate(input, mode);
  if (v === "invalid") {
    patchStudy({ analysis: { ...s.analysis, status: "invalid" } });
    announce("This text has no letters to analyse.", true);
    return;
  }
  if (v) return;
  const runId = s.analysis.runId + 1;
  timers.forEach(clearTimeout);
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  patchStudy({ analysis: { status: "running", runId, input, stage: 0, source } });
  announce(`Analysing. ${STAGES[0]}.`);
  const still = () => get().study.analysis.runId === runId && ["running", "long"].includes(get().study.analysis.status);
  const stage = (n: number) => still() && patchStudy({ analysis: { ...get().study.analysis, stage: n } });
  timers = [
    setTimeout(() => {
      if (!still()) return;
      patchStudy({ analysis: { ...get().study.analysis, status: "long" } });
      announce("This is taking longer than usual. Your text is kept.");
    }, LONG_AFTER_MS),
  ];
  try {
    const french = mode === "ideas" ? await ideaToFrench(input, ctl.signal) : ((await cleanInput(input, ctl.signal)) ?? input);
    if (!still()) return;
    stage(1);
    const { sentences: raw } = await analyzeText(french, {
      signal: ctl.signal,
      onProgress: (p) => p.done === p.total && stage(2),
    });
    if (!still()) return;
    timers.forEach(clearTimeout);
    if (!raw.length) {
      patchStudy({ analysis: { ...get().study.analysis, status: "nofrench" } });
      announce("No usable French sentences found. Your text is kept.");
      return;
    }
    const sentences = raw.map(toStudySentence);
    patchStudy({
      analysis: { ...get().study.analysis, status: "done", input: french },
      sentences,
      index: 0,
      step: 0,
      tab: "steps",
      sourceOpen: false,
      restored: false,
    });
    // Background: History keeps the analysis; Add to review learns which cards already exist.
    saveStudyHistory(french, raw, SOURCE_KEY[source]).catch(() => announce("This analysis couldn’t be saved to History.", true));
    loadSavedCards(sentences.map((x) => x.fr)).catch(() => undefined);
    if (get().route.startsWith("study")) go("study", { focus: false });
    announce(`Analysis complete. ${sentences.length} ${sentences.length === 1 ? "sentence" : "sentences"} ready.`);
    requestAnimationFrame(() => document.getElementById("current-sentence-heading")?.focus());
  } catch (err) {
    if (!still()) return;
    timers.forEach(clearTimeout);
    patchStudy({ analysis: { ...get().study.analysis, status: "failed", error: err instanceof ApiError ? err.message : undefined } });
    announce("Analysis did not finish. Your text is kept.", true);
  }
}

export function cancelAnalysis() {
  timers.forEach(clearTimeout);
  controller?.abort();
  controller = null;
  const a = get().study.analysis;
  patchStudy({ analysis: { ...a, status: "cancelled" } });
  announce("Analysis cancelled. Your text is kept.");
}

export function buildSentencesForAnalysis(text: string, source: AnalysisRec["source"]): StudySentence[] {
  // Same rules as runAnalysis: an idea becomes the idea sentence, pasted text keeps only French sentences.
  return source === "My own idea" ? [IDEA_SENTENCE] : frenchSentences(text);
}

export function openAnalysisInStudy(a: AnalysisRec) {
  const sentences = buildSentencesForAnalysis(a.text, a.source);
  const runId = get().study.analysis.runId + 1;
  patchStudy({
    analysis: { status: sentences.length ? "done" : "nofrench", runId, input: a.text, stage: 2, source: a.source },
    sentences,
    index: 0,
    step: 0,
    tab: "steps",
    sourceOpen: false,
    restored: false,
    drafts: { ...get().study.drafts, [a.source === "My own idea" ? "ideas" : "text"]: a.text },
  });
  go("study");
  announce(
    sentences.length
      ? `Opened analysis from ${a.date}: ${sentences.length} ${sentences.length === 1 ? "sentence" : "sentences"}.`
      : `Opened analysis from ${a.date}. No usable French sentences found. The text is kept.`,
  );
}
