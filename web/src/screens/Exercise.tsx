import { useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Eye, Play, Turtle, RotateCcw, History as HistoryIcon, Loader2 } from "lucide-react";
import type { PracticeItem, StudySentence } from "../data/fixtures";
import { grade, type DisplayWord } from "../lib/grading";
import { gradeFeedback } from "../lib/feedback";
import { plural } from "../lib/format";
import {
  announce,
  get,
  go,
  retryPlayback,
  set,
  startPlayback,
  useApp,
  type Attempt,
  type ExerciseSession,
  type QuestionUI,
} from "../state/store";
import { gradeAttempt } from "../api/dictation";
import { FrText, type FrPick, type FrSegment } from "../components/FrText";
import { Spinner, Textarea, useNarrow } from "../components/ui";
import { WordOverlay, WordPanel } from "./WordPopup";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "cn";

/* ---------------- session helpers ---------------- */

export function ensureSession(key: string, kind: "Recall" | "Dictation", source: string, items: PracticeItem[]) {
  if (get().exercises[key]) return;
  const session: ExerciseSession = { key, kind, source, items, index: 0, mode: "whole", steps: {}, drafts: {}, ui: {}, done: false, audio: "idle" };
  set((s) => ({ exercises: { ...s.exercises, [key]: session } }));
}

