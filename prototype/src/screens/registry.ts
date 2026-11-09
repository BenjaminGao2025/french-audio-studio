/* Screen/state registry for the Demo states navigator and the design-reference coverage table.
   Labels are neutral and never contain target answers. */
import { EXAMPLE_TEXT, QUEUE_PRACTICE, S1, S2, S3, SAMPLE_PHOTOS, SAMPLE_TEXT } from "../data/fixtures";
import { grade } from "../lib/grading";
import { lookupKey } from "../lib/lookup";
import { runAnalysis } from "../state/study";
import {
  armFailure,
  armSlow,
  get,
  go,
  initialExam,
  markMastered,
  patchStudy,
  set,
  setOffline,
  startPlayback,
  stopPlayback,
  undoMastery,
  updatePlayer,
  type ExamSection,
  type ExamState,
  type PlayerState,
} from "../state/store";
import { ensureSession, submitAnswer } from "./Exercise";
import { runItems } from "./Launcher";

export interface DemoState {
  key: string;
  label: string;
  apply: () => void;
}
export interface ScreenEntry {
  id: string;
  title: string;
  area: string;
  states: DemoState[];
}

/* ---------- helpers ---------- */
const at = (route: string, id?: string, value?: string, extra: Record<string, string> = {}) => {
  go(route, { keepDemo: true });
  set(() => ({ ss: id && value !== undefined ? { [id]: value, ...extra } : { ...extra } }));
};
const online = () => get().offline && setOffline(false);

function withAnalysis(multi = true) {
  const sentences = multi ? [S1, S2, S3] : [S1];
  patchStudy({
    sentences,
    index: 0,
    step: 0,
    tab: "steps",
    analysis: { status: "done", runId: get().study.analysis.runId + 1, input: multi ? EXAMPLE_TEXT : SAMPLE_TEXT, stage: 2, source: "Pasted text" },
    drafts: { ...get().study.drafts, text: multi ? EXAMPLE_TEXT : SAMPLE_TEXT },
  });
}

function input(mode: "text" | "ideas", text: string, extra: Partial<ReturnType<typeof get>["study"]> = {}) {
  const s = get().study;
  patchStudy({ mode, drafts: { ...s.drafts, [mode]: text }, analysis: { ...s.analysis, status: "idle" }, restored: false, ...extra });
}

function ocr(photoId: string, phase: ReturnType<typeof get>["study"]["ocr"]["phase"]) {
  const p = SAMPLE_PHOTOS.find((x) => x.id === photoId)!;
  patchStudy({ ocr: { phase, photoId, partial: p.outcome === "partial", lines: phase === "results" ? p.lines.map((l) => ({ ...l, selected: true })) : [] } });
}

function demoExercise(kind: "Recall" | "Dictation", setup?: (key: string) => void, index = 0) {
  online();
  const key = `demo:${kind}:${Date.now()}`;
  runItems.set(key, { kind, source: "Today’s review queue", items: QUEUE_PRACTICE });
  ensureSession(key, kind, "Today’s review queue", QUEUE_PRACTICE);
  set((s) => ({ activeRun: key, exercises: { ...s.exercises, [key]: { ...s.exercises[key], index } } }));
  at("study/run");
  setup?.(key);
}
const DEFAULT_UI = { phase: "answering", hint: false, revealed: false };
const qk = (index = 0, mode: "whole" | "step" = "whole", step = 0) => `${index}:${mode}:${mode === "step" ? step : "w"}`;
function draft(key: string, text: string, k = qk()) {
  set((s) => ({ exercises: { ...s.exercises, [key]: { ...s.exercises[key], drafts: { ...s.exercises[key].drafts, [k]: text } } } }));
}
function ui(key: string, p: Record<string, unknown>, k = qk()) {
  set((s) => {
    const sess = s.exercises[key];
    return { exercises: { ...s.exercises, [key]: { ...sess, ui: { ...sess.ui, [k]: { ...DEFAULT_UI, ...(sess.ui[k] ?? {}), ...p } as never } } } };
  });
}
const T1 = QUEUE_PRACTICE[0].fr; // used only to pre-fill a learner response in post-submission demo states
const answered = (kind: "Recall" | "Dictation", response: string, pre?: (key: string) => void, index = 0) =>
  demoExercise(
    kind,
    (key) => {
      pre?.(key);
      draft(key, response, qk(index));
      submitAnswer(key);
    },
    index,
  );

function player(status: PlayerState["status"], extra: Partial<PlayerState> = {}) {
  withAnalysis();
  at("study");
  startPlayback({ kind: "study", label: "Study audio · Sentence 1", route: "study" }, 4.5, { scope: "sentence" });
  setTimeout(() => updatePlayer({ status, ...extra }), status === "loading" ? 0 : 750);
}

function review(p: Record<string, unknown> = {}, cardUi?: (target: string) => Record<string, unknown>) {
  online();
  set((s) => {
    const card = s.queue[0];
    return {
      review: { ...s.review, phase: "active", index: 0, allowance: 31 },
      reviewUi: cardUi ? { ...s.reviewUi, [card.id]: { draft: "", phase: "answering", hint: false, revealed: false, ...cardUi(card.target) } as never } : s.reviewUi,
      ...p,
    };
  });
  at("review/session");
}

