import { useLayoutEffect, useRef } from "react";
import { Lightbulb, Eye, Play, Turtle, RotateCcw, History as HistoryIcon } from "lucide-react";
import type { PracticeItem } from "../data/fixtures";
import { grade, type DisplayWord } from "../lib/grading";
import { plural } from "../lib/format";
import {
  announce,
  attemptToRecord,
  get,
  go,
  retryPlayback,
  set,
  simulate,
  startPlayback,
  useApp,
  type Attempt,
  type ExerciseSession,
  type QuestionUI,
} from "../state/store";
import { Banner, Button, Pill, Segmented, Spinner } from "../components/ui";

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

export function saveHistory(attemptId: string, manualRetry = false) {
  if (manualRetry) patchAttempt(attemptId, { cleared: false });
  patchAttempt(attemptId, { history: "saving" });
  simulate("history", 700, true)
    .then(() => {
      const a = get().attempts.find((x) => x.id === attemptId);
      if (!a) return;
      patchAttempt(attemptId, { history: "saved" });
      if (a.cleared && !manualRetry) return;
      const rec = attemptToRecord({ ...a, history: "saved" });
      set((s) => ({
        history: {
          ...s.history,
          attempts: s.history.attempts.some((r) => r.id === attemptId)
            ? s.history.attempts.map((r) => (r.id === attemptId ? rec : r))
            : [rec, ...s.history.attempts],
        },
      }));
      announce("Saved to practice history.");
    })
    .catch(() => {
      const a = get().attempts.find((x) => x.id === attemptId);
      if (!a) return;
      patchAttempt(attemptId, { history: "failed" });
      if (a.cleared && !manualRetry) return;
      const rec = attemptToRecord({ ...a, history: "failed" });
      set((s) => ({
        history: {
          ...s.history,
          attempts: s.history.attempts.some((r) => r.id === attemptId)
            ? s.history.attempts.map((r) => (r.id === attemptId ? rec : r))
            : [rec, ...s.history.attempts],
        },
      }));
      announce("Couldn’t save to practice history. Your result is kept.", true);
    });
}

