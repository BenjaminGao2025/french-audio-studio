import { useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, Eye, Play, Turtle, RotateCcw, History as HistoryIcon } from "lucide-react";
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
import { Banner, Button, Dialog, Popover, Segmented, Spinner, useNarrow } from "../components/ui";
import { WordPanel } from "./WordPopup";

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
}: {
  words: DisplayWord[];
  label: string;
  side?: "answer" | "target";
  /** Correct-answer French uses the same tappable text as the study sentence. */
  onPick?: (p: FrPick) => void;
}) {
  const notes = [...new Set(words.map((w) => inlineTagFor(w, side)).filter((tag): tag is string => Boolean(tag)))];
  const tappable = side === "target" && onPick;
  return (
    <div className="stack gap-1">
      <span className="def-label">{label}</span>
      {tappable ? (
        <FrText segments={targetSegments(words)} className="compare-line" onPick={onPick} />
      ) : (
        <p className="compare-line" lang="fr">
          {words.map((w, i) => (
            <span key={i}>
              {w.mark === "ok" ? w.text : <span className={`tok tok--${w.mark}`}>{w.text}</span>}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      )}
      {notes.length > 0 && <p className="compare-note t-meta">{notes.join(" · ")}</p>}
    </div>
  );
}

export function AccentBar({ target }: { target: React.RefObject<HTMLTextAreaElement | null> }) {
  const chars = ["é", "è", "ê", "à", "â", "ç", "î", "ô", "û", "ù", "œ", "’"];
  return (
    <div className="accent-bar" role="group" aria-label="Insert a French character">
      {chars.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Insert ${c === "’" ? "apostrophe" : c}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
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
          }}
        >
          {c}
        </button>
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

  return (
    <section className={compact ? "exercise" : "exercise"} aria-labelledby={`ex-q-${sessionKey}`}>
      <div className="stack gap-3">
        <h2 id={`ex-q-${sessionKey}`} tabIndex={-1} className={compact ? "t-label" : "t-section"}>{kind}</h2>
        <dl className="meta-row">
          <div><dt>Question</dt><dd>{sess.index + 1} of {sess.items.length}</dd></div>
          {sess.mode === "step" ? <div><dt>Step</dt><dd>{step + 1} of {stepCount}</dd></div> : null}
          <div><dt>Source</dt><dd>{sess.source}</dd></div>
          <div><dt>Sentences</dt><dd>{plural(sess.items.length, "sentence")}</dd></div>
        </dl>
        <Segmented
          label="Practice scope"
          value={sess.mode}
          onChange={(m) => {
            if (busy) return;
            patchSession(sessionKey, { mode: m, modeNotice: "" });
            announce(m === "step" ? "Scope changed to step by step." : "Scope changed to whole sentence.");
          }}
          options={[
            { value: "whole", label: "Whole sentence" },
            { value: "step", label: "Step by step" },
          ]}
        />
      </div>

      <hr className="divider" />

      {/* Prompt — never the French target */}
      <div className="stack gap-3">
        {kind === "Recall" ? (
          <>
            <p className="t-support">Write this in French.</p>
            <p className="prompt-en">{t.en}</p>
          </>
        ) : (
          <>
            <p className="t-support">Listen and type what you hear.</p>
            <div className="btn-row">
              <Button kind="secondary" icon={<Play aria-hidden />} onClick={() => play(false)} aria-label="Play practice audio" busy={myAudio?.status === "loading"}>
                Play
              </Button>
              <Button kind="secondary" icon={<Turtle aria-hidden />} onClick={() => play(true)} aria-label="Play practice audio slowly">
                Slow
              </Button>
              {myAudio && myAudio.status !== "error" && (
                <span className="t-support" aria-live="off">
                  {myAudio.status === "playing" ? `Playing practice audio · ${myAudio.speed}×` : myAudio.status === "loading" ? "Loading…" : myAudio.status === "ended" ? "Played" : "Paused"}
                </span>
              )}
            </div>
            {myAudio?.status === "error" && (
              <Banner tone="error" title="Practice audio couldn’t play" live="assertive" actions={<Button kind="secondary" icon={<RotateCcw aria-hidden />} onClick={retryPlayback}>Retry audio</Button>}>
                Your answer is kept. You can also use the English hint.
              </Banner>
            )}
          </>
        )}
        {ui.hint && ui.phase !== "graded" && (
          <div className="banner banner--info" role="status">
            <Lightbulb aria-hidden />
            <div className="banner-body">
              <p className="banner-title">Hint shown</p>
              <p lang={kind === "Recall" ? "fr" : "en"}>{hintFor(kind, t)}</p>
            </div>
          </div>
        )}
        {ui.revealed && !ui.coverAnswer && ui.phase !== "graded" && (
          <div className="banner banner--warning" role="status">
            <Eye aria-hidden />
            <div className="banner-body">
              <p className="banner-title">Answer shown</p>
              <FrText text={t.fr} className="t-fr-lg" onPick={handlePick} />
              <div className="btn-row">
                <Button kind="secondary" onClick={tryFromMemory}>Try it now</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Answer or result */}
      {ui.phase !== "graded" ? (
        <div className="stack gap-3">
          <div className="field">
            <label htmlFor={`ex-input-${sessionKey}`} className="field-label">Your answer in French</label>
            <textarea
              id={`ex-input-${sessionKey}`}
              ref={inputRef}
              className="textarea textarea--answer"
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
            <p id={`ex-keys-${sessionKey}`} className="field-help">Enter checks your answer. Shift + Enter adds a new line.</p>
            {ui.emptyError && (
              <p id={`ex-err-${sessionKey}`} className="field-error" role="alert">Type an answer before checking. No attempt was recorded.</p>
            )}
          </div>
          <AccentBar target={inputRef} />
          {ui.phase === "techfail" && (
            <Banner tone="error" title="Checking didn’t finish" live="assertive">
              This is a technical problem, not a wrong answer. Your answer is kept and Retry checks the same attempt.
            </Banner>
          )}
          {busy && <Spinner label="Checking your answer…" />}
          <div className="sticky-actions">
            <div className="btn-row">
              <Button kind="primary" busy={busy} onClick={() => submitAnswer(sessionKey)}>
                {ui.phase === "techfail" ? "Retry check" : busy ? "Checking…" : "Check"}
              </Button>
              {!ui.hint && (
                <Button kind="tertiary" icon={<Lightbulb aria-hidden />} onClick={() => { patchUI(sessionKey, qk, { hint: true }); if (ui.attemptId) patchAttempt(ui.attemptId, { hinted: true }); announce("Hint shown."); }} disabledReason={busy ? "Checking in progress." : undefined}>
                  {kind === "Dictation" ? "Show English hint" : "Show hint"}
                </Button>
              )}
              {!ui.revealed ? (
                <Button kind="tertiary" icon={<Eye aria-hidden />} onClick={() => { patchUI(sessionKey, qk, { revealed: true, coverAnswer: false }); if (ui.attemptId) patchAttempt(ui.attemptId, { answerKnown: true }); announce("Answer shown."); }} disabledReason={busy ? "Checking in progress." : undefined}>
                  Show answer
                </Button>
              ) : ui.coverAnswer ? (
                <p className="confirm-note" role="status">Answer shown</p>
              ) : null}
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

function ExerciseWord({ sentence, pick, narrow, onClose }: { sentence: StudySentence; pick: FrPick; narrow: boolean; onClose: () => void }) {
  const panel = (
    <WordPanel sentence={sentence} text={pick.text} occurrence={pick.occurrence} onGrammar={onClose} onClose={onClose} inSheet={narrow} />
  );
  if (narrow) return <Dialog sheet titleHidden title={`Meaning of “${pick.text}”`} onClose={onClose}>{panel}</Dialog>;
  return <Popover anchor={pick.anchor} onClose={onClose} label={`Meaning of ${pick.text}`}>{panel}</Popover>;
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
    <div className="stack gap-4">
      <div id={`ex-result-${sessionKey}`} tabIndex={-1} className="stack gap-3">
        {attempt.answerKnown ? (
          <Banner tone="neutral" title="Answer known" />
        ) : correct ? (
          <Banner tone="success" title={attempt.hinted ? "Correct · hint used" : "Correct"} />
        ) : (
          <Banner tone="error" title={`Not quite · ${plural(r.issues.length, "difference")}`} />
        )}
        {correct ? (
          <div className="result-compact">
            <span className="def-label">Answer</span>
            <FrText text={target} className="t-fr-lg" onPick={onPick} />
            <div className="btn-row">
              <Button kind="tertiary" icon={<Play aria-hidden />} onClick={() => startPlayback({ kind: "exercise", label: "Practice audio", route }, Math.max(1, target.length / 13), { texts: [target] })} style={{ marginLeft: -12 }}>
                Play answer
              </Button>
            </div>
          </div>
        ) : (
          <div className="compare">
            <MarkedLine label="Your answer" words={r.answer} side="answer" />
            <MarkedLine label="Correct answer" words={r.target} side="target" onPick={onPick} />
          </div>
        )}
        <HistoryStatus attempt={attempt} />
      </div>

      {isLast && <SessionSummary attempts={sessionAttempts} items={itemsCount} />}

      <div className="btn-row">
        {isLast ? (
          <Button kind="primary" onClick={onDone}>{doneLabel}</Button>
        ) : (
          <Button kind="primary" onClick={onNext}>Next</Button>
        )}
        <Button kind="secondary" icon={<RotateCcw aria-hidden />} onClick={onTryAgain}>Try again</Button>
        {isLast && (
          <Button kind="tertiary" icon={<HistoryIcon aria-hidden />} onClick={() => go("progress/history?tab=attempts")}>
            See attempts in History
          </Button>
        )}
      </div>
    </div>
  );
}

export function HistoryStatus({ attempt }: { attempt: Attempt }) {
  if (attempt.history === "saving") return <Spinner label="Saving to practice history…" />;
  if (attempt.history === "saved") return null;
  return (
    <Banner tone="error" title="Couldn’t save to practice history" live="assertive" actions={<Button kind="secondary" onClick={() => saveHistory(attempt.id, true)}>Retry saving</Button>}>
      Your result above is kept. Retrying won’t create a second attempt.
    </Banner>
  );
}

function SessionSummary({ attempts, items }: { attempts: Attempt[]; items: number }) {
  const completed = attempts.filter((a) => a.status === "completed");
  const unaided = completed.filter((a) => !a.hinted && !a.answerKnown && a.outcome === "correct").length;
  const hinted = completed.filter((a) => a.hinted && !a.answerKnown).length;
  const known = completed.filter((a) => a.answerKnown).length;
  return (
    <section className="stack gap-3" aria-label="Session summary">
      <hr className="divider" />
      <h3 className="t-strong">Practice complete</h3>
      <dl className="stat-grid">
        {[
          ["Sentences", plural(items, "sentence")],
          ["Attempts", plural(attempts.length, "attempt")],
          ["Completed", `${completed.length}`],
          ["Unaided correct", `${unaided}`],
          ["Hint used", `${hinted}`],
          ["Answer known", `${known}`],
        ].map(([k, v]) => (
          <div key={k} className="stat">
            <dt className="t-support">{k}</dt>
            <dd className="t-section num" style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="t-meta">Hinted and answer-known results are listed separately. No combined accuracy score is shown.</p>
    </section>
  );
}
