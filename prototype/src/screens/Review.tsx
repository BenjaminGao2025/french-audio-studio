import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Eye, Lightbulb, Play, Search, CloudOff, Archive, RotateCcw } from "lucide-react";
import {
  SESSION_CARD_LIMIT,
  sortNewCardsForIntroduction,
  spaceSessionCards,
  type LibCard,
  type ReviewCard,
} from "../data/fixtures";
import { grade } from "../lib/grading";
import { importanceFor } from "../lib/lookup";
import { nf, plural } from "../lib/format";
import {
  announce,
  get,
  getCardLookups,
  go,
  isCardFavorite,
  markMastered,
  restoreCard,
  set,
  simulate,
  startPlayback,
  syncChange,
  toggleCardFavorite,
  useApp,
  type ReviewUI,
} from "../state/store";
import { Banner, Button, DisabledReason, FieldText, Importance, PageHead, Pill, Skeleton, Spinner, Tabs } from "../components/ui";
import { AccentBar, MarkedLine } from "./Exercise";
import { runItems } from "./Launcher";
import { SimRecorder } from "./Practice";
import { DailyLimitField } from "./Settings";

const TABS = [
  { value: "due", label: "Due today" },
  { value: "library", label: "Word library" },
  { value: "saved", label: "Saved" },
  { value: "mastered", label: "Mastered" },
];