export function submitAnswer(key: string) {
  const sess = get().exercises[key];
  if (!sess) return;
  const qk = questionKey(sess);
  const ui = sess.ui[qk] ?? { phase: "answering", hint: false, revealed: false };
  if (ui.phase === "submitting" || ui.phase === "graded") return; // duplicate submission prevented
  const draft = sess.drafts[qk] ?? "";
  if (!draft.trim()) {
    patchUI(key, qk, { emptyError: true });
    announce("Type an answer before checking. No attempt was recorded.", true);
    return;
  }
  const target = currentTarget(sess);
  const item = sess.items[sess.index];
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
  patchUI(key, qk, { phase: "submitting", attemptId, emptyError: false });
  announce("Checking your answer…");
  simulate("grading", 700, true, { needsNetwork: false })
    .then(() => {
      if (!get().attempts.some((x) => x.id === attemptId)) return;
      const res = grade(target.fr, draft);
      const curUi = get().exercises[key]?.ui[qk];
      const prev = get().attempts.find((x) => x.id === attemptId);
      patchAttempt(attemptId!, {
        status: "completed",
        outcome: res.correct ? "correct" : "incorrect",
        result: res,
        hinted: Boolean(prev?.hinted || curUi?.hint),
        answerKnown: Boolean(prev?.answerKnown || curUi?.revealed),
      });
      patchUI(key, qk, { phase: "graded" });
      const a = get().attempts.find((x) => x.id === attemptId)!;
      announce(a.answerKnown ? "Checked. Recorded as answer known." : res.correct ? "Correct." : `Not quite. ${plural(res.issues.length, "difference")}.`);
      requestAnimationFrame(() => document.getElementById(`ex-result-${key}`)?.focus());
      saveHistory(attemptId!);
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
  if (w.mark === "different") return given ? `Different word · you wrote ${given}` : "Different word";
  if (w.mark === "accent") return given ? `Accent · you wrote ${given}` : "Accent";
  return null;
}

export function MarkedLine({
  words,
  label,
  side = label === "Your answer" ? "answer" : "target",
}: {
  words: DisplayWord[];
  label: string;
  side?: "answer" | "target";
}) {
  return (
    <div className="stack gap-1">
      <span className="def-label">{label}</span>
      <p className="compare-line" lang="fr">
        {words.map((w, i) => {
          const tag = inlineTagFor(w, side);
          return (
            <span key={i}>
              {w.mark === "ok" ? (
                w.text
              ) : (
                <span className={`tok tok--${w.mark}`}>
                  {w.text}
                  {tag && (
                    <span className="tok-tag">
                      <span className="sr-only"> (</span>
                      {tag}
                      <span className="sr-only">)</span>
                    </span>
                  )}
                </span>
              )}
              {i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </p>
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
  compact,
  doneLabel = "Done — return to Study",
}: {
  sessionKey: string;
  kind: "Recall" | "Dictation";
  source: string;
  items: PracticeItem[];
  onDone: () => void;
  compact?: boolean;
  doneLabel?: string;
}) {
  useLayoutEffect(() => ensureSession(sessionKey, kind, source, items), [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sess = useApp((s) => s.exercises[sessionKey]);
  const attempts = useApp((s) => s.attempts);
  const player = useApp((s) => s.player);
  const route = useApp((s) => s.route);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const play = (slow: boolean) =>
    startPlayback({ kind: "exercise", label: "Practice audio", route }, slow ? 6 : 4.5, { speed: slow ? 0.75 : 1 });

  const qLabel = `${kind} · Question ${sess.index + 1} of ${sess.items.length}${sess.mode === "step" ? ` · Step ${step + 1} of ${stepCount}` : ""}`;

  return (
    <section className={compact ? "exercise" : "exercise"} aria-labelledby={`ex-q-${sessionKey}`}>
      <div className="stack gap-3">
        <div className="row row--between">
          <h2 id={`ex-q-${sessionKey}`} tabIndex={-1} className={compact ? "t-label" : "t-section"}>{qLabel}</h2>
          <span className="t-support">Source: {sess.source} · {plural(sess.items.length, "sentence")}</span>
        </div>
        <Segmented
          label="Practice scope"
          value={sess.mode}
          onChange={(m) => {
            if (busy) return;
            patchSession(sessionKey, {
              mode: m,
              modeNotice: m === "step" ? "Now practising step by step. Your whole-sentence answer and progress are kept." : "Now practising the whole sentence. Your step answers and progress are kept.",
            });
            announce(m === "step" ? "Scope changed to step by step." : "Scope changed to whole sentence.");
          }}
          options={[
            { value: "whole", label: "Whole sentence" },
            { value: "step", label: "Step by step" },
          ]}
        />
        {sess.modeNotice && <p className="t-support" role="status">{sess.modeNotice}</p>}
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
              <Pill tone="demo">Simulated audio</Pill>
            </div>
            {myAudio?.status === "error" && (
              <Banner tone="error" title="Practice audio couldn’t play" live="assertive" actions={<Button kind="secondary" icon={<RotateCcw aria-hidden />} onClick={retryPlayback}>Retry audio</Button>}>
                Your answer is kept. You can also use the English hint.
              </Banner>
            )}
          </>
        )}
        {ui.hint && ui.phase !== "graded" && (
          <p className="banner banner--info" role="status">
            <Lightbulb aria-hidden />
            <span lang={kind === "Recall" ? "fr" : "en"}>{hintFor(kind, t)}</span>
          </p>
        )}
        {ui.revealed && ui.phase !== "graded" && (
          <div className="banner banner--warning" role="status">
            <Eye aria-hidden />
            <div className="banner-body">
              <p className="banner-title">Answer shown</p>
              <p lang="fr" className="t-fr-lg" style={{ fontSize: 20 }}>{t.fr}</p>
              <p className="t-support" style={{ color: "inherit" }}>If you check now, it’s recorded as “Answer known” and not counted as an independent result.</p>
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
              <Button kind="tertiary" icon={<Lightbulb aria-hidden />} onClick={() => { patchUI(sessionKey, qk, { hint: true }); if (ui.attemptId) patchAttempt(ui.attemptId, { hinted: true }); announce("Hint shown."); }} disabledReason={ui.hint ? "Hint already shown." : busy ? "Checking in progress." : undefined}>
                {ui.hint ? "Hint shown" : kind === "Dictation" ? "Show English hint" : "Show hint"}
              </Button>
              <Button kind="tertiary" icon={<Eye aria-hidden />} onClick={() => { patchUI(sessionKey, qk, { revealed: true }); if (ui.attemptId) patchAttempt(ui.attemptId, { answerKnown: true }); announce("Answer shown."); }} disabledReason={ui.revealed ? "Answer already shown." : busy ? "Checking in progress." : undefined}>
                {ui.revealed ? "Answer shown" : "Show answer"}
              </Button>
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
            onDone={onDone}
            doneLabel={doneLabel}
            sessionAttempts={sessionAttempts}
            itemsCount={sess.items.length}
            route={route}
          />
        )
      )}
      <p className="t-meta">
        {kind} practice doesn’t use your daily new-card limit and doesn’t change review scheduling. Practice history is separate from saved cards.
      </p>
    </section>
  );
}

function outcomeLabel(a: Attempt) {
  if (a.answerKnown) return "Answer known";
  return `${a.hinted ? "Hint used" : "Unaided"} · ${a.outcome === "correct" ? "Correct" : "Incorrect"}`;
}

function Result({
  sessionKey,
  attempt,
  target,
  isLast,
  onNext,
  onTryAgain,
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
          <Banner tone="neutral" title="Answer known">
            You checked after showing the answer, so this is recorded as “Answer known” and isn’t counted as an independent result.
          </Banner>
        ) : correct ? (
          <Banner tone="success" title={attempt.hinted ? "Correct · hint used" : "Correct"} />
        ) : (
          <Banner tone="error" title={`Not quite · ${plural(r.issues.length, "difference")}`} />
        )}
        {correct ? (
          <div className="result-compact">
            <span className="def-label">Answer</span>
            <p lang="fr" className="t-fr-lg">{target}</p>
            <div className="btn-row">
              <Button kind="tertiary" icon={<Play aria-hidden />} onClick={() => startPlayback({ kind: "exercise", label: "Practice audio", route }, 4.5)} style={{ marginLeft: -12 }}>
                Play answer
              </Button>
            </div>
          </div>
        ) : (
          <div className="compare">
            <MarkedLine label="Your answer" words={r.answer} side="answer" />
            <MarkedLine label="Correct answer" words={r.target} side="target" />
          </div>
        )}
        <p className="t-support">
          Recorded as: {outcomeLabel(attempt)} · {attempt.scope}
          {attempt.step ? `, step ${attempt.step}` : ""}. Hint and answer flags were recorded when you checked.
        </p>
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
  if (attempt.history === "saved") return <p className="t-support">Saved to practice history.</p>;
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
