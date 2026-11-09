import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Eye, Lightbulb, Play, Search, CloudOff, Archive, RotateCcw } from "lucide-react";
import type { LibCard, ReviewCard } from "../data/fixtures";
import { grade } from "../lib/grading";
import { importanceFor } from "../lib/lookup";
import { nf, plural } from "../lib/format";
import {
  announce,
  get,
  go,
  markMastered,
  restoreCard,
  set,
  simulate,
  startPlayback,
  syncChange,
  useApp,
  type ReviewUI,
} from "../state/store";
import { Banner, Button, DisabledReason, FieldText, Importance, PageHead, Pill, Skeleton, Spinner, Tabs } from "../components/ui";
import { AccentBar, IssueList, MarkedLine } from "./Exercise";
import { runItems } from "./Launcher";
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

function useSessionCards() {
  const queue = useApp((s) => s.queue);
  const allowance = useApp((s) => s.review.allowance);
  return useMemo(() => [...queue.filter((c) => c.group !== "new"), ...queue.filter((c) => c.group === "new").slice(0, allowance)], [queue, allowance]);
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
  const learning = queue.filter((c) => c.group === "learning").length;
  const due = queue.filter((c) => c.group === "due").length;
  const remaining = Math.max(0, dailyNew - newUsed);
  const newPlanned = Math.min(queue.filter((c) => c.group === "new").length, remaining);
  const total = learning + due + newPlanned;

  const start = () => {
    set((s) => ({ review: { ...s.review, phase: "active", index: s.review.phase === "active" ? s.review.index : 0, allowance: newPlanned } }));
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
              {state === "offline" ? "Assigned to this device: 8 learning · 1 due review · 3 new" : `${learning} learning cards · ${due} due review card · ${newPlanned} new cards`}
            </p>
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
        </section>
      )}

      {state !== "loading" && state !== "error" && <QuotaExplainer />}
    </div>
  );
}