function mastery(state?: "undone" | "expired" | "queued" | "syncing" | "conflict") {
  const card = get().cards.find((c) => c.saved && !c.mastered)!;
  if (state === "queued") setOffline(true);
  else online();
  markMastered(card.id);
  const last = get().mastery[get().mastery.length - 1];
  if (state === "undone" || state === "queued") undoMastery(last.id);
  if (state === "expired") set((s) => ({ mastery: s.mastery.map((m) => (m.id === last.id ? { ...m, at: Date.now() - 6500 } : m)) }));
  if (state === "syncing" || state === "conflict") set((s) => ({ mastery: s.mastery.map((m) => (m.id === last.id ? { ...m, state, undoAt: m.at + 3200 } : m)) }));
  at("review/library");
}

function exam(mode: ExamState["mode"], section: ExamSection, extra: Partial<ExamState> = {}) {
  online();
  const now = Date.now();
  const minutes = mode === "full" ? 167 : { listening: 35, reading: 60, writing: 60, speaking: 12 }[section];
  set((s) => ({
    exam: { ...initialExam(), practiceResults: s.exam.practiceResults, mockResults: s.exam.mockResults, mode, section, timed: mode !== "practice", startedAt: now, sectionStartedAt: now, budgetSeconds: minutes * 60, phase: "running", ...extra },
  }));
  at("practice/exams/run");
}

const states = (...xs: [string, string, () => void][]): DemoState[] => xs.map(([key, label, apply]) => ({ key, label, apply }));
const word = (entry: string, wstate: string, multi = true, index = 0) => {
  withAnalysis(multi);
  patchStudy({ index });
  at("study", "SCR-WRD-01", wstate, { word: entry });
};
const setCount = (n: number) => {
  // Set the fixture count just now so opening the popup is inside the 5-second window and doesn't change it.
  set((s) => ({ lookups: { ...s.lookups, [lookupKey("failli")]: { count: n, lastCounted: performance.now() / 1000 } } }));
  withAnalysis();
  at("study", "word", "failli");
};