export function ReviewScreen({ sub }: { sub: string }) {
  const tab = sub === "session" ? "due" : sub;
  return (
    <div className="page">
      <PageHead title="Review" desc="Cards you saved come back when they’re due. Only answering cards here changes their review schedule." />
      <div className="stack gap-5">
        <Tabs label="Review sections" idBase="review" value={tab} tabs={TABS} onChange={(v) => go(`review/${v}`, { focus: false })} />
        <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${tab}`}>
          {sub === "session" ? <ReviewSession /> : tab === "due" ? <DueToday /> : tab === "library" ? <Library mode="library" /> : tab === "saved" ? <Library mode="saved" /> : <MasteredList />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- SCR-REV-01 + SCR-QUO-01 ---------------- */

export function computePlannedSessionCards(
  queue: ReviewCard[],
  dailyNew: number,
  newUsed: number,
): ReviewCard[] {
  const learning = queue.filter((c) => c.group === "learning");
  const due = queue.filter((c) => c.group === "due");
  const newCards = queue.filter((c) => c.group === "new");
  const remaining = Math.max(0, dailyNew - newUsed);
  const maxNewInSession = Math.max(0, SESSION_CARD_LIMIT - (learning.length + due.length));
  const assignedNew = Math.min(newCards.length, remaining, maxNewInSession);
  return spaceSessionCards([...learning, ...due, ...newCards.slice(0, assignedNew)]);
}

function useSessionCards(): ReviewCard[] {
  const queue = useApp((s) => s.queue);
  const sessionCards = useApp((s) => s.review.sessionCards);
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  return useMemo(
    () => sessionCards ?? computePlannedSessionCards(queue, dailyNew, newUsed),
    [sessionCards, queue, dailyNew, newUsed],
  );
}

function DueToday() {
  const forced = useApp((s) => s.ss["SCR-REV-01"]);
  const review = useApp((s) => s.review);
  const offline = useApp((s) => s.offline);
  const queue = useApp((s) => s.queue);
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const savedCards = useApp((s) => s.cards.filter((c) => c.saved).length);
  const sentences = useApp((s) => s.sentences.length);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [n, setN] = useState(0);
  useEffect(() => {
    setLoad("loading");
    let live = true;
    simulate("queue", 600, true, { needsNetwork: false })
      .then(() => live && setLoad("ok"))
      .catch(() => live && setLoad("error"));
    return () => {
      live = false;
    };
  }, [n]);

  const state = forced || (load !== "ok" ? load : offline ? "offline" : review.phase === "complete" ? "complete" : "active");
  // Once a session starts, its card list is frozen so returning to Due today or changing dailyNew mid-session
  // does not alter the session's card count or progress.
  const activeCards = useSessionCards();
  const learning = activeCards.filter((c) => c.group === "learning").length;
  const due = activeCards.filter((c) => c.group === "due").length;
  const newAssigned = activeCards.filter((c) => c.group === "new").length;
  const total = activeCards.length;
  const remainingAllowances = Math.max(0, dailyNew - newUsed);
  const unassignedAllowances = Math.max(0, remainingAllowances - newAssigned);

  const start = () => {
    set((s) => {
      const frozen = s.review.sessionCards ?? computePlannedSessionCards(s.queue, s.dailyNew, s.newUsed);
      return {
        review: {
          ...s.review,
          phase: "active",
          index: s.review.phase === "active" ? s.review.index : 0,
          allowance: frozen.filter((c) => c.group === "new").length,
          sessionCards: frozen,
        },
      };
    });
    go("review/session");
  };

  return (
    <div className="stack gap-6">
      {state === "loading" && (
        <div className="stack gap-3">
          <Spinner label="Loading today’s cards…" />
          <Skeleton lines={3} />
        </div>
      )}
      {state === "error" && (
        <Banner tone="error" title="Today’s cards didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setN(n + 1)}>Retry</Button>}>
          Your cards and progress are safe. This is a simulated loading failure.
        </Banner>
      )}
      {state === "nocards" && (
        <Banner tone="neutral" title="You haven’t saved any cards yet" actions={<Button kind="primary" onClick={() => go("study")}>Go to Study</Button>}>
          In Study, choose “Add to review” on a sentence to save its cards here.
        </Banner>
      )}
      {state === "nodue" && (
        <Banner tone="neutral" title="No cards are due right now">
          Your library has {plural(savedCards, "saved card")}, but none are due today and no new cards are assigned. Come back tomorrow, or practise with Recall or Dictation.
        </Banner>
      )}
      {state === "complete" && (
        <Banner tone="success" title="Today’s review is complete" actions={<Button kind="secondary" onClick={() => go("review/library")}>Open Word library</Button>}>
          {nf.format(total)} of {nf.format(total)} cards in today’s session completed. Tomorrow’s cards will appear here.
        </Banner>
      )}
      {state === "offline" && (
        <Banner tone="warning" title="You’re offline (simulated)">
          You can continue the 12 cards already assigned to this device. New cards need a connection before they can be assigned.
        </Banner>
      )}

      {(state === "active" || state === "offline") && (
        <section className="stack gap-5" aria-labelledby="today-h">
          <div className="stack gap-2">
            <h2 id="today-h" className="t-section">Today’s session</h2>
            <p className="t-figure">{nf.format(state === "offline" ? 12 : total)} cards</p>
            <p className="t-support">
              {state === "offline" ? "Assigned to this device: 8 learning · 1 due review · 3 new" : `${learning} learning cards · ${due} due review card · ${newAssigned} new cards`}
            </p>
            {state !== "offline" && (
              <p className="t-support" data-quota-explanation>
                <span className="t-strong">New-card assignment:</span> {newAssigned} new cards are assigned to today’s session · {unassignedAllowances} of today’s {dailyNew} allowances not assigned (a session holds up to {SESSION_CARD_LIMIT} cards, and {learning} learning + {due} due review use {learning + due} slots).
              </p>
            )}
            {review.sessionCards && (
              <p className="t-meta">
                Session card list is locked at {total} cards while in progress. Changing the daily limit applies to new introductions only.
              </p>
            )}
          </div>
          <div className="stack gap-2">
            <div className="row row--between">
              <span className="t-label">Session progress</span>
              <span className="t-support num">{review.completed} of {state === "offline" ? 12 : total} cards completed</span>
            </div>
            <div className="goal-bar" aria-hidden><div style={{ width: `${(review.completed / Math.max(1, total)) * 100}%` }} /></div>
          </div>
          <div className="btn-row">
            <Button kind="primary" onClick={start} disabledReason={total === 0 ? "No cards are assigned today." : undefined}>
              {review.phase === "active" ? "Continue review" : "Start review"}
            </Button>
          </div>
          <dl className="stat-grid">
            <div className="stat"><dt className="t-support">Daily new-card limit</dt><dd className="t-section num" style={{ margin: 0 }}>{dailyNew} cards</dd></div>
            <div className="stat"><dt className="t-support">New cards introduced today</dt><dd className="t-section num" style={{ margin: 0 }}>{newUsed}</dd></div>
            <div className="stat"><dt className="t-support">Your whole library</dt><dd className="t-section num" style={{ margin: 0 }}>{sentences} sentences · {nf.format(savedCards)} cards</dd></div>
          </dl>
          <p className="t-meta">Today’s session, the daily new-card limit and your whole library are separate numbers.</p>
          <span className="sr-only">Queue pool: {queue.length} cards</span>
        </section>
      )}

      {state !== "loading" && state !== "error" && <QuotaExplainer newAssigned={newAssigned} />}
    </div>
  );
}

function QuotaExplainer({ newAssigned }: { newAssigned: number }) {
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const offline = useApp((s) => s.offline);
  const cards = useApp((s) => s.cards);
  const sentences = useApp((s) => s.sentences);
  const lookups = useApp((s) => s.lookups);
  const introduced = useApp((s) => s.review.introduced);

  const remaining = Math.max(0, dailyNew - newUsed);
  const unassigned = Math.max(0, remaining - Math.min(remaining, newAssigned));

  // Derive the next sentence with un-introduced new cards directly from the library fixtures.
  const nextSentenceInfo = useMemo(() => {
    const orderedNew = sortNewCardsForIntroduction(
      cards.filter((c) => c.saved && !c.mastered && c.status === "new"),
      lookups,
    );
    const introCount = Object.keys(introduced).length;
    const skip = Math.max(0, newUsed - introCount);
    const waiting = orderedNew.filter((c) => !introduced[c.id]).slice(skip);
    const first = waiting[0];
    if (!first) return null;
    const sentence = sentences.find((s) => s.id === first.sentenceId)!;
    const sentenceCards = waiting.filter((c) => c.sentenceId === first.sentenceId);
    const todayCards = sentenceCards.slice(0, remaining);
    const laterCards = sentenceCards.slice(remaining);
    return { sentence, sentenceCards, todayCards, laterCards };
  }, [cards, sentences, lookups, introduced, newUsed, remaining]);

  const nextSentenceNew = nextSentenceInfo?.sentenceCards.length ?? 0;
  const today = nextSentenceInfo?.todayCards.length ?? 0;
  const later = nextSentenceInfo?.laterCards.length ?? 0;

  return (
    <section className="stack gap-4" aria-labelledby="quota-h">
      <hr className="divider" />
      <h2 id="quota-h" className="t-section">How new cards are introduced</h2>
      <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
        <li>Only a new card’s first appearance in Review uses one of today’s allowances.</li>
        <li>Saving cards, due reviews, Recall, Dictation, marking mastered and Undo don’t use or refund an allowance.</li>
        <li>New cards are introduced in the order you saved them; ties go to higher importance, then card ID.</li>
      </ul>
      <div className="panel stack gap-2" aria-live="polite">
        <p className="t-strong">Today: {remaining} of {dailyNew} new-card allowances remain</p>
        <p className="t-support">
          {newAssigned} new cards are assigned to today’s session · {unassigned} of today’s {dailyNew} allowances not assigned.
        </p>
        {dailyNew < newUsed ? (
          <p>
            You’ve already introduced {newUsed} new cards today. Your limit is now {dailyNew}, which is lower, so those {newUsed} cards stay in your reviews and no more new cards are introduced today.
          </p>
        ) : remaining === 0 ? (
          <p>No more new cards today. Due reviews continue as usual.</p>
        ) : nextSentenceInfo ? (
          <p>
            The next sentence in your library (Sentence {nextSentenceInfo.sentence.number}) has {nextSentenceNew} new cards.{" "}
            {today === nextSentenceNew
              ? `All ${nextSentenceNew} can be introduced today.`
              : `${today} will be introduced today (${nextSentenceInfo.todayCards.map((c) => (c.word ? `${c.kind} · ${c.word}` : c.kind)).join(", ")}) and ${later} left for later (${nextSentenceInfo.laterCards.map((c) => (c.word ? `${c.kind} · ${c.word}` : c.kind)).join(", ")}).`}
          </p>
        ) : null}
        {offline && (
          <p className="row" style={{ color: "var(--warning)" }}>
            <CloudOff aria-hidden width={16} height={16} /> New allowances need a connection to be assigned. Cards already on this device can continue.
          </p>
        )}
        <p className="t-meta">Cross-device allocation is a simulated state in this prototype.</p>
      </div>
      <DailyLimitField compact />
    </section>
  );
}

/* ---------------- SCR-REV-02 ---------------- */

function ReviewSession() {
  const review = useApp((s) => s.review);
  const ui = useApp((s) => s.reviewUi);
  const cards = useSessionCards();
  const forced = useApp((s) => s.ss["SCR-REV-02"]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const card: ReviewCard | undefined = cards[review.index];

  // Freeze sessionCards on mount if not already frozen.
  useEffect(() => {
    if (!get().review.sessionCards) {
      set((s) => ({ review: { ...s.review, sessionCards: cards } }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // First introduction of a new card uses exactly one allowance (only while below the daily limit).
  useEffect(() => {
    if (!card || card.group !== "new" || get().review.introduced[card.id]) return;
    set((s) => ({
      review: { ...s.review, introduced: { ...s.review.introduced, [card.id]: true } },
      newUsed: s.newUsed < s.dailyNew ? s.newUsed + 1 : s.newUsed,
    }));
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (review.phase === "complete" || forced === "complete" || !card) {
    return (
      <div className="stack gap-4">
        <Banner tone="success" title="Review complete" live="polite">
          {review.completed} of {cards.length} cards in today’s session completed. Review results updated each card’s schedule (simulated).
        </Banner>
        <div className="btn-row">
          <Button kind="primary" onClick={() => go("review")}>Done — back to Due today</Button>
          <Button kind="secondary" onClick={() => go("review/library")}>Open Word library</Button>
        </div>
      </div>
    );
  }

  const u: ReviewUI = ui[card.id] ?? { draft: "", phase: "answering", hint: false, revealed: false };
  const patch = (p: Partial<ReviewUI>) => set((s) => ({ reviewUi: { ...s.reviewUi, [card.id]: { ...(s.reviewUi[card.id] ?? u), ...p } } }));
  const isLast = review.index === cards.length - 1;

  const submitTyped = () => {
    if (u.phase === "submitting" || u.phase === "graded") return;
    if (!u.draft.trim()) {
      patch({ emptyError: true });
      announce("Type an answer before checking. Nothing was recorded.", true);
      return;
    }
    // Same-attempt retry after techfail updates hinted / answerKnown if Show hint or Show answer was used.
    const frozen = { hinted: Boolean(u.hinted || u.hint), answerKnown: Boolean(u.answerKnown || u.revealed) };
    patch({ phase: "submitting", emptyError: false, ...frozen });
    simulate("grading", 700, true, { needsNetwork: false })
      .then(() => {
        const cur = get().reviewUi[card.id] ?? u;
        const result = grade(card.target, u.draft);
        patch({
          phase: "graded",
          result,
          hinted: Boolean(cur.hinted || cur.hint),
          answerKnown: Boolean(cur.answerKnown || cur.revealed),
        });
        announce(cur.answerKnown || cur.revealed ? "Checked. Recorded as answer known." : result.correct ? "Correct. Review recorded." : "Not quite. Review recorded.");
        requestAnimationFrame(() => document.getElementById("rev-result")?.focus());
        syncChange();
      })
      .catch(() => {
        patch({ phase: "techfail" });
        announce("Checking didn’t finish. This is not a wrong answer.", true);
      });
  };

  const submitSelfCheck = (saidCorrectly: boolean) => {
    if (u.phase === "submitting" || u.phase === "graded") return;
    const frozen = { hinted: Boolean(u.hinted || u.hint), selfCheck: saidCorrectly };
    patch({ phase: "submitting", ...frozen });
    simulate("grading", 700, true, { needsNetwork: false })
      .then(() => {
        const result = saidCorrectly ? grade(card.target, card.target) : grade(card.target, "");
        patch({ phase: "graded", result, selfCheck: saidCorrectly, answerKnown: false });
        announce(saidCorrectly ? "Marked as said correctly. Review recorded." : "Marked for more practice. Review recorded.");
        requestAnimationFrame(() => document.getElementById("rev-result")?.focus());
        syncChange();
      })
      .catch(() => {
        patch({ phase: "techfail" });
        announce("Checking didn’t finish. This is not a wrong answer.", true);
      });
  };

  const next = () => {
    set((s) => ({
      review: isLast ? { ...s.review, phase: "complete", completed: s.review.completed + 1 } : { ...s.review, index: s.review.index + 1, completed: s.review.completed + 1 },
    }));
    requestAnimationFrame(() => document.getElementById("rev-q")?.focus());
  };

  const groupLabel = card.group === "new" ? "New card" : card.group === "due" ? "Due review" : "Learning";
  const isSpeak = card.kind === "Speak";

  return (
    <div className="exercise">
      <div className="row row--between">
        <h2 id="rev-q" tabIndex={-1} className="t-section">Card {review.index + 1} of {cards.length}</h2>
        <span className="t-support num">{review.completed} completed</span>
      </div>
      <div className="row">
        <Pill tone={card.group === "new" ? "info" : undefined}>{groupLabel}</Pill>
        <Pill>{card.kind}</Pill>
        {card.group === "new" && <span className="t-support">First introduction · uses 1 of today’s new-card allowances</span>}
      </div>
      <hr className="divider" />
      <div className="stack gap-3">
        {(card.kind === "Speak" || card.kind === "Recall") && (
          <>
            <p className="t-support">{isSpeak ? "Say this in French, then show the answer to check yourself." : "Write this in French."}</p>
            <p className="prompt-en">{card.prompt}</p>
          </>
        )}
        {card.kind === "Fill-in" && (
          <>
            <p className="t-support">Type the missing word.</p>
            <p className="t-fr-lg" lang="fr">{card.prompt}</p>
          </>
        )}
        {card.kind === "Listen" && (
          <>
            <p className="t-support">Listen and type what you hear.</p>
            <div className="btn-row">
              <Button kind="secondary" icon={<Play aria-hidden />} aria-label="Play card audio" onClick={() => startPlayback({ kind: "review", label: "Practice audio", route: "review/session" }, 4.5)}>Play</Button>
              <Pill tone="demo">Simulated audio</Pill>
            </div>
          </>
        )}
        {u.hint && u.phase !== "graded" && (
          <p className="banner banner--info" role="status"><Lightbulb aria-hidden /> <span lang="fr">Starts with “{card.target.slice(0, 2)}…”</span></p>
        )}
        {u.revealed && u.phase !== "graded" && !isSpeak && (
          <div className="banner banner--warning" role="status">
            <Eye aria-hidden />
            <div className="banner-body">
              <p className="banner-title">Answer shown</p>
              <p lang="fr" className="t-strong">{card.target}</p>
              <p className="t-support" style={{ color: "inherit" }}>Checking now is recorded as “Answer known”.</p>
            </div>
          </div>
        )}
      </div>

      {u.phase !== "graded" ? (
        isSpeak ? (
          <div className="stack gap-4">
            <SimRecorder id={`rev-${card.id}`} onRecorded={() => patch({ recorded: true })} />
            {u.revealed && (
              <div className="panel stack gap-2" role="status">
                <span className="def-label">French answer</span>
                <p lang="fr" className="t-fr-lg">{card.target}</p>
                <div className="btn-row">
                  <Button
                    kind="tertiary"
                    icon={<Play aria-hidden />}
                    style={{ marginLeft: -12 }}
                    onClick={() => startPlayback({ kind: "review", label: "Practice audio", route: "review/session" }, 4.5)}
                  >
                    Play answer
                  </Button>
                </div>
              </div>
            )}
            {u.phase === "techfail" && (
              <Banner tone="error" title="Checking didn’t finish" live="assertive">
                This isn’t a wrong answer and the card’s schedule hasn’t changed. Your self-check is kept.
              </Banner>
            )}
            <div className="sticky-actions">
              {!u.revealed ? (
                <div className="btn-row">
                  <Button
                    kind="primary"
                    icon={<Eye aria-hidden />}
                    onClick={() => {
                      patch({ revealed: true });
                      announce("Answer shown. Check whether you said it correctly.");
                    }}
                  >
                    Show answer
                  </Button>
                  <Button
                    kind="tertiary"
                    icon={<Lightbulb aria-hidden />}
                    disabledReason={u.hint ? "Hint already shown." : undefined}
                    onClick={() => patch({ hint: true, hinted: true })}
                  >
                    {u.hint ? "Hint shown" : "Show hint"}
                  </Button>
                </div>
              ) : u.phase === "techfail" ? (
                <div className="btn-row">
                  <Button kind="primary" onClick={() => submitSelfCheck(u.selfCheck ?? true)}>Retry check</Button>
                </div>
              ) : (
                <div className="btn-row">
                  <Button kind="primary" busy={u.phase === "submitting"} onClick={() => submitSelfCheck(true)}>
                    I said it correctly
                  </Button>
                  <Button kind="secondary" disabled={u.phase === "submitting"} onClick={() => submitSelfCheck(false)}>
                    Not yet
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="stack gap-3">
            <div className="field">
              <label htmlFor="rev-input" className="field-label">Your answer in French</label>
              <textarea
                id="rev-input"
                ref={inputRef}
                className="textarea textarea--answer"
                lang="fr"
                rows={2}
                value={u.draft}
                readOnly={u.phase === "submitting" || u.phase === "techfail"}
                aria-invalid={u.emptyError || undefined}
                aria-describedby={u.emptyError ? "rev-err" : undefined}
                onChange={(e) => patch({ draft: e.target.value, emptyError: false })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitTyped();
                  }
                }}
                spellCheck={false}
              />
              {u.emptyError && <p id="rev-err" className="field-error" role="alert">Type an answer before checking. Nothing was recorded.</p>}
            </div>
            <AccentBar target={inputRef} />
            {u.phase === "techfail" && (
              <Banner tone="error" title="Checking didn’t finish" live="assertive">This isn’t a wrong answer and the card’s schedule hasn’t changed. Your answer is kept.</Banner>
            )}
            <div className="sticky-actions">
              <div className="btn-row">
                <Button kind="primary" busy={u.phase === "submitting"} onClick={submitTyped}>{u.phase === "techfail" ? "Retry check" : "Check"}</Button>
                <Button kind="tertiary" icon={<Lightbulb aria-hidden />} disabledReason={u.hint ? "Hint already shown." : undefined} onClick={() => patch({ hint: true, hinted: true })}>{u.hint ? "Hint shown" : "Show hint"}</Button>
                <Button kind="tertiary" icon={<Eye aria-hidden />} disabledReason={u.revealed ? "Answer already shown." : undefined} onClick={() => patch({ revealed: true, answerKnown: true })}>{u.revealed ? "Answer shown" : "Show answer"}</Button>
              </div>
            </div>
          </div>
        )
      ) : (
        u.result && (
          <div className="stack gap-4">
            <div id="rev-result" tabIndex={-1} className="stack gap-3">
              {isSpeak ? (
                <Banner
                  tone={u.result.correct ? "success" : "neutral"}
                  title={u.result.correct ? (u.hinted ? "Said correctly · hint used" : "Said correctly") : "Marked for more practice"}
                />
              ) : u.answerKnown ? (
                <Banner tone="neutral" title="Answer known">Recorded as answer known — not counted as an independent result.</Banner>
              ) : u.result.correct ? (
                <Banner tone="success" title={u.hinted ? "Correct · hint used" : "Correct"} />
              ) : (
                <Banner tone="error" title={`Not quite · ${plural(u.result.issues.length, "difference")}`} />
              )}
              {isSpeak || u.result.correct ? (
                <div className="result-compact">
                  <span className="def-label">Answer</span>
                  <p lang="fr" className="t-fr-lg">{card.kind === "Fill-in" ? card.sentenceFr : card.target}</p>
                </div>
              ) : (
                <div className="compare">
                  <MarkedLine label="Your answer" words={u.result.answer} side="answer" />
                  <MarkedLine label="Correct answer" words={u.result.target} side="target" />
                </div>
              )}
              <p className="t-support">
                Review recorded. The review scheduler sets this card’s next date (simulated; no interval is shown in this prototype). Hint and answer flags were recorded when you checked.
              </p>
            </div>
            <div className="btn-row">
              <Button kind="primary" onClick={next}>{isLast ? "Finish review" : "Next card"}</Button>
              <Button
                kind="tertiary"
                icon={<Archive aria-hidden />}
                onClick={() => {
                  markMastered(card.id);
                  next();
                }}
              >
                Mark mastered
              </Button>
            </div>
          </div>
        )
      )}
      <div className="btn-row">
        <Button kind="tertiary" className="btn--sm-text" onClick={() => go("review")}>Pause and return to Due today</Button>
      </div>
    </div>
  );
}

/* ---------------- SCR-LIB-01 / SCR-LIB-02 ---------------- */

const STATUS_LABEL: Record<LibCard["status"], string> = { new: "New", learning: "Learning", review: "In review" };

function Library({ mode }: { mode: "library" | "saved" }) {
  const sentences = useApp((s) => s.sentences);
  const cards = useApp((s) => s.cards);
  const lookups = useApp((s) => s.lookups);
  const favorites = useApp((s) => s.favorites);
  const f = useApp((s) => s.libFilters);
  const forced = useApp((s) => s.ss["SCR-LIB-01"]);
  const [limit, setLimit] = useState(12);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const setF = (p: Partial<typeof f>) => set((s) => ({ libFilters: { ...s.libFilters, ...p } }));

  const q = f.q.trim().toLowerCase();
  const savedTotal = cards.filter((c) => c.saved).length;
  const matchCard = (c: LibCard) => {
    const wordLookups = getCardLookups({ lookups }, c);
    const fav = isCardFavorite({ favorites }, c);
    return (
      (mode === "saved" ? c.saved : !f.savedOnly || c.saved) &&
      (f.mastered === "hide" ? !c.mastered : f.mastered === "only" ? c.mastered : true) &&
      (!f.minImportance || (wordLookups !== null && importanceFor(wordLookups) >= f.minImportance)) &&
      (!f.favoritesOnly || fav)
    );
  };
  const groups = useMemo(() => {
    const bySentence = new Map<string, LibCard[]>();
    for (const c of cards) if (matchCard(c)) (bySentence.get(c.sentenceId) ?? bySentence.set(c.sentenceId, []).get(c.sentenceId)!).push(c);
    let list = sentences
      .filter((s) => bySentence.has(s.id))
      .filter((s) => !q || s.fr.toLowerCase().includes(q) || s.en.toLowerCase().includes(q) || bySentence.get(s.id)!.some((c) => c.word?.toLowerCase().includes(q)))
      .map((s) => ({ s, cards: bySentence.get(s.id)! }));
    // Put sentences with matching word cards for "failli" or favorited words first so live updates are immediately visible.
    list = list.sort((a, b) => {
      const aPri = a.cards.some((c) => c.word === "failli") ? 2 : a.cards.some((c) => isCardFavorite({ favorites }, c)) ? 1 : 0;
      const bPri = b.cards.some((c) => c.word === "failli") ? 2 : b.cards.some((c) => isCardFavorite({ favorites }, c)) ? 1 : 0;
      if (mode === "saved") return Math.max(...b.cards.map((c) => c.savedAt)) - Math.max(...a.cards.map((c) => c.savedAt));
      return bPri - aPri || a.s.number - b.s.number;
    });
    return list;
  }, [cards, sentences, lookups, favorites, f, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchingCards = groups.reduce((n, g) => n + g.cards.length, 0);
  const forcedBulk = useApp((s) => s.ss["SCR-LIB-02"]);
  useEffect(() => {
    if (forcedBulk !== "bulk") return;
    setSelecting(true);
    setSel(Object.fromEntries(cards.filter((c) => c.saved && !c.mastered).slice(0, 200).map((c) => [c.id, true])));
  }, [forcedBulk]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const selSentences = new Set(cards.filter((c) => sel[c.id]).map((c) => c.sentenceId)).size;

  if (forced === "loading")
    return (
      <div className="stack gap-3">
        <Spinner label="Loading your library…" />
        <Skeleton lines={5} />
      </div>
    );

  const startBulk = () => {
    const chosen = cards.filter((c) => sel[c.id]);
    const sids = Array.from(new Set(chosen.map((c) => c.sentenceId))).slice(0, 3);
    const items = sids.map((id, i) => {
      const s = sentences.find((x) => x.id === id)!;
      return { id: s.id, fr: s.fr, en: s.en, label: `Selected sentence ${i + 1}`, steps: [{ fr: s.fr, en: s.en }] };
    });
    const key = `run:Recall:bulk:${Date.now()}`;
    runItems.set(key, { kind: "Recall", source: `Selected cards · ${plural(chosen.length, "card")} (demo plays ${items.length} sample questions)`, items });
    set(() => ({ activeRun: key }));
    go("study/run");
  };

  return (
    <div className="stack gap-5">
      {mode === "saved" ? (
        <p className="t-support">
          Saved means a card is in your library and can come up in Review. Favorite is a separate bookmark. Neither changes importance or mastery.
        </p>
      ) : (
        <p className="t-support">Sentences with the cards made from them. Default view hides mastered cards.</p>
      )}
      <div className="filter-bar">
        <div style={{ flex: "1 1 220px" }}>
          <FieldText label="Search" type="search" inputMode="search" value={f.q} onChange={(v) => setF({ q: v })} placeholder="French or English" lang="fr" />
        </div>
        {mode === "library" && (
          <label className="check check--box"><input type="checkbox" checked={f.savedOnly} onChange={(e) => setF({ savedOnly: e.target.checked })} /> Saved only</label>
        )}
        <label className="field" style={{ minWidth: 170 }}>
          <span className="field-label">Mastered cards</span>
          <select className="select" value={f.mastered} onChange={(e) => setF({ mastered: e.target.value as typeof f.mastered })}>
            <option value="hide">Hide mastered</option>
            <option value="show">Include mastered</option>
            <option value="only">Only mastered</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 210 }}>
          <span className="field-label">Importance (word cards only)</span>
          <select className="select" value={f.minImportance} onChange={(e) => setF({ minImportance: Number(e.target.value) as typeof f.minImportance })}>
            <option value={0}>Any</option>
            <option value={3}>3 or more (word cards)</option>
            <option value={4}>4 or more (word cards)</option>
            <option value={5}>5 only (word cards)</option>
          </select>
          <span className="field-help">Applies to Fill-in word cards only</span>
        </label>
        <label className="check check--box"><input type="checkbox" checked={f.favoritesOnly} onChange={(e) => setF({ favoritesOnly: e.target.checked })} /> Favorites only</label>
      </div>
      <div className="row row--between">
        <p className="t-support" aria-live="polite">
          Showing {plural(groups.length, "sentence")} · {plural(matchingCards, "card")} · Library total {sentences.length} sentences · {nf.format(savedTotal)} saved cards
        </p>
        {!selecting ? (
          <Button kind="secondary" onClick={() => setSelecting(true)} disabledReason={!matchingCards ? "No cards to select." : undefined}>Select cards to practise</Button>
        ) : (
          <Button kind="tertiary" onClick={() => setSel(Object.fromEntries(groups.flatMap((g) => g.cards.filter((c) => c.saved)).map((c) => [c.id, true])))}>
            Select all {plural(groups.flatMap((g) => g.cards.filter((c) => c.saved)).length, "matching saved card")}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <Banner
          tone="neutral"
          title="No cards match these filters"
          actions={<Button kind="secondary" onClick={() => setF({ q: "", savedOnly: false, mastered: "hide", minImportance: 0, favoritesOnly: false })}>Clear filters</Button>}
        >
          Your library still has {nf.format(savedTotal)} saved cards. Try fewer filters or a different search.
        </Banner>
      ) : (
        <ul className="list">
          {groups.slice(0, limit).map(({ s, cards: cs }) => (
            <li key={s.id} className="lib-group">
              <div className="row row--between row--top">
                <div className="stack gap-1 grow">
                  <p lang="fr" className="t-strong">{s.fr}</p>
                  <p className="t-support">{s.en}</p>
                </div>
                <span className="t-meta">Sentence {s.number} · {s.topic}</span>
              </div>
              <ul className="stack" aria-label={`Cards from sentence ${s.number}`}>
                {cs.map((c) => {
                  const wordLookups = getCardLookups({ lookups }, c);
                  const fav = isCardFavorite({ favorites }, c);
                  return (
                    <li key={c.id} className="lib-card" data-card-id={c.id} data-word={c.word}>
                      {selecting && c.saved && (
                        <input type="checkbox" aria-label={`Select ${c.kind} card${c.word ? ` for ${c.word}` : ""}`} checked={!!sel[c.id]} onChange={(e) => setSel({ ...sel, [c.id]: e.target.checked })} style={{ width: 20, height: 20, accentColor: "var(--primary)" }} />
                      )}
                      <span className="grow" style={{ minWidth: 160 }}>
                        {c.kind} card{c.word ? <> · <span lang="fr">{c.word}</span></> : ""}
                      </span>
                      {c.saved ? <Pill>{c.mastered ? "Mastered" : STATUS_LABEL[c.status]}</Pill> : <Pill tone="warning">Not saved</Pill>}
                      {wordLookups !== null ? (
                        <Importance count={wordLookups} />
                      ) : (
                        <span className="t-meta">Importance: not applicable to whole-sentence cards</span>
                      )}
                      <Button
                        kind="tertiary"
                        className="btn--sm-text"
                        aria-pressed={fav}
                        icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
                        onClick={() => toggleCardFavorite(c)}
                      >
                        {fav ? "Favorited" : "Favorite"}
                      </Button>
                      {!c.saved ? (
                        <Button kind="tertiary" className="btn--sm-text" onClick={() => { set((st) => ({ cards: st.cards.map((x) => (x.id === c.id ? { ...x, saved: true } : x)) })); announce("Card saved. It didn’t use today’s new-card limit."); syncChange(); }}>Save card</Button>
                      ) : c.mastered ? (
                        <Button kind="tertiary" className="btn--sm-text" onClick={() => go("review/mastered")}>In Mastered</Button>
                      ) : (
                        <Button kind="tertiary" className="btn--sm-text" icon={<Archive aria-hidden />} onClick={() => markMastered(c.id)}>Mark mastered</Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {groups.length > limit && (
        <Button kind="secondary" onClick={() => setLimit(limit + 12)} style={{ alignSelf: "flex-start" }}>
          Show {Math.min(12, groups.length - limit)} more sentences ({groups.length - limit} remaining)
        </Button>
      )}
      {selecting && (
        <div className="bulk-bar" role="region" aria-label="Bulk practice">
          <p className="grow t-strong" aria-live="polite">
            Practise {plural(selectedIds.length, "selected card")} from {nf.format(savedTotal)} library cards
            {selectedIds.length ? <span className="t-support"> · from {plural(selSentences, "sentence")}</span> : null}
          </p>
          <Button kind="secondary" onClick={() => { setSelecting(false); setSel({}); }}>Cancel</Button>
          <Button kind="primary" onClick={startBulk} disabledReason={!selectedIds.length ? "Select at least one card." : undefined}>Start practice</Button>
          {!selectedIds.length && <DisabledReason>Select at least one card.</DisabledReason>}
        </div>
      )}
    </div>
  );
}

/* ---------------- SCR-MAS-02 ---------------- */

function MasteredList() {
  const cards = useApp((s) => s.cards);
  const sentences = useApp((s) => s.sentences);
  const forced = useApp((s) => s.ss["SCR-MAS-02"]);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Record<string, "pending" | "error" | "done">>({});
  const mastered = forced === "empty" ? [] : cards.filter((c) => c.mastered || pending[c.id] === "done");
  const shown = mastered.filter((c) => {
    if (!q.trim()) return true;
    const s = sentences.find((x) => x.id === c.sentenceId)!;
    return (s.fr + " " + s.en + " " + (c.word ?? "")).toLowerCase().includes(q.trim().toLowerCase());
  });
  const restore = (id: string) => {
    setPending((p) => ({ ...p, [id]: "pending" }));
    simulate("restore", 800, true)
      .then(() => {
        restoreCard(id);
        setPending((p) => ({ ...p, [id]: "done" }));
        announce("Card restored to your default review.");
        syncChange();
      })
      .catch(() => {
        setPending((p) => ({ ...p, [id]: "error" }));
        announce("Couldn’t restore the card. It’s still in Mastered.", true);
      });
  };
  if (!mastered.length)
    return (
      <Banner tone="neutral" title="No mastered cards">
        Cards you mark as mastered are hidden from your default review and listed here. Nothing is ever deleted.
      </Banner>
    );
  return (
    <div className="stack gap-4">
      <p className="t-support">Mastered cards are hidden from your default review. Restore one to bring it back. Nothing here is deleted.</p>
      <div style={{ maxWidth: 420 }}>
        <FieldText label="Search mastered cards" type="search" value={q} onChange={setQ} lang="fr" />
      </div>
      <p className="t-support" aria-live="polite">Showing {shown.length} of {plural(mastered.length, "mastered card")}</p>
      {shown.length === 0 ? (
        <Banner tone="neutral" title="No mastered cards match your search" actions={<Button kind="secondary" onClick={() => setQ("")}>Clear search</Button>} />
      ) : (
        <ul className="list">
          {shown.slice(0, 30).map((c) => {
            const s = sentences.find((x) => x.id === c.sentenceId)!;
            const st = pending[c.id];
            return (
              <li key={c.id} className="list-row">
                <div className="grow stack" style={{ minWidth: 200 }}>
                  <span lang="fr">{s.fr}</span>
                  <span className="t-support">{c.kind} card{c.word ? ` · ${c.word}` : ""}</span>
                </div>
                {st === "done" ? (
                  <Pill tone="success">Restored</Pill>
                ) : st === "error" ? (
                  <>
                    <span className="t-support" style={{ color: "var(--error)" }}>Restore failed</span>
                    <Button kind="secondary" icon={<RotateCcw aria-hidden />} onClick={() => restore(c.id)}>Retry</Button>
                  </>
                ) : (
                  <Button kind="secondary" busy={st === "pending"} onClick={() => restore(c.id)}>{st === "pending" ? "Restoring…" : "Restore"}</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="note"><Search aria-hidden /> Batch mastery and permanent deletion aren’t part of this prototype.</p>
    </div>
  );
}