function patchSession(key: string, p: Partial<ExerciseSession>) {
  if (!get().exercises[key]) return; // session removed (e.g. Reset demo)
  set((s) => ({ exercises: { ...s.exercises, [key]: { ...s.exercises[key], ...p } } }));
}
function patchUI(key: string, qk: string, p: Partial<QuestionUI>) {
  if (!get().exercises[key]) return; // session removed (e.g. Reset demo)
  set((s) => {
    const sess = s.exercises[key];
    const prev = sess.ui[qk] ?? { phase: "answering", hint: false, revealed: false };
    return { exercises: { ...s.exercises, [key]: { ...sess, ui: { ...sess.ui, [qk]: { ...prev, ...p } } } } };
  });
}
function patchAttempt(id: string, p: Partial<Attempt>) {
  set((s) => ({ attempts: s.attempts.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
}

export function questionKey(sess: ExerciseSession) {
  const step = sess.steps[sess.index] ?? 0;
  return `${sess.index}:${sess.mode}:${sess.mode === "step" ? step : "w"}`;
}

export function currentTarget(sess: ExerciseSession) {
  const item = sess.items[sess.index];
  const step = sess.steps[sess.index] ?? 0;
  return sess.mode === "step" ? item.steps[step] : { fr: item.fr, en: item.en };
}

function hintFor(kind: "Recall" | "Dictation", t: { fr: string; en: string }) {
  if (kind === "Dictation") return `English hint: ${t.en}`;
  return (
    "First letters: " +
    t.fr
      .split(/\s+/)
      .map((w) => {
        const m = w.match(/^([^\p{L}]*)(\p{L}+[’']?)?/u);
        const lead = m?.[2] ?? "";
        return lead.endsWith("’") || lead.endsWith("'") ? lead : (lead[0] ?? "") + "…";
      })
      .join(" ")
  );
}

let attemptSeq = 0;

/** Server step: 0 is the whole sentence, 1..N the build-up steps. */
function serverStep(sess: ExerciseSession) {
  return sess.mode === "step" ? (sess.steps[sess.index] ?? 0) + 1 : 0;
}

/**
 * The server saves an attempt while grading it. When that save failed, Retry saving sends the same
 * answer again: the failed attempt was never stored, so nothing is duplicated.
 */
export function saveHistory(attemptId: string, manualRetry = false): Promise<boolean> {
  const a = get().attempts.find((x) => x.id === attemptId);
  if (!a?.grading) return Promise.resolve(false);
  if (manualRetry) patchAttempt(attemptId, { cleared: false });
  patchAttempt(attemptId, { history: "saving" });
  return gradeAttempt(a.grading.src, a.kind, a.grading.step, a.response)
    .then((r) => {
      patchAttempt(attemptId, { history: r.saved ? "saved" : "failed" });
      announce(r.saved ? "Saved to practice history." : "Couldn’t save to practice history. Your result is kept.", !r.saved);
      return r.saved;
    })
    .catch(() => {
      patchAttempt(attemptId, { history: "failed" });
      announce("Couldn’t save to practice history. Your result is kept.", true);
      return false;
    });
}

/** Records (or reuses, after a technical failure) the pending attempt for the current question. */
function beginAttempt(key: string) {
  const sess = get().exercises[key];
  if (!sess) return null;
  const qk = questionKey(sess);
  const ui = sess.ui[qk] ?? { phase: "answering", hint: false, revealed: false };
  if (ui.phase === "submitting" || ui.phase === "graded") return null; // duplicate submission prevented
  const draft = sess.drafts[qk] ?? "";
  if (!draft.trim()) {
    patchUI(key, qk, { emptyError: true });
    announce("Type an answer before checking. No attempt was recorded.", true);
    return null;
  }
  const target = currentTarget(sess);
  const item = sess.items[sess.index];
  const grading = { src: { fr: item.fr, en: item.en, steps: item.steps }, step: serverStep(sess) };
  let attemptId = ui.phase === "techfail" ? ui.attemptId : undefined;
  if (!attemptId) {
    attemptId = `att-${Date.now()}-${++attemptSeq}`;
    const a: Attempt = {
      id: attemptId,
      sessionKey: key,
      kind: sess.kind,
      itemId: item.id,
      sentence: target.fr,
      scope: sess.mode === "step" ? "Step by step" : "Whole sentence",
      step: sess.mode === "step" ? (sess.steps[sess.index] ?? 0) + 1 : undefined,
      response: draft,
      hinted: ui.hint, // flags are frozen at submission (and updated if used before a techfail retry)
      answerKnown: ui.revealed,
      status: "pending",
      history: "saving",
      grading,
    };
    set((s) => ({ attempts: [...s.attempts, a] }));
  } else {
    // Same-attempt retry after a technical failure: update the pending attempt if Show hint or Show answer was used.
    const prev = get().attempts.find((x) => x.id === attemptId);
    patchAttempt(attemptId, {
      response: draft,
      hinted: Boolean(prev?.hinted || ui.hint),
      answerKnown: Boolean(prev?.answerKnown || ui.revealed),
    });
  }
  return { qk, draft, target, grading, attemptId, kind: sess.kind };
}

/**
 * Design reference only: shows a question as if checking were in progress, had failed, or had been
 * graded (locally) with the given history state, without asking the server.
 */
export function forceExerciseState(key: string, state: "submitting" | "techfail" | "saving" | "save-failed") {
  const b = beginAttempt(key);
  if (!b) return;
  if (state === "submitting" || state === "techfail") return patchUI(key, b.qk, { phase: state, attemptId: b.attemptId, emptyError: false });
  const res = grade(b.target.fr, b.draft);
  patchAttempt(b.attemptId, { status: "completed", outcome: res.correct ? "correct" : "incorrect", result: res, history: state === "saving" ? "saving" : "failed" });
  patchUI(key, b.qk, { phase: "graded", attemptId: b.attemptId });
}

export function submitAnswer(key: string) {
  const b = beginAttempt(key);
  if (!b) return;
  const { qk, draft, target, grading, kind } = b;
  const attemptId = b.attemptId;
  patchUI(key, qk, { phase: "submitting", attemptId, emptyError: false });
  announce("Checking your answer…");
  gradeAttempt(grading.src, kind, grading.step, draft)
    .then((r) => {
      if (!get().attempts.some((x) => x.id === attemptId)) return;
      // The server decides right or wrong; the word marks come from the same rules on this side.
      const res = { ...grade(target.fr, draft), correct: r.correct };
      const curUi = get().exercises[key]?.ui[qk];
      const prev = get().attempts.find((x) => x.id === attemptId);
      patchAttempt(attemptId, {
        status: "completed",
        outcome: r.correct ? "correct" : "incorrect",
        result: res,
        hinted: Boolean(prev?.hinted || curUi?.hint),
        answerKnown: Boolean(prev?.answerKnown || curUi?.revealed),
        history: r.saved ? "saved" : "failed",
      });
      patchUI(key, qk, { phase: "graded" });
      const a = get().attempts.find((x) => x.id === attemptId)!;
      if (!a.answerKnown) gradeFeedback(r.correct);
      announce(a.answerKnown ? "Checked. Recorded as answer known." : r.correct ? "Correct." : `Not quite. ${plural(res.issues.length, "difference")}.`);
      requestAnimationFrame(() => document.getElementById(`ex-result-${key}`)?.focus());
    })
    .catch(() => {
      patchUI(key, qk, { phase: "techfail" });
      announce("Checking didn’t finish. This is not a wrong answer. Your answer is kept.", true);
    });
}

/* ---------------- shared feedback pieces ---------------- */

function cleanCounterpart(w?: string) {
  return (w ?? "").replace(/^[^\p{L}\p{N}]+|[.,;:!?…»«"]+$/gu, "");
}

function inlineTagFor(w: DisplayWord, side: "answer" | "target"): string | null {
  if (w.mark === "ok") return null;
  if (side === "answer") {
    return w.mark === "extra" ? "Extra word" : null;
  }
  if (w.mark === "missing") return "Missing word";
  const given = cleanCounterpart(w.counterpart);
  if (w.mark === "different") return given ? `Different word: you wrote ${given}` : "Different word";
  if (w.mark === "accent") return given ? `Accent: you wrote ${given}` : "Accent";
  return null;
}

function targetSegments(words: DisplayWord[]): FrSegment[] {
  const out: FrSegment[] = [];
  words.forEach((w, i) => {
    const word = /[\p{L}\p{N}]/u.test(w.text);
    out.push({ t: w.text, w: word, tone: w.mark !== "ok" ? w.mark : undefined });
    if (i < words.length - 1) out.push({ t: " " });
  });
  return out;
}

export function MarkedLine({
  words,
  label,
  side = label === "Your answer" ? "answer" : "target",
  onPick,
  onPlay,
}: {
  words: DisplayWord[];
  label: string;
  onPlay?: () => void;
  side?: "answer" | "target";
  /** Correct-answer French uses the same tappable text as the study sentence. */
  onPick?: (p: FrPick) => void;
}) {
  const notes = [...new Set(words.map((w) => inlineTagFor(w, side)).filter((tag): tag is string => Boolean(tag)))];
  const tappable = side === "target" && onPick;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {onPlay ? (
        <Button type="button" variant="link" onClick={onPlay} className="h-auto justify-start self-start whitespace-normal p-0 text-left font-serif text-xl leading-9" lang="fr">
          <span>{words.map((w, i) => <span key={i}>{i > 0 ? " " : ""}{w.mark === "ok" ? w.text : <span className={`rounded px-0.5 tok--${w.mark}`}>{w.text}</span>}</span>)}</span>
        </Button>
      ) : tappable ? (
        <FrText segments={targetSegments(words)} className="font-serif text-xl leading-9" onPick={onPick} />
      ) : (
        <p className="font-serif text-xl leading-9" lang="fr">
          {words.map((w, i) => (
            <span key={i}>
              {w.mark === "ok" ? w.text : <span className={`rounded px-0.5 tok--${w.mark}`}>{w.text}</span>}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      )}
      {notes.length > 0 && <p className="compare-note text-xs leading-4 text-muted-foreground">{notes.join(" · ")}</p>}
    </div>
  );
}

export function AccentBar({ target }: { target: React.RefObject<HTMLTextAreaElement | null> }) {
  const chars = ["é", "è", "ê", "à", "â", "ç", "î", "ô", "û", "ù", "œ", "’"];
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Insert a French character">
      {chars.map((c) => (
        <Button type="button" variant="outline" key={c} aria-label={`Insert ${c === "’" ? "apostrophe" : c}`} onMouseDown={(e) => e.preventDefault()} className="h-8 w-8 px-0" onClick={() => {
            const el = target.current;
            if (!el) return;
            const { selectionStart: a, selectionEnd: b, value } = el;
            const next = value.slice(0, a) + c + value.slice(b);
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
            setter.call(el, next);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(a + c.length, a + c.length);
            });
          }}>{c}</Button>
      ))}
    </div>
  );
}

/* ---------------- Exercise ---------------- */

export function Exercise({
  sessionKey,
  kind,
  source,
  items,
  onDone,
  onPick,
  compact,
  doneLabel = "Done — return to Study",
}: {
  sessionKey: string;
  kind: "Recall" | "Dictation";
  source: string;
  items: PracticeItem[];
  onDone: () => void;
  /** Opens the study word card. When omitted, this exercise opens the same card itself. */
  onPick?: (p: FrPick) => void;
  compact?: boolean;
  doneLabel?: string;
}) {
  useLayoutEffect(() => ensureSession(sessionKey, kind, source, items), [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sess = useApp((s) => s.exercises[sessionKey]);
  const attempts = useApp((s) => s.attempts);
  const player = useApp((s) => s.player);
  const route = useApp((s) => s.route);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [localPick, setLocalPick] = useState<FrPick | null>(null);
  const narrow = useNarrow();
  const handlePick = onPick ?? ((p: FrPick) => setLocalPick(p));
  if (!sess) return null;

  const item = sess.items[sess.index];
  const qk = questionKey(sess);
  const ui: QuestionUI = sess.ui[qk] ?? { phase: "answering", hint: false, revealed: false };
  const draft = sess.drafts[qk] ?? "";
  const t = currentTarget(sess);
  const step = sess.steps[sess.index] ?? 0;
  const stepCount = item.steps.length;
  const attempt = ui.attemptId ? attempts.find((a) => a.id === ui.attemptId) : undefined;
  const isLast = sess.index === sess.items.length - 1 && (sess.mode === "whole" || step === stepCount - 1);
  const busy = ui.phase === "submitting";
  const sessionAttempts = attempts.filter((a) => a.sessionKey === sessionKey && !a.cleared);
  const myAudio = player && player.owner.kind === "exercise" ? player : null;

  const setDraft = (v: string) =>
    set((s) => {
      const cur = s.exercises[sessionKey];
      const prevUI = cur.ui[qk];
      return {
        exercises: {
          ...s.exercises,
          [sessionKey]: { ...cur, drafts: { ...cur.drafts, [qk]: v }, ui: prevUI?.emptyError ? { ...cur.ui, [qk]: { ...prevUI, emptyError: false } } : cur.ui },
        },
      };
    });

  const next = () => {
    if (sess.mode === "step" && step < stepCount - 1) {
      patchSession(sessionKey, { steps: { ...sess.steps, [sess.index]: step + 1 } });
      announce(`Step ${step + 2} of ${stepCount}.`);
    } else {
      patchSession(sessionKey, { index: sess.index + 1, steps: { ...sess.steps, [sess.index + 1]: 0 } });
      announce(`Question ${sess.index + 2} of ${sess.items.length}.`);
    }
    requestAnimationFrame(() => document.getElementById(`ex-q-${sessionKey}`)?.focus());
  };
  const tryAgain = () => {
    // A completed attempt followed by Try again creates a new attempt.
    set((s) => {
      const cur = s.exercises[sessionKey];
      return { exercises: { ...s.exercises, [sessionKey]: { ...cur, drafts: { ...cur.drafts, [qk]: "" }, ui: { ...cur.ui, [qk]: { phase: "answering", hint: false, revealed: false } } } } };
    });
    announce("New attempt. Type your answer.");
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const tryFromMemory = () => {
    // The answer stays "shown" for scoring. Only the French on screen is covered.
    setDraft("");
    patchUI(sessionKey, qk, { coverAnswer: true });
    inputRef.current?.focus();
  };
  const play = (slow: boolean) =>
    startPlayback({ kind: "exercise", label: "Practice audio", route }, Math.max(1, t.fr.length / 13), { speed: slow ? 0.75 : 1, texts: [t.fr] });

  const qLabel = kind;

  return (
    <section className={compact ? "exercise" : "exercise"} aria-labelledby={`ex-q-${sessionKey}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`ex-q-${sessionKey}`} tabIndex={-1} className={compact ? "t-label" : "t-section"}>{qLabel}</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sm text-muted-foreground">
            <span>Question {sess.index + 1} of {sess.items.length}</span>
            {sess.mode === "step" && <span>Step {step + 1} of {stepCount}</span>}
            <span>Source: {sess.source}</span>
            <span>{plural(sess.items.length, "sentence")}</span>
          </p>
        </div>
        <ToggleGroup type="single" variant="outline" value={sess.mode} onValueChange={(next) => { if (next === "step" || next === "whole") {
            if (busy) return;
            patchSession(sessionKey, { mode: next, modeNotice: "" });
            announce(next === "step" ? "Scope changed to step by step." : "Scope changed to whole sentence.");
          } }} aria-label="Practice scope">{([
            { value: "whole", label: "Whole sentence" },
            { value: "step", label: "Step by step" },
          ]).map((o) => (<ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>))}</ToggleGroup>
      </div>

      <hr className="border-t" />

      {/* Prompt — never the French target */}
      <div className="flex flex-col gap-3">
        {kind === "Recall" ? (
          <>
            <p className="text-sm text-muted-foreground">Write this in French.</p>
            <p className="text-lg font-medium">{t.en}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Listen and type what you hear.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" aria-disabled={(!!(myAudio?.status === "loading")) || undefined} aria-busy={myAudio?.status === "loading" || undefined} aria-label="Play practice audio" className={cn((!!(myAudio?.status === "loading")) ? "opacity-50" : "")} onClick={(event) => { if (!!(myAudio?.status === "loading")) { event.preventDefault(); return; } (() => play(false))(); }}>{myAudio?.status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : (<Play aria-hidden />)}Play</Button>
              <Button type="button" variant="outline" aria-label="Play practice audio slowly" onClick={() => play(true)}>{<Turtle aria-hidden />}Slow</Button>
              {myAudio && myAudio.status !== "error" && (
                <span className="text-sm text-muted-foreground" aria-live="off">
                  {myAudio.status === "playing" ? `Playing practice audio at ${myAudio.speed}\u00a0×` : myAudio.status === "loading" ? "Loading…" : myAudio.status === "ended" ? "Played" : "Paused"}
                </span>
              )}
            </div>
            {myAudio?.status === "error" && (
              <Alert variant="destructive" role="alert"><AlertTitle>Practice audio couldn’t play</AlertTitle><AlertDescription>Your answer is kept. You can also use the English hint.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={retryPlayback}>{<RotateCcw aria-hidden />}Retry audio</Button></div></AlertDescription></Alert>
            )}
          </>
        )}
        {ui.hint && ui.phase !== "graded" && (
          <p className="banner banner--info" role="status">
            <Lightbulb aria-hidden />
            <span lang={kind === "Recall" ? "fr" : "en"}>{hintFor(kind, t)}</span>
          </p>
        )}
        {ui.revealed && !ui.coverAnswer && ui.phase !== "graded" && (
          <div className="banner banner--warning" role="status">
            <Eye aria-hidden />
            <div className="banner-body">
              <p className="banner-title">Answer shown</p>
              <FrText text={t.fr} className="font-serif text-2xl leading-snug wrap-break-word" onPick={handlePick} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={tryFromMemory}>Try it now</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Answer or result */}
      {ui.phase !== "graded" ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <label htmlFor={`ex-input-${sessionKey}`} className="text-sm font-medium">Your answer in French</label>
            <Textarea
              id={`ex-input-${sessionKey}`}
              name="practice-answer"
              ref={inputRef}
              className="min-h-24"
              lang="fr"
              rows={3}
              value={draft}
              readOnly={busy || ui.phase === "techfail"}
              aria-invalid={ui.emptyError || undefined}
              aria-describedby={`ex-keys-${sessionKey}${ui.emptyError ? ` ex-err-${sessionKey}` : ""}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitAnswer(sessionKey);
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
            <p id={`ex-keys-${sessionKey}`} className="text-sm text-muted-foreground">Enter checks your answer. Shift + Enter adds a new line.</p>
            {ui.emptyError && (
              <p id={`ex-err-${sessionKey}`} className="text-sm text-destructive" role="alert">Type an answer before checking. No attempt was recorded.</p>
            )}
          </div>
          <AccentBar target={inputRef} />
          {ui.phase === "techfail" && (
            <Alert variant="destructive" role="alert"><AlertTitle>Checking didn’t finish</AlertTitle><AlertDescription>This is a technical problem, not a wrong answer. Your answer is kept and Retry checks the same attempt.</AlertDescription></Alert>
          )}
          {busy && <Spinner label="Checking your answer…" />}
          <div className="sticky bottom-0 z-10 bg-background py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" aria-disabled={(!!(busy)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => submitAnswer(sessionKey))(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}{ui.phase === "techfail" ? "Retry check" : busy ? "Checking…" : "Check"}</Button>
              <Button type="button" variant="ghost" aria-pressed={ui.hint || undefined} onClick={() => {
                  if (ui.hint || busy) return;
                  patchUI(sessionKey, qk, { hint: true });
                  if (ui.attemptId) patchAttempt(ui.attemptId, { hinted: true });
                  announce("Hint shown.");
                }}>{<Lightbulb aria-hidden />}{ui.hint ? "Hint shown" : kind === "Dictation" ? "Show English hint" : "Show hint"}</Button>
              <Button type="button" variant="ghost" aria-pressed={ui.revealed || undefined} onClick={() => {
                  if (ui.revealed || busy) return;
                  patchUI(sessionKey, qk, { revealed: true, coverAnswer: false });
                  if (ui.attemptId) patchAttempt(ui.attemptId, { answerKnown: true });
                  announce("Answer shown.");
                }}>{<Eye aria-hidden />}{ui.revealed ? "Answer shown" : "Show answer"}</Button>
            </div>
          </div>
        </div>
      ) : (
        attempt?.result && (
          <Result
            sessionKey={sessionKey}
            attempt={attempt}
            target={t.fr}
            isLast={isLast}
            onNext={next}
            onTryAgain={tryAgain}
            onPick={handlePick}
            onDone={onDone}
            doneLabel={doneLabel}
            sessionAttempts={sessionAttempts}
            itemsCount={sess.items.length}
            route={route}
          />
        )
      )}
      {!onPick && localPick && (
        <ExerciseWord sentence={{ id: item.id, fr: item.fr, en: item.en, segments: [], steps: [], grammar: null, cards: [] }} pick={localPick} narrow={narrow} onClose={() => setLocalPick(null)} />
      )}
    </section>
  );
}

function ExerciseWord({ sentence, pick, onClose }: { sentence: StudySentence; pick: FrPick; narrow: boolean; onClose: () => void }) {
  return (
    <WordOverlay label={`Meaning of ${pick.text}`} onClose={onClose}>
      <WordPanel sentence={sentence} text={pick.text} occurrence={pick.occurrence} onGrammar={onClose} onClose={onClose} inSheet />
    </WordOverlay>
  );
}

function Result({
  sessionKey,
  attempt,
  target,
  isLast,
  onNext,
  onTryAgain,
  onPick,
  onDone,
  doneLabel,
  sessionAttempts,
  itemsCount,
  route,
}: {
  sessionKey: string;
  attempt: Attempt;
  target: string;
  isLast: boolean;
  onNext: () => void;
  onTryAgain: () => void;
  onPick: (p: FrPick) => void;
  onDone: () => void;
  doneLabel: string;
  sessionAttempts: Attempt[];
  itemsCount: number;
  route: string;
}) {
  const r = attempt.result!;
  const correct = attempt.outcome === "correct";
  return (
    <div className="flex flex-col gap-4">
      <div id={`ex-result-${sessionKey}`} tabIndex={-1} className="flex flex-col gap-3">
        {attempt.answerKnown ? (
          <Alert variant="default"><AlertTitle>Answer known</AlertTitle></Alert>
        ) : correct ? (
          <Alert variant="default"><AlertTitle>{attempt.hinted ? "Correct · hint used" : "Correct"}</AlertTitle></Alert>
        ) : (
          <Alert variant="destructive"><AlertTitle>{`Not quite · ${plural(r.issues.length, "difference")}`}</AlertTitle></Alert>
        )}
        {correct ? (
          <div className="flex flex-col gap-3 py-2">
            <span className="text-sm font-medium text-muted-foreground">Answer</span>
            <FrText text={target} className="font-serif text-2xl leading-snug wrap-break-word" onPick={onPick} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" className="md:-ml-3" onClick={() => startPlayback({ kind: "exercise", label: "Practice audio", route }, Math.max(1, target.length / 13), { texts: [target] })}>{<Play aria-hidden />}Play answer</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <MarkedLine label="Your answer" words={r.answer} side="answer" />
            <MarkedLine label="Correct answer" words={r.target} side="target" onPick={onPick} />
          </div>
        )}
        <HistoryStatus attempt={attempt} />
      </div>

      {isLast && <SessionSummary attempts={sessionAttempts} items={itemsCount} />}

      <div className="flex flex-wrap items-center gap-2">
        {isLast ? (
          <Button type="button" variant="default" onClick={onDone}>{doneLabel}</Button>
        ) : (
          <Button type="button" variant="default" onClick={onNext}>Next</Button>
        )}
        <Button type="button" variant="outline" onClick={onTryAgain}>{<RotateCcw aria-hidden />}Try again</Button>
        {isLast && (
          <Button type="button" variant="ghost" onClick={() => go("progress/history?tab=attempts")}>{<HistoryIcon aria-hidden />}See attempts in History</Button>
        )}
      </div>
    </div>
  );
}

export function HistoryStatus({ attempt }: { attempt: Attempt }) {
  if (attempt.history === "saving") return <Spinner label="Saving to practice history…" />;
  if (attempt.history === "saved") return null;
  return (
    <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t save to practice history</AlertTitle><AlertDescription>Your result above is kept. Retrying won’t create a second attempt.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => saveHistory(attempt.id, true)}>Retry saving</Button></div></AlertDescription></Alert>
  );
}

function SessionSummary({ attempts, items }: { attempts: Attempt[]; items: number }) {
  const completed = attempts.filter((a) => a.status === "completed");
  const unaided = completed.filter((a) => !a.hinted && !a.answerKnown && a.outcome === "correct").length;
  const hinted = completed.filter((a) => a.hinted && !a.answerKnown).length;
  const known = completed.filter((a) => a.answerKnown).length;
  return (
    <section className="flex flex-col gap-3" aria-label="Session summary">
      <hr className="border-t" />
      <h3 className="font-medium">Practice complete</h3>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ["Sentences", plural(items, "sentence")],
          ["Attempts", plural(attempts.length, "attempt")],
          ["Completed", `${completed.length}`],
          ["Unaided correct", `${unaided}`],
          ["Hint used", `${hinted}`],
          ["Answer known", `${known}`],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>

    </section>
  );
}