function QuotaExplainer() {
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const offline = useApp((s) => s.offline);
  const remaining = Math.max(0, dailyNew - newUsed);
  const nextSentenceNew = 5;
  const today = Math.min(remaining, nextSentenceNew);
  return (
    <section className="stack gap-4" aria-labelledby="quota-h">
      <hr className="divider" />
      <h2 id="quota-h" className="t-section">How new cards are introduced</h2>
      <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
        <li>Only a new card’s first appearance in Review uses one of today’s allowances.</li>
        <li>Saving cards, due reviews, Recall, Dictation, marking mastered and Undo don’t use or refund an allowance.</li>
        <li>New cards are introduced in the order you saved them; ties go to higher importance.</li>
      </ul>
      <div className="panel stack gap-2" aria-live="polite">
        <p className="t-strong">Today: {remaining} of {dailyNew} new-card allowances remain</p>
        {dailyNew < newUsed ? (
          <p>
            You’ve already introduced {newUsed} new cards today. Your limit is now {dailyNew}, which is lower, so those {newUsed} cards stay in your reviews and no more new cards are introduced today.
          </p>
        ) : remaining === 0 ? (
          <p>No more new cards today. Due reviews continue as usual.</p>
        ) : (
          <p>
            The next sentence in your library has {nextSentenceNew} new cards. {today === nextSentenceNew ? `All ${nextSentenceNew} can be introduced today.` : `${today} will be introduced today and ${nextSentenceNew - today} later.`}
          </p>
        )}
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

  // First introduction of a new card uses exactly one allowance.
  useEffect(() => {
    if (!card || card.group !== "new" || get().review.introduced[card.id]) return;
    set((s) => ({ review: { ...s.review, introduced: { ...s.review.introduced, [card.id]: true } }, newUsed: s.newUsed + 1 }));
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (review.phase === "complete" || forced === "complete" || !card) {
    return (
      <div className="stack gap-4">
        <Banner tone="success" title="Review complete" live="polite">
          {review.completed} of {cards.length} cards in today’s session completed. Review results updated each card’s schedule (simulated).
        </Banner>
        <div className="btn-row">
          <Button kind="primary" onClick={() => go("review")}>Done — back to Due today</Button>
          <Button kind="tertiary" onClick={() => go("progress/history")}>View History</Button>
        </div>
      </div>
    );
  }

  const u: ReviewUI = ui[card.id] ?? { draft: "", phase: "answering", hint: false, revealed: false };
  const patch = (p: Partial<ReviewUI>) => set((s) => ({ reviewUi: { ...s.reviewUi, [card.id]: { ...(s.reviewUi[card.id] ?? u), ...p } } }));
  const isLast = review.index === cards.length - 1;

  const submit = () => {
    if (u.phase === "submitting" || u.phase === "graded") return;
    if (!u.draft.trim()) {
      patch({ emptyError: true });
      announce("Type an answer before checking. Nothing was recorded.", true);
      return;
    }
    const frozen = { hinted: u.hint, answerKnown: u.revealed };
    patch({ phase: "submitting", emptyError: false, ...frozen });
    simulate("grading", 700, true, { needsNetwork: false })
      .then(() => {
        const result = grade(card.target, u.draft);
        patch({ phase: "graded", result });
        announce(result.correct ? "Correct. Review recorded." : "Not quite. Review recorded.");
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
        {card.kind === "Recall" && (
          <>
            <p className="t-support">Write this in French.</p>
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
        {u.revealed && u.phase !== "graded" && (
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
                  submit();
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
              <Button kind="primary" busy={u.phase === "submitting"} onClick={submit}>{u.phase === "techfail" ? "Retry check" : "Check"}</Button>
              <Button kind="tertiary" icon={<Lightbulb aria-hidden />} disabledReason={u.hint ? "Hint already shown." : undefined} onClick={() => patch({ hint: true })}>{u.hint ? "Hint shown" : "Show hint"}</Button>
              <Button kind="tertiary" icon={<Eye aria-hidden />} disabledReason={u.revealed ? "Answer already shown." : undefined} onClick={() => patch({ revealed: true })}>{u.revealed ? "Answer shown" : "Show answer"}</Button>
            </div>
          </div>
        </div>
      ) : (
        u.result && (
          <div className="stack gap-4">
            <div id="rev-result" tabIndex={-1} className="stack gap-3">
              {u.answerKnown ? (
                <Banner tone="neutral" title="Answer known">Recorded as answer known — not counted as an independent result.</Banner>
              ) : u.result.correct ? (
                <Banner tone="success" title={u.hinted ? "Correct · hint used" : "Correct"} />
              ) : (
                <Banner tone="error" title={`Not quite · ${plural(u.result.issues.length, "difference")}`} />
              )}
              {u.result.correct ? (
                <div className="result-compact">
                  <span className="def-label">Answer</span>
                  <p lang="fr" className="t-fr-lg">{card.kind === "Fill-in" ? card.sentenceFr : card.target}</p>
                </div>
              ) : (
                <div className="compare">
                  <MarkedLine label="Your answer" words={u.result.answer} />
                  <MarkedLine label="Correct answer" words={u.result.target} />
                  <IssueList result={u.result} />
                </div>
              )}
              <p className="t-support">Review recorded. The review scheduler sets this card’s next date (simulated; no interval is shown in this prototype).</p>
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
  const f = useApp((s) => s.libFilters);
  const forced = useApp((s) => s.ss["SCR-LIB-01"]);
  const [limit, setLimit] = useState(12);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const setF = (p: Partial<typeof f>) => set((s) => ({ libFilters: { ...s.libFilters, ...p } }));

  const q = f.q.trim().toLowerCase();
  const savedTotal = cards.filter((c) => c.saved).length;
  const matchCard = (c: LibCard) =>
    (mode === "saved" ? c.saved : !f.savedOnly || c.saved) &&
    (f.mastered === "hide" ? !c.mastered : f.mastered === "only" ? c.mastered : true) &&
    (!f.minImportance || importanceFor(c.lookups) >= f.minImportance) &&
    (!f.favoritesOnly || c.favorite);
  const groups = useMemo(() => {
    const bySentence = new Map<string, LibCard[]>();
    for (const c of cards) if (matchCard(c)) (bySentence.get(c.sentenceId) ?? bySentence.set(c.sentenceId, []).get(c.sentenceId)!).push(c);
    let list = sentences
      .filter((s) => bySentence.has(s.id))
      .filter((s) => !q || s.fr.toLowerCase().includes(q) || s.en.toLowerCase().includes(q) || bySentence.get(s.id)!.some((c) => c.word?.toLowerCase().includes(q)))
      .map((s) => ({ s, cards: bySentence.get(s.id)! }));
    if (mode === "saved") list = list.sort((a, b) => Math.max(...b.cards.map((c) => c.savedAt)) - Math.max(...a.cards.map((c) => c.savedAt)));
    return list;
  }, [cards, sentences, f, mode]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <label className="field" style={{ minWidth: 150 }}>
          <span className="field-label">Importance</span>
          <select className="select" value={f.minImportance} onChange={(e) => setF({ minImportance: Number(e.target.value) as typeof f.minImportance })}>
            <option value={0}>Any</option>
            <option value={3}>3 or more</option>
            <option value={4}>4 or more</option>
            <option value={5}>5 only</option>
          </select>
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
                {cs.map((c) => (
                  <li key={c.id} className="lib-card">
                    {selecting && c.saved && (
                      <input type="checkbox" aria-label={`Select ${c.kind} card${c.word ? ` for ${c.word}` : ""}`} checked={!!sel[c.id]} onChange={(e) => setSel({ ...sel, [c.id]: e.target.checked })} style={{ width: 20, height: 20, accentColor: "var(--primary)" }} />
                    )}
                    <span className="grow" style={{ minWidth: 160 }}>
                      {c.kind} card{c.word ? <> · <span lang="fr">{c.word}</span></> : ""}
                    </span>
                    {c.saved ? <Pill>{c.mastered ? "Mastered" : STATUS_LABEL[c.status]}</Pill> : <Pill tone="warning">Not saved</Pill>}
                    <Importance count={c.lookups} />
                    <Button
                      kind="tertiary"
                      className="btn--sm-text"
                      aria-pressed={c.favorite}
                      icon={c.favorite ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
                      onClick={() => set((st) => ({ cards: st.cards.map((x) => (x.id === c.id ? { ...x, favorite: !x.favorite } : x)) }))}
                    >
                      {c.favorite ? "Favorited" : "Favorite"}
                    </Button>
                    {!c.saved ? (
                      <Button kind="tertiary" className="btn--sm-text" onClick={() => { set((st) => ({ cards: st.cards.map((x) => (x.id === c.id ? { ...x, saved: true } : x)) })); announce("Card saved. It didn’t use today’s new-card limit."); syncChange(); }}>Save card</Button>
                    ) : c.mastered ? (
                      <Button kind="tertiary" className="btn--sm-text" onClick={() => go("review/mastered")}>In Mastered</Button>
                    ) : (
                      <Button kind="tertiary" className="btn--sm-text" icon={<Archive aria-hidden />} onClick={() => markMastered(c.id)}>Mark mastered</Button>
                    )}
                  </li>
                ))}
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