/* ---------- registry ---------- */
export const REGISTRY: ScreenEntry[] = [
  {
    id: "SCR-SYS-01", title: "Authenticated shell", area: "System",
    states: states(
      ["desktop", "Desktop sidebar", () => { set(() => ({ frame: "fluid" })); at("study"); }],
      ["mobile", "iPhone layout · bottom nav", () => { set(() => ({ frame: "iphone" })); at("review"); }],
      ["mac", "Mac window", () => { set(() => ({ frame: "mac", macWidth: 1080 })); at("practice"); }],
      ["active", "Active destination: Progress", () => at("progress")],
      ["menu", "Account menu open", () => { at("study"); set(() => ({ menuOpen: true })); }],
      ["player", "Session player (away from owner)", () => { startPlayback({ kind: "episode", label: "Episode: Un samedi au marché", route: "practice/episodes/e1", episodeId: "e1" }, 1080, { position: 760 }); at("study"); }],
      ["sync-pending", "Sync pending", () => { set(() => ({ sync: "pending" })); at("study"); }],
      ["sync-error", "Sync error", () => { set(() => ({ sync: "error" })); at("study"); }],
    ),
  },
  {
    id: "SCR-SYS-02", title: "Demo-state navigator", area: "System",
    states: states(["open", "Navigator open", () => set(() => ({ demoOpen: true }))]),
  },
  {
    id: "SCR-AUTH-01", title: "Sign in (demo)", area: "Account",
    states: states(
      ["signed-out", "Signed out at Review", () => { stopPlayback(); set(() => ({ auth: "out" })); at("review"); }],
      ["pending", "Demo sign-in pending", () => { set(() => ({ auth: "out" })); at("review", "SCR-AUTH-01", "pending"); }],
      ["error", "Demo sign-in error", () => { set(() => ({ auth: "out" })); at("review", "SCR-AUTH-01", "error"); }],
      ["signed-in", "Signed in, back at Review", () => { set(() => ({ auth: "in", signIn: "idle" })); at("review"); }],
    ),
  },
  {
    id: "SCR-AUTH-02", title: "Sign out", area: "Account",
    states: states(
      ["confirm", "Sign-out confirmation", () => { set(() => ({ auth: "in" })); at("settings/account?signout"); }],
      ["signed-out", "Signed out (data kept)", () => { stopPlayback(); set(() => ({ auth: "out" })); at("settings"); }],
    ),
  },
  {
    id: "SCR-STU-01", title: "Study input", area: "Study",
    states: states(
      ["empty", "Empty", () => { input("text", ""); at("study/new"); }],
      ["typed", "Typed", () => { input("text", "Bonjour, je m’appelle Léa et j’habite à Québec."); at("study/new"); }],
      ["example", "Example filled", () => { input("text", EXAMPLE_TEXT); at("study/new"); }],
      ["invalid", "Invalid (no letters)", () => { input("text", "1234 — !!!"); runAnalysis(); at("study/new"); }],
      ["over", "Over the limit", () => { input("text", (SAMPLE_TEXT + " ").repeat(40)); at("study/new"); }],
      ["ideas", "Own-ideas mode, both drafts kept", () => { patchStudy({ drafts: { text: EXAMPLE_TEXT, ideas: "I want to say I almost forgot my appointment." }, mode: "ideas" }); at("study/new"); }],
      ["restored", "Restored draft", () => { input("text", SAMPLE_TEXT, { restored: true }); at("study/new"); }],
      ["clear", "Clear confirmation", () => { input("text", SAMPLE_TEXT); at("study/new", "SCR-STU-01", "clear"); }],
    ),
  },
  {
    id: "SCR-OCR-01", title: "Photo import", area: "Study",
    states: states(
      ["select", "Select sample photo", () => { ocr("note", "select"); at("study/photo"); }],
      ["processing", "Processing (cancel available)", () => { ocr("note", "processing"); at("study/photo"); }],
      ["cancelled", "Cancelled", () => { ocr("note", "cancelled"); at("study/photo"); }],
      ["failed", "Failure with retry", () => { ocr("note", "failed"); at("study/photo"); }],
      ["none", "No readable text", () => { ocr("blur", "none"); at("study/photo"); }],
    ),
  },
  {
    id: "SCR-OCR-02", title: "OCR results", area: "Study",
    states: states(
      ["results", "Editable items · low confidence", () => { ocr("note", "results"); at("study/photo"); }],
      ["partial", "Partial success", () => { ocr("board", "results"); at("study/photo"); }],
      ["over", "Over limit", () => { ocr("textbook", "results"); at("study/photo"); }],
    ),
  },
  {
    id: "SCR-ANA-01", title: "Analysis", area: "Study",
    states: states(
      ["loading", "Loading with stages", () => { online(); input("text", EXAMPLE_TEXT); at("study/new"); runAnalysis(); }],
      ["long", "Long wait", () => { online(); input("text", EXAMPLE_TEXT); at("study/new"); armSlow("analysis"); runAnalysis(); }],
      ["cancelled", "Cancelled", () => { input("text", EXAMPLE_TEXT); patchStudy({ analysis: { ...get().study.analysis, status: "cancelled" } }); at("study/new"); }],
      ["failed", "Failed, input kept", () => { input("text", EXAMPLE_TEXT); patchStudy({ analysis: { ...get().study.analysis, status: "failed" } }); at("study/new"); }],
      ["nofrench", "No French sentences", () => { input("text", "Yesterday I went to the shop and bought bread."); patchStudy({ analysis: { ...get().study.analysis, status: "nofrench" } }); at("study/new"); }],
      ["success", "Success", () => { withAnalysis(); at("study"); }],
    ),
  },
  {
    id: "SCR-STU-02", title: "Current sentence", area: "Study",
    states: states(
      ["single", "Single sentence", () => { withAnalysis(false); at("study"); }],
      ["multi", "Sentence 2 of 3", () => { withAnalysis(); patchStudy({ index: 1 }); at("study"); }],
      ["source", "Source open for editing", () => { withAnalysis(); at("study", "SCR-STU-02", "source"); }],
      ["restored", "Restored position (sentence 3, step 2)", () => { withAnalysis(); patchStudy({ index: 2, step: 1 }); at("study"); }],
      ["word", "Selected word", () => { withAnalysis(); at("study", "SCR-STU-02", "selected-word"); }],
    ),
  },
  {
    id: "SCR-STU-03", title: "Steps", area: "Study",
    states: states(
      ["s1", "Step 1 of 3", () => { withAnalysis(); patchStudy({ step: 0, tab: "steps" }); at("study"); }],
      ["s2", "Step 2 of 3", () => { withAnalysis(); patchStudy({ step: 1, tab: "steps" }); at("study"); }],
      ["s3", "Step 3 of 3", () => { withAnalysis(); patchStudy({ step: 2, tab: "steps" }); at("study"); }],
    ),
  },
  {
    id: "SCR-GRA-01", title: "Grammar panel", area: "Study",
    states: states(
      ["loading", "Loading", () => { withAnalysis(); patchStudy({ tab: "grammar" }); at("study", "SCR-GRA-01", "loading"); }],
      ["content", "Content", () => { withAnalysis(); patchStudy({ tab: "grammar" }); at("study", "SCR-GRA-01", "content"); }],
      ["none", "No explanation", () => { withAnalysis(); patchStudy({ tab: "grammar", index: 2 }); at("study", "SCR-GRA-01", "none"); }],
      ["error", "Failure with retry", () => { withAnalysis(); patchStudy({ tab: "grammar" }); at("study", "SCR-GRA-01", "error"); }],
    ),
  },
  {
    id: "SCR-AUD-01", title: "Scoped player", area: "Study",
    states: states(
      ["loading", "Loading", () => player("loading")],
      ["playing", "Playing", () => player("playing")],
      ["paused", "Paused", () => player("paused", { position: 2 })],
      ["ended", "Ended", () => player("ended", { position: 4.5 })],
      ["buffering", "Buffering", () => player("buffering", { position: 1.5 })],
      ["error", "Failure with retry", () => player("error")],
      ["repeat", "Repeat on · 1.5×", () => player("playing", { repeat: true, speed: 1.5 })],
    ),
  },
  {
    id: "SCR-SAV-01", title: "Add to review", area: "Study",
    states: states(
      ["choose", "Not added · choose cards", () => { withAnalysis(); at("study", "SCR-SAV-01", "choose"); }],
      ["saving", "Saving", () => { withAnalysis(); at("study", "SCR-SAV-01", "saving"); }],
      ["added", "Added with card count", () => { withAnalysis(); at("study", "SCR-SAV-01", "added"); }],
      ["duplicate", "Already saved", () => { withAnalysis(); patchStudy({ index: 2 }); at("study", "SCR-SAV-01", "choose"); }],
      ["failed", "Failed with retry", () => { withAnalysis(); at("study", "SCR-SAV-01", "failed"); }],
    ),
  },
  {
    id: "SCR-WRD-01", title: "Word popup states", area: "Study",
    states: states(
      ["loading", "Dictionary loading", () => word("failli", "loading")],
      ["success", "Dictionary success", () => word("failli", "success")],
      ["context", "General ≠ contextual (il y a)", () => word("Il y a", "success")],
      ["nomatch", "No match", () => word("m’a appelé", "nomatch", true, 1)],
      ["error", "Request failed", () => word("mon", "error")],
      ["ai-loading", "AI fallback loading", () => word("m’a appelé", "ai-loading", true, 1)],
      ["ai-success", "AI fallback success", () => word("m’a appelé", "ai-success", true, 1)],
      ["ai-error", "AI fallback failed", () => word("m’a appelé", "ai-error", true, 1)],
      ["snapshot", "Failure keeps saved snapshot", () => word("failli", "error")],
    ),
  },
  {
    id: "SCR-WRD-02", title: "Meaning, Favorite, importance", area: "Study",
    states: states(
      ["c0", "0 lookups", () => setCount(0)],
      ["c4", "4 lookups", () => setCount(4)],
      ["c5", "5 lookups", () => setCount(5)],
      ["c6", "6 lookups", () => setCount(6)],
      ["c9", "9 lookups", () => setCount(9)],
      ["c10", "10 lookups", () => setCount(10)],
      ["fav", "Favorited (importance unchanged)", () => { set((s) => ({ favorites: { ...s.favorites, [lookupKey("failli")]: true } })); setCount(4); }],
    ),
  },
  {
    id: "SCR-WRD-03", title: "Offline dictionary", area: "Study",
    states: states(
      ["cached", "Offline · cached definition", () => { setOffline(true); withAnalysis(); at("study", "word", "failli"); }],
      ["uncached", "Offline · not cached", () => { setOffline(true); set((s) => { const sn = { ...s.snapshots }; delete sn[lookupKey("deux")]; return { snapshots: sn }; }); withAnalysis(); at("study", "word", "deux"); }],
      ["reconnect", "Back online · retry", () => { online(); withAnalysis(); at("study", "word", "deux"); }],
    ),
  },
  {
    id: "SCR-PRL-01", title: "Recall / Dictation launcher", area: "Study",
    states: states(
      ["recall", "Recall launcher", () => at("study/recall")],
      ["dictation", "Dictation launcher", () => at("study/dictation")],
      ["empty", "Empty source", () => at("study/recall", "SCR-PRL-01", "empty")],
      ["loading", "Loading", () => at("study/recall", "SCR-PRL-01", "loading")],
      ["error", "Error with retry", () => at("study/recall", "SCR-PRL-01", "error")],
    ),
  },
  {
    id: "SCR-REC-01", title: "Recall exercise", area: "Study",
    states: states(
      ["empty", "Not started · empty", () => demoExercise("Recall")],
      ["typing", "Typing", () => demoExercise("Recall", (k) => draft(k, "J’ai oub"))],
      ["empty-check", "Empty Check (no attempt)", () => demoExercise("Recall", (k) => ui(k, { emptyError: true }))],
      ["submitting", "Submitting", () => demoExercise("Recall", (k) => { draft(k, "J’ai oublié mon billet."); armSlow("grading"); submitAnswer(k); })],
      ["techfail", "Technical failure · retry", () => demoExercise("Recall", (k) => { draft(k, T1); armFailure("grading"); submitAnswer(k); })],
      ["hint", "Hint shown", () => demoExercise("Recall", (k) => ui(k, { hint: true }))],
      ["reveal", "Answer revealed", () => demoExercise("Recall", (k) => ui(k, { revealed: true }))],
      ["drafts", "Step mode · drafts kept", () => demoExercise("Recall", (k) => { draft(k, "J’ai oublié"); set((s) => ({ exercises: { ...s.exercises, [k]: { ...s.exercises[k], mode: "step", modeNotice: "Now practising step by step. Your whole-sentence answer and progress are kept." } } })); })],
      ["study", "Inside Study (current sentence)", () => { withAnalysis(); patchStudy({ tab: "recall" }); at("study"); }],
    ),
  },
  {
    id: "SCR-DIC-01", title: "Dictation exercise", area: "Study",
    states: states(
      ["empty", "Not started", () => demoExercise("Dictation")],
      ["hint", "English hint", () => demoExercise("Dictation", (k) => ui(k, { hint: true }))],
      ["audio-error", "Audio failure · retry", () => demoExercise("Dictation", () => { armFailure("audio"); startPlayback({ kind: "exercise", label: "Practice audio", route: "study/run" }, 4.5); })],
      ["slow", "Slow playback", () => demoExercise("Dictation", () => startPlayback({ kind: "exercise", label: "Practice audio", route: "study/run" }, 6, { speed: 0.75 }))],
      ["techfail", "Technical failure · retry", () => demoExercise("Dictation", (k) => { draft(k, T1); armFailure("grading"); submitAnswer(k); })],
      ["step", "Step by step", () => demoExercise("Dictation", (k) => set((s) => ({ exercises: { ...s.exercises, [k]: { ...s.exercises[k], mode: "step" } } })))],
    ),
  },
  {
    id: "SCR-ANS-01", title: "Correct result", area: "Study",
    states: states(
      ["correct", "Correct · Next", () => answered("Recall", T1)],
      ["final", "Last question · Done", () => answered("Dictation", QUEUE_PRACTICE[2].fr, undefined, 2)],
    ),
  },
  {
    id: "SCR-ANS-02", title: "Incorrect result", area: "Study",
    states: states(
      ["word", "Different word", () => answered("Dictation", "J’ai oublié mon billet.")],
      ["missing", "Missing word", () => answered("Dictation", "J’ai oublié rendez-vous.")],
      ["accent", "Accent error", () => answered("Dictation", "J’ai oublie mon rendez-vous.")],
    ),
  },
  {
    id: "SCR-ANS-03", title: "Hinted / answer known · history", area: "Study",
    states: states(
      ["hinted", "Hint used outcome", () => answered("Recall", T1, (k) => ui(k, { hint: true }))],
      ["known", "Answer-known outcome", () => answered("Recall", T1, (k) => ui(k, { revealed: true }))],
      ["saving", "History saving", () => answered("Recall", T1, () => armSlow("history"))],
      ["save-failed", "History save failed · retry", () => answered("Recall", T1, () => armFailure("history"))],
    ),
  },
  {
    id: "SCR-REV-01", title: "Due today", area: "Review",
    states: states(
      ["gate", "Sign-in gate", () => { set(() => ({ auth: "out" })); at("review"); }],
      ["loading", "Queue loading", () => { set(() => ({ auth: "in" })); at("review", "SCR-REV-01", "loading"); }],
      ["nocards", "No saved cards", () => at("review", "SCR-REV-01", "nocards")],
      ["nodue", "No due cards", () => at("review", "SCR-REV-01", "nodue")],
      ["active", "Active queue", () => { online(); set((s) => ({ review: { ...s.review, phase: "summary" } })); at("review"); }],
      ["complete", "Today complete", () => at("review", "SCR-REV-01", "complete")],
      ["error", "Error with retry", () => at("review", "SCR-REV-01", "error")],
      ["offline", "Offline · assigned cards", () => { setOffline(true); at("review"); }],
    ),
  },
  {
    id: "SCR-REV-02", title: "Review answering", area: "Review",
    states: states(
      ["answer", "Answering", () => review({}, () => ({}))],
      ["revealed", "Answer shown", () => review({}, () => ({ revealed: true }))],
      ["correct", "Correct result", () => review({}, (t) => ({ draft: t, phase: "graded", result: grade(t, t) }))],
      ["incorrect", "Incorrect result", () => review({}, (t) => ({ draft: "le", phase: "graded", result: grade(t, "le") }))],
      ["techfail", "Grading failure", () => review({}, (t) => ({ draft: t, phase: "techfail" }))],
      ["complete", "Session complete", () => { review(); at("review/session", "SCR-REV-02", "complete"); }],
    ),
  },
  {
    id: "SCR-LIB-01", title: "Word library", area: "Review",
    states: states(
      ["default", "Sentence/card hierarchy", () => { set((s) => ({ libFilters: { ...s.libFilters, q: "", savedOnly: false, mastered: "hide", minImportance: 0, favoritesOnly: false } })); at("review/library"); }],
      ["search", "Search", () => { set((s) => ({ libFilters: { ...s.libFilters, q: "musée" } })); at("review/library"); }],
      ["nomatch", "No matches", () => { set((s) => ({ libFilters: { ...s.libFilters, q: "zzzz" } })); at("review/library"); }],
      ["combined", "Saved + mastered + importance 4+", () => { set(() => ({ libFilters: { q: "", savedOnly: true, mastered: "show", minImportance: 4, favoritesOnly: false } })); at("review/library"); }],
      ["favorites", "Favorites only", () => { set((s) => ({ libFilters: { ...s.libFilters, q: "", favoritesOnly: true } })); at("review/library"); }],
      ["loading", "Loading", () => at("review/library", "SCR-LIB-01", "loading")],
    ),
  },
  {
    id: "SCR-LIB-02", title: "Bulk practice", area: "Review",
    states: states(["bulk", "200 selected cards", () => { set((s) => ({ libFilters: { ...s.libFilters, q: "", savedOnly: false, mastered: "hide", minImportance: 0, favoritesOnly: false } })); at("review/library", "SCR-LIB-02", "bulk"); }]),
  },
  {
    id: "SCR-MAS-01", title: "Mark mastered + Undo", area: "Review",
    states: states(
      ["live", "Live 6-second Undo", () => mastery()],
      ["applied", "Undo applied", () => mastery("undone")],
      ["expired", "Undo expired", () => mastery("expired")],
      ["queued", "Offline queued Undo", () => mastery("queued")],
      ["syncing", "Delayed sync", () => mastery("syncing")],
      ["conflict", "Conflict", () => mastery("conflict")],
    ),
  },
  {
    id: "SCR-MAS-02", title: "Mastered list", area: "Review",
    states: states(
      ["list", "Mastered list", () => at("review/mastered")],
      ["empty", "Empty", () => at("review/mastered", "SCR-MAS-02", "empty")],
      ["restore-error", "Restore fails next", () => { armFailure("restore"); at("review/mastered"); }],
    ),
  },
  {
    id: "SCR-QUO-01", title: "Daily new cards", area: "Review",
    states: states(
      ["zero", "Limit 0", () => { set(() => ({ dailyNew: 0, newUsed: 0 })); at("settings"); }],
      ["max", "Limit 200", () => { set(() => ({ dailyNew: 200, newUsed: 0 })); at("settings"); }],
      ["invalid", "Invalid value", () => at("settings", "SCR-QUO-01", "invalid")],
      ["saving", "Saving", () => at("settings", "SCR-QUO-01", "saving")],
      ["saved", "Saved", () => at("settings", "SCR-QUO-01", "saved")],
      ["failed", "Save failed", () => at("settings", "SCR-QUO-01", "failed")],
      ["two-of-five", "2 of 5 allocation", () => { online(); set(() => ({ dailyNew: 40, newUsed: 38 })); at("review"); }],
      ["below-used", "Cap below used", () => { online(); set(() => ({ dailyNew: 20, newUsed: 31 })); at("review"); }],
      ["offline", "Offline · no new allocation", () => { setOffline(true); set(() => ({ dailyNew: 40, newUsed: 0 })); at("review"); }],
    ),
  },
  {
    id: "SCR-EPI-01", title: "Episodes list", area: "Practice",
    states: states(
      ["list", "List · capability not verified", () => { online(); at("practice/episodes"); }],
      ["loading", "Loading", () => at("practice/episodes", "SCR-EPI-01", "loading")],
      ["empty", "Empty", () => at("practice/episodes", "SCR-EPI-01", "empty")],
      ["error", "Error with retry", () => at("practice/episodes", "SCR-EPI-01", "error")],
      ["cached", "Offline · cached metadata", () => { setOffline(true); at("practice/episodes"); }],
    ),
  },
  {
    id: "SCR-EPI-02", title: "Episode player", area: "Practice",
    states: states(
      ["continue", "Continue position", () => { online(); stopPlayback(); at("practice/episodes/e1"); }],
      ["restore-failed", "Restore failure", () => { stopPlayback(); at("practice/episodes/e1", "SCR-EPI-02", "restore-failed"); }],
      ["playing", "Playing at 2×", () => { startPlayback({ kind: "episode", label: "Episode: Un samedi au marché", route: "practice/episodes/e1", episodeId: "e1" }, 1080, { position: 760, speed: 2 }); at("practice/episodes/e1"); }],
      ["sync-failed", "Sync failure", () => at("practice/episodes/e1", "SCR-EPI-02", "sync-failed")],
      ["unavailable", "Unavailable episode", () => at("practice/episodes/e3")],
    ),
  },
  {
    id: "SCR-PRO-01", title: "Audio progress", area: "Progress",
    states: states(
      ["active", "Active pace", () => { set(() => ({ sync: "synced" })); at("progress"); }],
      ["nodata", "No lifetime data", () => at("progress", "SCR-PRO-01", "nodata")],
      ["nopace", "No pace in 28 days", () => at("progress", "SCR-PRO-01", "nopace")],
      ["reached", "1,000 hours reached", () => at("progress", "SCR-PRO-01", "reached")],
      ["unavailable", "Unavailable", () => at("progress", "SCR-PRO-01", "unavailable")],
      ["pending", "Sync delayed", () => at("progress", "SCR-PRO-01", "pending")],
      ["syncfail", "Sync failure", () => at("progress", "SCR-PRO-01", "syncfail")],
    ),
  },
  {
    id: "SCR-PRO-02", title: "Device support", area: "Progress",
    states: states(["matrix", "Support matrix", () => at("progress/devices")]),
  },
  {
    id: "SCR-HIS-01", title: "History list", area: "Progress",
    states: states(
      ["attempts", "Attempts with scope", () => at("progress/history?tab=attempts")],
      ["analyses", "Study analyses", () => at("progress/history?tab=analyses")],
      ["audio", "Audio activity", () => at("progress/history?tab=audio")],
      ["loading", "Loading", () => at("progress/history?tab=attempts", "SCR-HIS-01", "loading")],
      ["empty", "No records", () => at("progress/history?tab=attempts", "SCR-HIS-01", "empty")],
      ["nomatch", "No filter matches", () => at("progress/history?tab=attempts", "SCR-HIS-01", "nomatch")],
      ["error", "Error with retry", () => at("progress/history?tab=attempts", "SCR-HIS-01", "error")],
      ["offline", "Offline cached records", () => { setOffline(true); at("progress/history?tab=attempts"); }],
    ),
  },
  {
    id: "SCR-HIS-02", title: "History detail", area: "Progress",
    states: states(
      ["attempt", "Attempt detail", () => at("progress/history?tab=attempts", "SCR-HIS-02", "h2")],
      ["analysis", "Analysis detail", () => at("progress/history?tab=analyses", "SCR-HIS-02", "a1")],
      ["audio", "Audio detail (2×)", () => at("progress/history?tab=audio", "SCR-HIS-02", "u1")],
      ["save-retry", "Save failure · retry", () => { set((s) => ({ history: { ...s.history, attempts: s.history.attempts.map((a) => (a.id === "h3" ? { ...a, saved: "failed" } : a)) } })); at("progress/history?tab=attempts", "SCR-HIS-02", "h3"); }],
    ),
  },
  {
    id: "SCR-HIS-03", title: "Clear history", area: "Progress",
    states: states(
      ["analyses", "Clear analysis list", () => at("progress/history?tab=analyses", "SCR-HIS-03", "analyses:confirm")],
      ["attempts", "Clear attempt history", () => at("progress/history?tab=attempts", "SCR-HIS-03", "attempts:confirm")],
      ["clearing", "Clearing", () => at("progress/history?tab=attempts", "SCR-HIS-03", "attempts:clearing")],
      ["failed", "Clearing failed · retry", () => at("progress/history?tab=attempts", "SCR-HIS-03", "attempts:failed")],
    ),
  },
  { id: "SCR-PRA-01", title: "Practice hub", area: "Practice", states: states(["hub", "Hub", () => at("practice")]) },
  {
    id: "SCR-PRA-02", title: "Writing practice", area: "Practice",
    states: states(
      ["draft", "Draft", () => at("practice/write")],
      ["empty", "Empty validation", () => at("practice/write", "SCR-PRA-02", "empty")],
      ["submitting", "Submitting", () => at("practice/write", "SCR-PRA-02", "submitting")],
      ["feedback", "Feedback", () => at("practice/write", "SCR-PRA-02", "feedback")],
      ["failed", "Failure · retry", () => at("practice/write", "SCR-PRA-02", "failed")],
      ["done", "Complete", () => at("practice/write", "SCR-PRA-02", "done")],
    ),
  },
  {
    id: "SCR-PRA-03", title: "Speaking practice", area: "Practice",
    states: states(
      ["idle", "Ready", () => at("practice/speak")],
      ["recording", "Simulated recording", () => at("practice/speak", "SCR-PRA-03", "recording")],
      ["recorded", "Recorded · playback", () => at("practice/speak", "SCR-PRA-03", "recorded")],
      ["failed", "Recording failure", () => at("practice/speak", "SCR-PRA-03", "failed")],
      ["feedback", "Unofficial feedback", () => at("practice/speak", "SCR-PRA-03", "feedback")],
      ["done", "Complete", () => at("practice/speak", "SCR-PRA-03", "done")],
    ),
  },
  {
    id: "SCR-PRA-04", title: "Listening practice", area: "Practice",
    states: states(
      ["start", "Clip and questions", () => at("practice/listen")],
      ["audio-error", "Audio failure", () => { armFailure("audio"); startPlayback({ kind: "practice", label: "Listening clip", route: "practice/listen" }, 14); at("practice/listen"); }],
      ["checked", "Answers with explanations", () => at("practice/listen", "SCR-PRA-04", "checked")],
      ["done", "Complete", () => at("practice/listen", "SCR-PRA-04", "done")],
    ),
  },
  {
    id: "SCR-PRA-05", title: "Audio Studio", area: "Practice",
    states: states(
      ["choose", "Choose text", () => at("practice/studio")],
      ["preparing", "Preparing", () => at("practice/studio", "SCR-PRA-05", "preparing")],
      ["error", "Preparation error", () => at("practice/studio", "SCR-PRA-05", "error")],
      ["ready", "Ready · player", () => at("practice/studio", "SCR-PRA-05", "ready")],
    ),
  },
  {
    id: "SCR-EXM-01", title: "Exam collection", area: "Practice",
    states: states(
      ["gate", "Not ready · checklist", () => at("practice/exams")],
      ["loading", "Loading", () => at("practice/exams", "SCR-EXM-01", "loading")],
      ["empty", "Empty", () => at("practice/exams", "SCR-EXM-01", "empty")],
      ["error", "Error", () => at("practice/exams", "SCR-EXM-01", "error")],
    ),
  },
  { id: "SCR-EXM-02", title: "Mode and preflight", area: "Practice", states: states(["modes", "Mode selection", () => at("practice/exams/modes")]) },
  {
    id: "SCR-EXM-03", title: "Listening section", area: "Practice",
    states: states(
      ["practice", "Practice (untimed)", () => exam("practice", "listening")],
      ["timed", "Timed section", () => exam("section", "listening")],
      ["unfilled", "Unfilled slot", () => exam("section", "listening", { qIndex: 10 })],
      ["audio-error", "Audio failure", () => { exam("section", "listening"); armFailure("audio"); startPlayback({ kind: "practice", label: "Exam sample audio", route: "practice/exams/run" }, 12); }],
    ),
  },
  {
    id: "SCR-EXM-04", title: "Reading section", area: "Practice",
    states: states(
      ["practice", "Practice", () => exam("practice", "reading")],
      ["timed", "Timed · answers kept", () => exam("section", "reading", { answers: { "x-r1": 1 }, qIndex: 1 })],
    ),
  },
  {
    id: "SCR-EXM-05", title: "Writing section", area: "Practice",
    states: states(
      ["practice", "Practice", () => exam("practice", "writing")],
      ["timed", "Timed · draft saved", () => exam("section", "writing", { writing: { w1: "Bonjour Marc, je t’invite à dîner vendredi soir." }, writingSave: { w1: "saved" } })],
      ["save-error", "Draft save error", () => exam("section", "writing", { writing: { w1: "Bonjour Marc…" }, writingSave: { w1: "failed" } })],
    ),
  },
  {
    id: "SCR-EXM-06", title: "Speaking section", area: "Practice",
    states: states(
      ["t1", "Task 1", () => exam("section", "speaking", { speakingStage: 0 })],
      ["prep", "Preparation (inside 12 min)", () => exam("section", "speaking", { speakingStage: 1 })],
      ["t2", "Task 2", () => exam("section", "speaking", { speakingStage: 2 })],
      ["t3", "Task 3", () => exam("section", "speaking", { speakingStage: 3 })],
      ["done", "Complete", () => exam("section", "speaking", { speakingStage: 4 })],
    ),
  },
  {
    id: "SCR-EXM-07", title: "Full-flow transitions", area: "Practice",
    states: states(
      ["start", "Full mock · Listening", () => exam("full", "listening")],
      ["transition", "Section transition", () => exam("full", "listening", { phase: "transition", answers: { "x-l1": 1 } })],
      ["reading", "Reading with answers kept", () => exam("full", "reading", { answers: { "x-l1": 1, "x-l2": 2 } })],
    ),
  },
  {
    id: "SCR-EXM-08", title: "Leave, timeout, submit", area: "Practice",
    states: states(
      ["resumed", "Resumed after leaving", () => { exam("section", "reading", { answers: { "x-r1": 1 } }); set((s) => ({ ss: { ...s.ss, "SCR-EXM-08": "resumed" } })); }],
      ["near", "30 seconds left", () => exam("section", "listening", { startedAt: Date.now() - (35 * 60 - 30) * 1000 })],
      ["timeout", "Timeout → submit", () => exam("section", "listening", { startedAt: Date.now() - 35 * 60 * 1000 + 2000, answers: { "x-l1": 1 } })],
      ["submitfail", "Submit failure · retry", () => { exam("section", "listening", { answers: { "x-l1": 1 } }); set((s) => ({ ss: { ...s.ss, "SCR-EXM-08": "submitfail" } })); }],
    ),
  },
  {
    id: "SCR-EXM-09", title: "Results", area: "Practice",
    states: states(
      ["mock", "Timed mock results", () => {
        set((s) => ({ exam: { ...s.exam, phase: "results", mockResults: [...s.exam.mockResults, { id: `r${Date.now()}`, mode: "full", timedOut: false, sections: [
          { key: "listening", name: "Listening", correct: 2, answered: 3, sample: 3, unfilled: 36, missed: ["x-l3"] },
          { key: "reading", name: "Reading", correct: 3, answered: 3, sample: 3, unfilled: 36, missed: [] },
          { key: "writing", name: "Writing", missed: ["w3"], qualitative: "Clear purpose in each task you completed. Next: vary sentence openings." },
          { key: "speaking", name: "Speaking", missed: [], qualitative: "On topic throughout. Next: one concrete example per point." },
        ] }] } }));
        at("practice/exams/results");
      }],
      ["practice", "Practice record", () => {
        set((s) => ({ exam: { ...s.exam, phase: "results", practiceResults: [...s.exam.practiceResults, { id: `r${Date.now()}`, mode: "practice", timedOut: false, sections: [{ key: "reading", name: "Reading", correct: 1, answered: 2, sample: 3, unfilled: 36, missed: ["x-r2", "x-r3"] }] }] } }));
        at("practice/exams/results");
      }],
    ),
  },
  {
    id: "SCR-SET-01", title: "Learning preferences", area: "Settings",
    states: states(
      ["default", "Defaults", () => at("settings")],
      ["saving", "Saving", () => at("settings", "SCR-SET-01", "saving")],
      ["saved", "Saved", () => at("settings", "SCR-SET-01", "saved")],
      ["failed", "Error", () => at("settings", "SCR-SET-01", "failed")],
      ["offline", "Offline pending", () => at("settings", "SCR-SET-01", "offline")],
      ["conflict", "Conflicting setting", () => at("settings", "SCR-SET-01", "conflict")],
    ),
  },
  {
    id: "SCR-SET-02", title: "Account and sync", area: "Settings",
    states: states(
      ["synced", "Synced · friend access", () => at("settings/account", "SCR-SET-02", "synced")],
      ["pending", "Pending", () => at("settings/account", "SCR-SET-02", "pending")],
      ["error", "Error · retry", () => at("settings/account", "SCR-SET-02", "error")],
      ["conflict", "Conflict", () => at("settings/account", "SCR-SET-02", "conflict")],
    ),
  },
  {
    id: "SCR-LEG-01", title: "Moved page", area: "System",
    states: states(["moved", "Legacy link landing", () => { history.pushState(null, "", "#/app"); set(() => ({ route: "moved", ss: {} })); }]),
  },
  { id: "SCR-DSN-01", title: "Design reference", area: "System", states: states(["ref", "Tokens and coverage", () => at("design")]) },
];
