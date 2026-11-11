import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Eye, Play, Search, CloudOff, Archive, RotateCcw, Volume2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_SESSION_SIZE,
  planSession,
  wordCardImportance,
  type LibCard,
  type LibSentence,
  type ReviewCard,
  type ReviewMode,
  type SessionPlan,
  type StudySentence,
} from "../data/fixtures";
import { ApiError } from "../api/client";
import { favoriteKey, libraryReady, loadLibrary, loadQueue, masterCard, rateCard, restoreMastered, setFavorite, toReviewCard as serverToReviewCard } from "../api/review";
import { grade } from "../lib/grading";
import { gradeFeedback } from "../lib/feedback";
import { importanceFor } from "../lib/lookup";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { cx, nf, plural } from "../lib/format";
import { announce, get, getCardLookups, go, introduceNewCard, sayFrench, set, useApp, type ReviewUI } from "../state/store";
import { Banner, Button, Checkbox, ChoiceSelect, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, DisabledReason, Disclosure, FieldText, Importance, PageHead, Pill, Progress, Skeleton, Spinner, Table, Tabs, Textarea, WordDock, useNarrow } from "../components/ui";
import { getCoreRowModel, useLegacyTable, type LegacyColumnDef } from "@tanstack/react-table/legacy";
import { FrText, tokenizeFrench, type FrPick, type FrSegment } from "../components/FrText";
import { WordPanel } from "./WordPopup";
import { MarkedLine } from "./Exercise";
import { runItems } from "./Launcher";
import { DailyLimitField } from "./Settings";

/** Design reference states set this so Due today shows their sample queue instead of loading the learner's. */
export const SAMPLE_QUEUE = "sample-queue";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "");

/** Loads the library once for a screen; `n` changes retry it. */
function useLibrary(): { state: "loading" | "ok" | "error"; error: string; retry: () => void } {
  const [st, setSt] = useState<"loading" | "ok" | "error">(libraryReady() ? "ok" : "loading");
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (!libraryReady()) setSt("loading");
    loadLibrary()
      .then(() => live && setSt("ok"))
      .catch((e) => {
        if (!live) return;
        setError(errText(e));
        setSt("error");
      });
    return () => {
      live = false;
    };
  }, [n]);
  return { state: st, error, retry: () => setN((x) => x + 1) };
}

/** "in 10 minutes", "tomorrow", "in 4 days" for the next review date the server set. */
export function dueIn(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return "in a minute";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${plural(min, "minute")}`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${plural(h, "hour")}`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

/** Compact one-line due label for the Saved table: now / N min / N h / N d / overdue N d. */
export function compactDue(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms < -60_000) {
    const d = Math.max(1, Math.round(-ms / 86_400_000));
    return `overdue ${d} d`;
  }
  if (ms <= 60_000) return "now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Short Saved date: "9 Nov", with the year only when it isn't the current year. */
export function shortSavedDate(n: number, now = new Date()): string {
  if (!n) return "—";
  const ms = n > 1e12 ? n : Date.UTC(2026, 0, 1) + n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear()
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("en-GB", opts);
}

/** Old T.interval: <1 min / N min / N h / N d / N mo / N y from a seconds preview. */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return "<1 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  if (seconds < 30 * 86400) return `${Math.round(seconds / 86400)} d`;
  if (seconds < 365 * 86400) return `${(seconds / 2592000).toFixed(1).replace(/\.0$/, "")} mo`;
  return `${(seconds / 31536000).toFixed(1).replace(/\.0$/, "")} y`;
}

/** First letter of each word, the rest as underscores — the old initials hint. */
function initialsHint(text: string): string {
  return (text || "").replace(/([A-Za-zÀ-ÖØ-öø-ÿŒœ])([A-Za-zÀ-ÖØ-öø-ÿŒœ]*)/g, (_, first: string, rest: string) => first + rest.replace(/./g, "_"));
}

/** What to read aloud on reveal, following the old cardSpeech rule. */
function cardSpeech(card: ReviewCard): string {
  if (card.mode === "recognize") return card.target;
  if (card.mode === "grammar") return card.meta?.full_fr || card.sentenceFr;
  return card.sentenceFr;
}

/** Shown only when a card has no interval preview, so the grade buttons are never hollow. */
const FALLBACK_INTERVALS: Record<number, number> = { 1: 60, 2: 6 * 3600, 3: 86400, 4: 4 * 86400 };

const RATINGS: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "Again" },
  { value: 2, label: "Hard" },
  { value: 3, label: "Good" },
  { value: 4, label: "Easy" },
];
const MODE_LABEL: Record<ReviewMode, string> = { listen: "Listen", speak: "Speak", cloze: "Fill-in", recognize: "Recall", grammar: "Grammar" };
const LEARN_AHEAD_MS = 20 * 60 * 1000;

/** The full sentence as FrText segments, with the target word(s) highlighted using --mark-bg. */
function markedSegments(full: string, target: string): FrSegment[] {
  const segs = tokenizeFrench(full);
  const t = (target || "").trim();
  if (!t) return segs;
  const fold = (s: string) => s.replace(/[’ʼ]/g, "'").toLocaleLowerCase("fr");
  let start = full.toLocaleLowerCase("fr").indexOf(t.toLocaleLowerCase("fr"));
  if (start < 0) start = fold(full).indexOf(fold(t)); // curly vs straight apostrophes
  if (start < 0) return segs;
  const end = start + t.length;
  let pos = 0;
  return segs.map((s) => {
    const a = pos;
    const b = pos + s.t.length;
    pos = b;
    return a < end && b > start ? { ...s, mark: true } : s;
  });
}

const TABS = [
  { value: "due", label: "Due today" },
  { value: "saved", label: "Saved" },
  { value: "mastered", label: "Mastered" },
];

export function ReviewScreen({ sub }: { sub: string }) {
  const tab = sub === "session" ? "due" : sub === "library" ? "saved" : sub;
  if (sub === "session") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 review-focus">
        <h1 className="sr-only" tabIndex={-1} data-page-title>Review</h1>
        <ReviewSession />
      </div>
    );
  }
  return (
    <div className={cx("mx-auto flex w-full max-w-3xl flex-col gap-6", tab === "saved" && "max-w-6xl!")}>
      <PageHead title="Review" />
      <div className="flex flex-col gap-6">
        <Tabs label="Review sections" idBase="review" value={tab} tabs={TABS} onChange={(v) => go(`review/${v}`, { focus: false })} />
        <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${tab}`}>
          {tab === "due" ? <DueToday /> : tab === "saved" ? <SavedCards /> : <MasteredList />}
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
  sessionSize = DEFAULT_SESSION_SIZE,
  done: Record<string, boolean> = {},
): ReviewCard[] {
  return planSession(queue, { sessionSize, dailyNew, newUsed, done }).cards;
}

/** The plan for the next session from today's pool, ignoring any session that is already locked. */
function usePlan(): SessionPlan {
  const queue = useApp((s) => s.queue);
  const sessionSize = useApp((s) => s.sessionSize);
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const done = useApp((s) => s.review.done);
  return useMemo(() => planSession(queue, { sessionSize, dailyNew, newUsed, done }), [queue, sessionSize, dailyNew, newUsed, done]);
}

function useSessionCards(): ReviewCard[] {
  const sessionCards = useApp((s) => s.review.sessionCards);
  const plan = usePlan();
  return sessionCards ?? plan.cards;
}

function startNextSession() {
  set((s) => {
    const next = planSession(s.queue, { sessionSize: s.sessionSize, dailyNew: s.dailyNew, newUsed: s.newUsed, done: s.review.done });
    return {
      review: { ...s.review, phase: "active", index: 0, completed: 0, removedNew: 0, allowance: next.newCount, sessionCards: next.cards },
    };
  });
  go("review/session");
}

/** Plain-words explanation of which limit decided how many new cards a session gets. */
export function quotaCopy(p: SessionPlan, sessionSize: number, dailyNew: number, newUsed: number): string {
  const fixed = p.learning + p.due;
  if (p.waiting > 0)
    return `Your ${nf.format(fixed + p.waiting)} learning and due review cards are more than a session of ${sessionSize}, so no new cards are added. ${plural(p.waiting, "card")} wait for the next session.`;
  if (p.binding === "session") {
    const unused = p.remainingAllowances - p.newCount;
    const scope = newUsed === 0 ? `today’s ${dailyNew} allowances` : `your ${p.remainingAllowances} remaining allowances`;
    return `${plural(p.newCount, "new card")} this session. ${unused} of ${scope} ${unused === 1 ? "isn’t" : "aren’t"} used because your session holds ${sessionSize} cards and ${fixed} go to learning and due reviews. Raise Cards per review session in Settings to fit more.`;
  }
  if (p.binding === "daily") {
    if (p.remainingAllowances === 0) return `No new cards this session — all ${dailyNew} of today’s allowances are used.`;
    return newUsed === 0
      ? `${plural(p.newCount, "new card")} — all of today’s allowance.`
      : `${plural(p.newCount, "new card")} — all of the ${p.remainingAllowances} allowances left today.`;
  }
  if (p.newAvailable === 0) return "No new cards are waiting for today.";
  return `Only ${p.newAvailable} new ${p.newAvailable === 1 ? "card is" : "cards are"} waiting in your library.`;
}

function DueToday() {
  const forced = useApp((s) => s.ss["SCR-REV-01"]);
  const review = useApp((s) => s.review);
  const offline = useApp((s) => s.offline);
  const queue = useApp((s) => s.queue);
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const sessionSize = useApp((s) => s.sessionSize);
  const savedCards = useApp((s) => s.cards.length);
  const sentences = useApp((s) => s.sentences.length);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [libOk, setLibOk] = useState(libraryReady());
  const [n, setN] = useState(0);
  const sample = useApp((s) => Boolean(s.ss[SAMPLE_QUEUE]));
  useEffect(() => {
    if (sample) return setLoad("ok");
    setLoad("loading");
    let live = true;
    loadQueue()
      .then(() => live && setLoad("ok"))
      .catch((e) => {
        if (!live) return;
        setLoadError(errText(e));
        setLoad("error");
      });
    // The library totals below are secondary; the session works without them.
    loadLibrary()
      .then(() => live && setLibOk(true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [n, sample]);

  const emptyState = queue.length === 0 && review.phase !== "active" && review.phase !== "complete" ? (libOk && savedCards === 0 ? "nocards" : "nodue") : null;
  const state = forced || (load !== "ok" ? load : offline ? "offline" : review.phase === "complete" ? "complete" : (emptyState ?? "active"));
  // Once a session starts, its card list is frozen so returning to Due today or changing dailyNew mid-session
  // does not alter the session's card count or progress.
  const activeCards = useSessionCards();
  const learning = activeCards.filter((c) => c.group === "learning").length;
  const due = activeCards.filter((c) => c.group === "due").length;
  const newAssigned = activeCards.filter((c) => c.group === "new").length;
  const total = activeCards.length;
  const plan = usePlan();
  const locked = review.phase === "active" && review.sessionCards !== null;
  // A locked session keeps its cards; the quota line then describes the lock instead of re-planning it.
  const quotaLine = locked
    ? `This session is locked at ${total} cards. Changing Cards per review session or the daily limit applies from your next session; lowering the daily limit only stops new cards that haven’t been shown yet.`
    : plan.cards.length
      ? `${review.phase === "complete" ? "Next session: " : ""}${quotaCopy(plan, sessionSize, dailyNew, newUsed)}`
      : null;

  const start = () => {
    set((s) => {
      const frozen = s.review.sessionCards ?? planSession(s.queue, { sessionSize: s.sessionSize, dailyNew: s.dailyNew, newUsed: s.newUsed, done: s.review.done }).cards;
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
    <div className="flex flex-col gap-8">
      {state === "loading" && (
        <div className="flex flex-col gap-3">
          <Spinner label="Loading today’s cards…" />
          <Skeleton lines={3} />
        </div>
      )}
      {state === "error" && (
        <Banner tone="error" title="Today’s cards didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setN(n + 1)}>Retry</Button>}>
          Your cards and progress are safe. {loadError || "The server didn’t respond."}
        </Banner>
      )}
      {state === "nocards" && (
        <Banner tone="neutral" title="You haven’t saved any cards yet" actions={<Button kind="primary" onClick={() => go("study")}>Go to Study</Button>}>
          In Study, choose “Add to review” on a sentence to save its cards here.
        </Banner>
      )}
      {state === "nodue" && (
        <Banner tone="neutral" title="No cards are due right now">
          {libOk ? `Your library has ${plural(savedCards, "saved card")}, but none` : "None of your cards"} are due today and no new cards are assigned. Come back tomorrow, or practise with Recall or Dictation.
        </Banner>
      )}
      {state === "complete" && (
        <Banner
          tone="success"
          title={plan.cards.length ? "This session is complete" : "Today’s review is complete"}
          actions={
            <>
              {plan.cards.length > 0 && <Button kind="primary" onClick={startNextSession}>Start another session ({plan.cards.length} cards)</Button>}
              <Button kind="secondary" onClick={() => go("review/saved")}>Open saved cards</Button>
            </>
          }
        >
          {nf.format(review.completed)} of {nf.format(total)} cards in this session completed.{" "}
          {plan.cards.length ? "Due cards or new-card allowances remain today." : "Tomorrow’s cards will appear here."}
        </Banner>
      )}
      {state === "offline" && (
        <Banner tone="warning" title="You’re offline (simulated)">
          You can continue the 12 cards already assigned to this device. New cards need a connection before they can be assigned.
        </Banner>
      )}

      {(state === "active" || state === "offline") && (
        <section className="flex flex-col gap-6" aria-labelledby="today-h">
          <div className="flex flex-col gap-2">
            <h2 id="today-h" className="text-xs font-medium text-muted-foreground">Today’s session</h2>
            <p className="text-lg font-semibold tabular-nums">{nf.format(state === "offline" ? 12 : total)}</p>
            <p className="text-sm text-muted-foreground">cards</p>
            <dl className="flex flex-wrap gap-6">
              {state === "offline" ? (
                <>
                  <div><dt>Learning</dt><dd>8</dd></div>
                  <div><dt>Due</dt><dd>1</dd></div>
                  <div><dt>New</dt><dd>3</dd></div>
                </>
              ) : (
                <>
                  <div><dt>Learning</dt><dd>{learning}</dd></div>
                  <div><dt>Due</dt><dd>{due}</dd></div>
                  <div><dt>New</dt><dd>{newAssigned}</dd></div>
                </>
              )}
            </dl>

            {state !== "offline" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Cards per review session: <span className="tabular-nums">{sessionSize}</span></span>
                <Button kind="tertiary" className="h-8 px-2 text-sm" aria-label="Change cards per review session in Settings" onClick={() => go("settings")}>Change</Button>
              </div>
            )}
            {locked && review.removedNew > 0 && (
              <p className="text-sm text-muted-foreground" role="status">{plural(review.removedNew, "new card")} removed because you lowered today’s limit.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Session progress</span>
              <span className="text-sm text-muted-foreground tabular-nums">{review.completed} of {state === "offline" ? 12 : total} cards completed</span>
            </div>
            <Progress value={(review.completed / Math.max(1, total)) * 100} aria-label="Session progress" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button kind="primary" onClick={start} disabledReason={total === 0 ? "No cards are assigned today." : undefined}>
              {review.phase === "active" ? "Continue review" : "Start review"}
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Daily new-card limit</dt><dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{dailyNew} cards</dd></div>
            <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">New cards introduced today</dt><dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{newUsed}</dd></div>
            <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Your whole library</dt><dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{libOk ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span>{nf.format(sentences)} sentences</span><span>{nf.format(savedCards)} cards</span></span> : "…"}</dd></div>
          </dl>
          <span className="sr-only">Queue pool: {queue.length} cards</span>
        </section>
      )}

      {state !== "loading" && state !== "error" && <QuotaExplainer quotaLine={quotaLine} />}
    </div>
  );
}

function QuotaExplainer({ quotaLine }: { quotaLine: string | null }) {
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const offline = useApp((s) => s.offline);
  const queue = useApp((s) => s.queue);
  const introduced = useApp((s) => s.review.introduced);
  const done = useApp((s) => s.review.done);

  const remaining = Math.max(0, dailyNew - newUsed);
  // The server already put today's new cards in introduction order.
  const nextNew = queue.find((c) => c.group === "new" && !introduced[c.id] && !done[c.id]);

  return (
    <Collapsible className="flex flex-col gap-3 border-t pt-4">
      <CollapsibleTrigger id="quota-h" className="flex min-h-11 w-full items-center text-left text-sm font-medium">How new cards are introduced</CollapsibleTrigger>
      <CollapsibleContent forceMount className="flex flex-col gap-4 data-[state=closed]:hidden">
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
        <li>Only a new card’s first appearance in Review uses one of today’s allowances.</li>
        <li>Saving cards, due reviews, Recall, Dictation, marking mastered and Undo don’t use or refund an allowance.</li>
        <li>New cards are introduced by importance first, then in the order you saved them.</li>
        <li>A sentence brings at most one card a day; its other cards follow on later days.</li>
      </ul>
      <div className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2" aria-live="polite">
        <p className="font-medium">Today: {remaining} of {dailyNew} new-card allowances remain</p>
        {quotaLine && <p className="text-sm text-muted-foreground">{quotaLine}</p>}
        {dailyNew < newUsed ? (
          <p>
            You’ve already introduced {newUsed} new cards today. Your limit is now {dailyNew}, which is lower, so those {newUsed} cards stay in your reviews and no more new cards are introduced today.
          </p>
        ) : remaining === 0 ? (
          <p>No more new cards today. Due reviews continue as usual.</p>
        ) : nextNew ? (
          <p>
            Next new card: {nextNew.kind} · <span lang="fr">{nextNew.kind === "Fill-in" ? nextNew.target : nextNew.sentenceFr}</span>
          </p>
        ) : null}
        {offline && (
          <p className="flex flex-wrap items-center gap-2" style={{ color: "var(--warning)" }}>
            <CloudOff aria-hidden width={16} height={16} /> New allowances need a connection to be assigned. Cards already on this device can continue.
          </p>
        )}
      </div>
      <DailyLimitField compact />
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ---------------- SCR-REV-02 ---------------- */

function ReviewSession() {
  const review = useApp((s) => s.review);
  const ui = useApp((s) => s.reviewUi);
  const cards = useSessionCards();
  const plan = usePlan();
  const forced = useApp((s) => s.ss["SCR-REV-02"]);
  const noAllowance = useApp((s) => s.newUsed >= s.dailyNew);
  const narrow = useNarrow();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const card: ReviewCard | undefined = cards[review.index];
  // A learn-ahead re-queue can return the very same id; keying on index:id re-runs the per-show effects.
  const cardPos = `${review.index}:${card?.id}`;
  const [pick, setPick] = useState<{ text: string; anchor: HTMLElement; wordIndex?: number; occurrence: number } | null>(null);

  // Freeze sessionCards on mount if not already frozen.
  useEffect(() => {
    if (!get().review.sessionCards) set((s) => ({ review: { ...s.review, sessionCards: cards } }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // First introduction of a new card uses exactly one allowance; with none left the card is removed instead of shown.
  useEffect(() => {
    if (!card || card.group !== "new" || get().review.introduced[card.id]) return;
    introduceNewCard(card.id);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [cardPos]);

  useEffect(() => { if (review.phase === "complete") loadQueue().catch(() => undefined); }, [review.phase]);

  // Listen / Recognize cards read the target aloud as soon as they are shown. Before the reveal a
  // typed or Speak front never speaks the answer.
  useEffect(() => {
    if (!card) return;
    const m = card.mode ?? "listen";
    if (m === "listen" || m === "recognize") sayFrench(m === "recognize" ? card.target : card.sentenceFr);
  }, [cardPos]); // eslint-disable-line react-hooks/exhaustive-deps

  const curId = card?.id ?? "";
  const u: ReviewUI = (card ? ui[curId] : undefined) ?? { draft: "", phase: "answering", hint: false, revealed: false };
  const patch = (p: Partial<ReviewUI>) => set((s) => ({ reviewUi: { ...s.reviewUi, [curId]: { ...(s.reviewUi[curId] ?? u), ...p } } }));

  const mode: ReviewMode = card?.mode ?? (card?.kind === "Speak" ? "speak" : card?.kind === "Listen" ? "listen" : "cloze");
  const meta = card?.meta ?? {};
  const intervals = card?.intervals ?? {};
  const translationZh = card?.translationZh ?? "";
  const translationEn = card?.translationEn || (mode === "speak" ? card?.prompt ?? "" : "");
  const grammar = card?.grammar ?? [];
  const sentenceFr = card?.sentenceFr ?? "";
  const revealed = u.revealed || Boolean(u.result) || u.phase === "graded" || u.phase === "techfail";
  const typed = mode !== "recognize" && (mode === "cloze" || mode === "grammar" || card?.kind === "Recall");
  const isWordCard = mode === "cloze" || mode === "recognize" || mode === "grammar";
  const markTarget = isWordCard ? card?.target ?? "" : "";
  const suggested: number | undefined = u.suggested ?? (u.result ? (u.result.correct ? (u.hinted || u.hint ? 2 : 3) : 1) : undefined);
  const groupLabel = card?.group === "new" ? "New card" : card?.group === "due" ? "Due review" : "Learning";

  const reveal = (extra: Partial<ReviewUI> = {}) => {
    if (!card || revealed) return;
    patch({ revealed: true, ...extra });
    if (mode === "speak" || mode === "cloze" || mode === "grammar") sayFrench(cardSpeech(card));
  };

  const check = () => {
    if (!card || revealed || u.rateBusy) return;
    if (!u.draft.trim()) {
      patch({ emptyError: true });
      announce("Type an answer before checking. Nothing was recorded.", true);
      return;
    }
    const result = grade(card.target, u.draft);
    const hintUsed = Boolean(u.hinted || u.hint);
    const sugg: 1 | 2 | 3 = !result.correct ? 1 : hintUsed ? 2 : 3;
    gradeFeedback(result.correct);
    patch({ revealed: true, result, suggested: sugg, answer: u.draft, emptyError: false });
    if (mode === "speak" || mode === "cloze" || mode === "grammar") sayFrench(cardSpeech(card));
    announce(result.correct ? "Correct. Pick how well you remembered." : "Not quite. Pick how well you remembered.");
  };

  const next = (extra?: ReviewCard) => {
    if (!card) return;
    set((s) => {
      const done = { ...s.review.done, [card.id]: true };
      const sessionCards = extra ? [...(s.review.sessionCards ?? cards), extra] : (s.review.sessionCards ?? cards);
      const last = review.index >= sessionCards.length - 1;
      const reviewUi = extra ? { ...s.reviewUi, [extra.id]: { draft: "", phase: "answering" as const, hint: false, revealed: false } } : s.reviewUi;
      return {
        review: last
          ? { ...s.review, done, phase: "complete", completed: s.review.completed + 1, sessionCards }
          : { ...s.review, done, index: s.review.index + 1, completed: s.review.completed + 1, sessionCards },
        reviewUi,
      };
    });
    requestAnimationFrame(() => document.getElementById("rev-q")?.focus());
  };

  const rate = (rating: 1 | 2 | 3 | 4) => {
    if (!card || !revealed || u.rateBusy || u.rated) return;
    if (!typed) gradeFeedback(rating > 1);
    patch({ rateBusy: true, techfail: false });
    rateCard(card.id, rating, { answer: u.answer, durationMs: Date.now() - shownAt.current })
      .then((saved) => {
        patch({ rateBusy: false, rated: true, nextDue: saved.due });
        announce(`Rated ${RATINGS.find((r) => r.value === rating)?.label}.`);
        // A short learning step comes back into this session, like the old LEARN_AHEAD rule.
        const ahead = (saved.state === "learning" || saved.state === "relearning") && Date.parse(saved.due) - Date.now() <= LEARN_AHEAD_MS;
        next(ahead ? serverToReviewCard(saved) : undefined);
      })
      .catch(() => {
        patch({ rateBusy: false, techfail: true });
        announce("Saving your rating failed. This is not a wrong answer; try again.", true);
      });
  };

  const replay = () => {
    if (!card) return;
    if (revealed) return sayFrench(cardSpeech(card));
    // Before the reveal, audio exists only for listen and recognize cards; never speak the answer.
    if (mode === "listen") sayFrench(sentenceFr);
    else if (mode === "recognize") sayFrench(card.target);
  };

  // Keyboard shortcuts. A single listener reads a ref so the latest handlers are always used.
  const keys = useRef<{
    reveal: () => void; check: () => void; rate: (r: number) => void; replay: () => void;
    revealed: boolean; suggested: number | undefined; active: boolean;
  }>({ reveal: () => {}, check: () => {}, rate: () => {}, replay: () => {}, revealed: false, suggested: undefined, active: false });
  keys.current = {
    reveal: () => reveal(), check, rate: (r: number) => rate(r as 1 | 2 | 3 | 4), replay,
    revealed, suggested, active: Boolean(card) && review.phase !== "complete" && forced !== "complete",
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !keys.current.active) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[role=dialog]")) return;
      if (e.key === "Enter" && t?.id === "rev-input") { e.preventDefault(); keys.current.check(); return; }
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const onControl = tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
      if (!keys.current.revealed) {
        if (e.code === "Space" || e.key === "Enter") {
          if (onControl) return;
          e.preventDefault();
          keys.current.reveal();
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          keys.current.replay();
        }
        return;
      }
      if (["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); keys.current.rate(Number(e.key)); return; }
      if (e.key === "Enter" && !e.shiftKey) { if (onControl) return; e.preventDefault(); keys.current.rate(keys.current.suggested ?? 3); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); keys.current.replay(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onWordPick = (p: FrPick) => {
    setPick({ text: p.text, anchor: p.anchor, wordIndex: p.wordIndex, occurrence: p.occurrence });
  };

  // A new card without an allowance is never shown; the effect above removes it from the locked session.
  if (card && card.group === "new" && !review.introduced[card.id] && noAllowance && review.phase === "active") return null;

  if (review.phase === "complete" || forced === "complete" || !card) {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="success" title="Review complete" live="polite">
          {review.completed} of {cards.length} cards in this session completed. Each review updated that card’s schedule.
        </Banner>
        {review.removedNew > 0 && <p className="text-sm text-muted-foreground">{plural(review.removedNew, "new card")} removed because you lowered today’s limit.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {plan.cards.length > 0 && <Button kind="primary" onClick={startNextSession}>Start another session ({plan.cards.length} cards)</Button>}
          <Button kind={plan.cards.length ? "secondary" : "primary"} onClick={() => go("review")}>Done — back to Due today</Button>
          <Button kind="secondary" onClick={() => go("review/saved")}>Open saved cards</Button>
        </div>
      </div>
    );
  }

  const wpSentence: StudySentence = {
    id: card.sentenceId,
    fr: sentenceFr,
    en: translationEn,
    segments: [],
    steps: [],
    grammar: grammar.length ? grammar.map((g) => ({ title: g.title ?? "", body: g.explanation ?? g.body ?? "", example: g.example ?? "", exampleEn: "" })) : null,
    cards: [],
    raw: { sentence: sentenceFr, translation_en: translationEn, translation_zh: translationZh, build_up: [], words: [], grammar_points: [] },
  };
  const backSegments = markedSegments(sentenceFr, markTarget);
  const friendlyIpa = formatFriendlyPhonetic(meta.ipa || "");
  const metaBits = [meta.pos, meta.lemma && meta.lemma.toLowerCase() !== card.target.toLowerCase() ? `base form ${meta.lemma}` : "", friendlyIpa].filter(Boolean);
  const englishGloss = (value?: string) => {
    const text = (value || "").trim();
    if (!text || /\p{Script=Han}/u.test(text)) return "";
    return text;
  };
  const dictLine = englishGloss(meta.dict_en) || (!meta.snap ? englishGloss(meta.meaning_en) : "");
  const hereLine = englishGloss(meta.ctx_en);
  const showEnglish = Boolean(translationZh && translationEn);

  const intervalText = (value: number) => {
    const provided = intervals[String(value)];
    const blank = Object.keys(intervals).length === 0;
    const secs = provided == null ? (blank ? FALLBACK_INTERVALS[value] : undefined) : provided;
    return secs == null ? "" : formatInterval(secs);
  };

  return (
    <div className={cx("grid items-start gap-6", pick && !narrow && "lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]")}>
      <div className="flex flex-col gap-6" data-mode={mode} data-card-id={card.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="rev-q" tabIndex={-1} className="text-xs leading-4 text-muted-foreground tabular-nums">Card {review.index + 1} of {cards.length}</p>
          <span className="text-sm text-muted-foreground tabular-nums">{review.completed} completed</span>
        </div>
        {review.removedNew > 0 && <p className="text-sm text-muted-foreground" role="status">{plural(review.removedNew, "new card")} removed because you lowered today’s limit.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={card.group === "new" ? "info" : undefined}>{groupLabel}</Pill>
          <Pill>{MODE_LABEL[mode]}</Pill>
          {card.group === "new" && <span className="text-sm text-muted-foreground">First introduction. Uses 1 of today’s new-card allowances.</span>}
        </div>
        <hr className="border-t" />

        {!revealed ? (
          <div className="flex flex-col gap-4">
            {/* ---------------- FRONT, per mode ---------------- */}
            {mode === "listen" && (
              <div className="rev-listen flex flex-col gap-3">
                <p className="rev-lead">Listen, then say what it means.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button kind="secondary" className="" iconOnly icon={<Play aria-hidden />} aria-label="Play the sentence" onClick={() => sayFrench(sentenceFr)} />
                  <Button kind="secondary" icon={<Volume2 aria-hidden />} onClick={() => sayFrench(sentenceFr, 0.75)}>Slow 0.75&nbsp;×</Button>
                </div>
              </div>
            )}
            {mode === "speak" && (
              <div className="flex flex-col gap-3">
                <p className="rev-lead">Say this in French out loud.</p>
                <p className="rev-prompt-zh" lang={translationZh ? "zh" : undefined}>{translationZh || translationEn || "No translation yet."}</p>
                {showEnglish && <Disclosure summary="Show English"><p className="text-sm text-muted-foreground">{translationEn}</p></Disclosure>}
                <Disclosure summary="Show initials"><p className="rev-initials" lang="fr">{initialsHint(sentenceFr)}</p></Disclosure>
              </div>
            )}
            {mode === "recognize" && (
              <div className="flex flex-col gap-3">
                <FrText segments={tokenizeFrench(card.target)} className="font-serif text-2xl leading-snug wrap-break-word" onPick={onWordPick} />
                <p className="rev-lead">What does it mean?</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button kind="secondary" className="" iconOnly icon={<Play aria-hidden />} aria-label="Play the word" onClick={() => sayFrench(card.target)} />
                  <Button kind="secondary" icon={<Volume2 aria-hidden />} onClick={() => sayFrench(card.target, 0.75)}>Slow 0.75&nbsp;×</Button>
                </div>
              </div>
            )}
            {typed && (
              <div className="flex flex-col gap-3">
                {mode === "grammar" && meta.rule && <Pill>{meta.rule}</Pill>}
                {card.kind === "Recall" ? (
                  <p className="text-lg font-medium">{card.prompt}</p>
                ) : (
                  <FrText segments={tokenizeFrench(mode === "grammar" ? (meta.prompt_fr || card.prompt) : card.prompt)} className="font-serif text-2xl leading-snug wrap-break-word" onPick={onWordPick} />
                )}
                {(mode === "grammar" ? meta.full_en : (translationZh || translationEn)) && (
                  <p className="text-sm text-muted-foreground" lang={translationZh && mode !== "grammar" ? "zh" : undefined}>
                    {mode === "grammar" ? meta.full_en : (translationZh || translationEn)}
                  </p>
                )}
                {card.kind === "Fill-in" && (meta.meaning_zh || meta.meaning_en) && <p className="text-sm text-muted-foreground">Blank means: {meta.meaning_zh || meta.meaning_en}</p>}
                {mode === "grammar" && meta.hint && <p className="text-sm text-muted-foreground">Hint: {meta.hint}</p>}
                <Disclosure summary="Show initials"><p className="rev-initials" lang="fr">{initialsHint(card.target)}</p></Disclosure>
              </div>
            )}

            {typed && (
              <div className="flex flex-col gap-3">
                <div className="grid gap-2">
                  <label htmlFor="rev-input" className="text-sm font-medium">Your answer in French</label>
                  <Textarea
                    id="rev-input"
                    name="review-answer"
                    autoComplete="off"
                    ref={inputRef}
                    className="min-h-24"
                    lang="fr"
                    rows={2}
                    value={u.draft}
                    readOnly={u.rateBusy}
                    aria-invalid={u.emptyError || undefined}
                    aria-describedby={u.emptyError ? "rev-err" : undefined}
                    onChange={(e) => patch({ draft: e.target.value, emptyError: false })}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); check(); } }}
                    spellCheck={false}
                  />
                  {u.emptyError && <p id="rev-err" className="text-sm text-destructive" role="alert">Type an answer before checking. Nothing was recorded.</p>}
                </div>
              </div>
            )}
            <div className="sticky bottom-0 z-10 bg-background py-3">
              <div className="flex flex-wrap items-center gap-2">
                {typed && <Button kind="primary" onClick={check}>Check</Button>}
                <Button kind={typed ? "secondary" : "primary"} icon={<Eye aria-hidden />} onClick={() => reveal()}>Show answer</Button>
              </div>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground"><span><kbd>Space</kbd> shows the answer</span><span><kbd>R</kbd> replays</span></p>
          </div>
        ) : (
          <>
            {/* ---------------- BACK, after Show answer or Check ---------------- */}
            <div id="rev-result" tabIndex={-1} className="flex flex-col gap-4">
              <div className="rev-answer-row" data-sentence={sentenceFr}>
                <FrText segments={backSegments} className={isWordCard ? "t-fr-lg" : "sentence-fr"} onPick={onWordPick} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button kind="secondary" icon={<Play aria-hidden />} onClick={() => sayFrench(cardSpeech(card))}>Play</Button>
                  <Button kind="secondary" icon={<Volume2 aria-hidden />} onClick={() => sayFrench(cardSpeech(card), 0.75)}>Slow 0.75&nbsp;×</Button>
                </div>
              </div>
              {(translationZh || translationEn) && (
                <div className="rev-translations">
                  {translationZh && <p className="text-sm text-muted-foreground" lang="zh">{translationZh}</p>}
                  {translationEn && <p className="text-sm text-muted-foreground">{translationEn}</p>}
                </div>
              )}
              {u.result && (
                <div className="flex flex-col gap-4">
                  <MarkedLine label="Your answer" words={u.result.answer} side="answer" />
                  <MarkedLine label="Correct answer" words={u.result.target} side="target" onPick={onWordPick} />
                </div>
              )}
              {isWordCard && (
                <div className="rev-meta">
                  <p className="font-medium" lang="fr">{card.target}</p>
                  {metaBits.length > 0 && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {metaBits.map((bit) => <span className="inline-flex items-baseline gap-1.5 text-sm" key={bit}>{bit}</span>)}
                    </p>
                  )}
                </div>
              )}
              {(dictLine || (hereLine && hereLine !== dictLine) || meta.hook) && (
                <div className="rev-snapshot flex flex-col gap-1">
                  {dictLine && <p className="text-base"><span className="text-sm font-medium text-muted-foreground">Saved meaning: </span>{dictLine}</p>}
                  {hereLine && hereLine !== dictLine && <p className="text-sm text-muted-foreground"><span className="text-sm font-medium text-muted-foreground">In this sentence: </span>{hereLine}</p>}
                  {meta.hook && <p className="text-sm text-muted-foreground">Memory hook: {meta.hook}</p>}
                </div>
              )}
              {grammar.length > 0 && (
                <Disclosure summary={`Grammar notes (${grammar.length})`}>
                  <ul className="flex flex-col gap-2">
                    {grammar.map((g, i) => (
                      <li key={i} className="flex flex-col gap-1">
                        {g.title && <p className="font-medium">{g.title}</p>}
                        {(g.explanation || g.body) && <p className="text-sm text-muted-foreground">{g.explanation || g.body}</p>}
                        {g.hook && <p className="text-xs leading-4 text-muted-foreground">Memory hook: {g.hook}</p>}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </div>

            {u.techfail && (
              <Banner tone="error" title="Saving your rating failed" live="assertive" actions={<Button kind="secondary" onClick={() => rate((suggested ?? 3) as 1 | 2 | 3 | 4)}>Retry</Button>}>
                This is not a wrong answer. Your answer is kept and nothing was recorded.
              </Banner>
            )}
            <div className="rev-actionbar">
            <div className="rev-ratings" role="group" aria-label="How well did you remember?">
              {RATINGS.map((r) => {
                const text = intervalText(r.value);
                return (
                  <Button
                    key={r.value}
                    kind="secondary"
                    className={cx("rev-rate h-auto flex-col gap-0 px-3 py-2", suggested === r.value && "rev-rate--suggested")}
                    data-rating={r.value}
                    disabled={u.rateBusy || u.rated}
                    onClick={() => rate(r.value)}
                  >
                    <span className="rev-rate-name">{r.label}</span>
                    <span className="rev-rate-interval tabular-nums">{text}</span>
                    <kbd className="text-xs text-muted-foreground">{r.value}</kbd>
                  </Button>
                );
              })}
            </div>
            {u.rateBusy && <Spinner label="Saving your rating…" />}
            <div className="flex flex-wrap items-center gap-2">
              <Button kind="secondary" icon={<Archive aria-hidden />} onClick={() => { masterCard(card.id); next(); }}>Mark mastered</Button>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground"><span><kbd>1</kbd>–<kbd>4</kbd> rates</span><span><kbd>Enter</kbd> takes the suggestion</span>{u.nextDue ? <span>Next review {dueIn(u.nextDue)}</span> : null}</p>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button kind="tertiary" className="h-8 px-2 text-sm" onClick={() => go("review")}>Pause and return to Due today</Button>
        </div>
      </div>

      {pick && !narrow && (
        <WordDock label={`Meaning of ${pick.text}`} onClose={() => setPick(null)}>
          <WordPanel key={`${pick.text}-${pick.wordIndex ?? ""}`} sentence={wpSentence} text={pick.text} wordIndex={pick.wordIndex} occurrence={pick.occurrence} onGrammar={() => setPick(null)} onClose={() => setPick(null)} />
        </WordDock>
      )}
      {pick && narrow && (
        <Dialog sheet titleHidden title={`Meaning of “${pick.text}”`} onClose={() => setPick(null)}>
          <WordPanel key={`${pick.text}-${pick.wordIndex ?? ""}`} sentence={wpSentence} text={pick.text} wordIndex={pick.wordIndex} occurrence={pick.occurrence} onGrammar={() => setPick(null)} onClose={() => setPick(null)} inSheet />
        </Dialog>
      )}
    </div>
  );
}

/* ---------------- SCR-LIB-01 / SCR-LIB-02 ---------------- */

const STATUS_LABEL: Record<LibCard["status"], string> = { new: "New", learning: "Learning", review: "In review" };

function SavedCards() {
  const sentences = useApp((s) => s.sentences);
  const cards = useApp((s) => s.cards);
  const lookups = useApp((s) => s.lookups);
  const favorites = useApp((s) => s.favorites);
  const f = useApp((s) => s.libFilters);
  const forced = useApp((s) => s.ss["SCR-LIB-01"]);
  const lib = useLibrary();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [savedSort, setSavedSort] = useState<{ key: "saved" | "due" | "importance"; dir: "asc" | "desc" }>({ key: "saved", dir: "desc" });
  const [page, setPage] = useState(0);
  const narrow = useNarrow();
  const setF = (p: Partial<typeof f>) => set((s) => ({ libFilters: { ...s.libFilters, ...p } }));

  const q = f.q.trim().toLowerCase();
  const savedTotal = cards.length;
  const matchCard = (c: LibCard) => {
    const wordLookups = getCardLookups({ lookups }, c);
    const fav = Boolean(favorites[favoriteKey(c)]);
    return (
      (f.mastered === "hide" ? !c.mastered : f.mastered === "only" ? c.mastered : true) &&
      (!f.minImportance || (wordLookups !== null && importanceFor(wordLookups) >= f.minImportance)) &&
      (!f.favoritesOnly || fav)
    );
  };
  const savedRows = useMemo(() => {
    const byS = new Map<string, LibSentence>(sentences.map((s) => [s.id, s]));
    const dir = savedSort.dir === "asc" ? 1 : -1;
    const value = (c: LibCard) => {
      if (savedSort.key === "saved") return c.savedAt;
      if (savedSort.key === "due") return Date.parse(c.due ?? "") || 0;
      return wordCardImportance(c, lookups);
    };
    return cards
      .filter(matchCard)
      .map((c) => ({ c, s: byS.get(c.sentenceId) }))
      .filter(({ c, s }) => !q || s?.fr.toLowerCase().includes(q) || s?.en.toLowerCase().includes(q) || c.word?.toLowerCase().includes(q))
      .sort((a, b) => dir * (value(a.c) - value(b.c)) || b.c.savedAt - a.c.savedAt);
  }, [cards, sentences, lookups, favorites, f, q, savedSort]); // eslint-disable-line react-hooks/exhaustive-deps
  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(savedRows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageRows = savedRows.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE);
  const rowFrom = savedRows.length ? curPage * PAGE_SIZE + 1 : 0;
  const rowTo = Math.min(savedRows.length, (curPage + 1) * PAGE_SIZE);
  const toggleSort = (key: "saved" | "due" | "importance") =>
    setSavedSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const ariaSort = (key: "saved" | "due" | "importance"): "ascending" | "descending" | "none" =>
    savedSort.key !== key ? "none" : savedSort.dir === "asc" ? "ascending" : "descending";
  const sortMark = (key: "saved" | "due" | "importance") => (savedSort.key !== key ? "↕" : savedSort.dir === "asc" ? "↑" : "↓");
  useEffect(() => setPage(0), [q, f.mastered, f.minImportance, f.favoritesOnly, savedSort.key, savedSort.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const matchingCards = savedRows.length;
  const matchingSentences = new Set(savedRows.map(({ c }) => c.sentenceId)).size;
  const sortHeader = (key: "saved" | "due" | "importance", label: string, hide = false) => (
    <th scope="col" className={hide ? "saved-col-hide" : undefined} aria-sort={ariaSort(key)}>
      <Button kind="tertiary" className="h-8 px-2 font-medium" onClick={() => toggleSort(key)}>
        {label} <span aria-hidden className="text-muted-foreground">{sortMark(key)}</span>
      </Button>
    </th>
  );
  const forcedBulk = useApp((s) => s.ss["SCR-LIB-02"]);
  useEffect(() => {
    if (forcedBulk !== "bulk") return;
    setSelecting(true);
    setSel(Object.fromEntries(cards.filter((c) => c.saved && !c.mastered).slice(0, 200).map((c) => [c.id, true])));
  }, [forcedBulk]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const selSentences = new Set(cards.filter((c) => sel[c.id]).map((c) => c.sentenceId)).size;

  const savedColumns = useMemo<LegacyColumnDef<{ c: LibCard; s?: LibSentence }>[]>(
    () => [{ id: "french", accessorFn: (row) => row.c.word || row.s?.fr || "", header: "French" }],
    [],
  );
  const savedTable = useLegacyTable({ data: pageRows, columns: savedColumns, getCoreRowModel: getCoreRowModel() });

  if (forced === "loading" || lib.state === "loading")
    return (
      <div className="flex flex-col gap-3">
        <Spinner label="Loading your library…" />
        <Skeleton lines={5} />
      </div>
    );
  if (lib.state === "error")
    return (
      <Banner tone="error" title="Your library didn’t load" live="assertive" actions={<Button kind="secondary" onClick={lib.retry}>Retry</Button>}>
        Your cards are safe. {lib.error || "The server didn’t respond."}
      </Banner>
    );

  const startBulk = () => {
    const chosen = cards.filter((c) => sel[c.id]);
    const sids = Array.from(new Set(chosen.map((c) => c.sentenceId)));
    const items = sids.map((id, i) => {
      const s = sentences.find((x) => x.id === id)!;
      return { id: s.id, fr: s.fr, en: s.en, label: `Selected sentence ${i + 1}`, steps: [{ fr: s.fr, en: s.en }] };
    });
    const key = `run:Recall:bulk:${Date.now()}`;
    runItems.set(key, { kind: "Recall", source: `Selected cards · ${plural(items.length, "sentence")}`, items });
    set(() => ({ activeRun: key }));
    go("study/run");
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs leading-4 text-muted-foreground">Saved cards come back in Review. Favorite is only a bookmark.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ flex: "1 1 220px" }}>
          <FieldText label="Search" name="saved-search" type="search" inputMode="search" value={f.q} onChange={(v) => setF({ q: v })} placeholder="e.g. j’ai failli…" lang="fr" />
        </div>
        <label className="grid gap-2" style={{ minWidth: 170 }}>
          <span className="text-sm font-medium">Mastered cards</span>
          <ChoiceSelect
            value={f.mastered}
            onValueChange={(v) => setF({ mastered: v as typeof f.mastered })}
            options={[
              { value: "hide", label: "Hide mastered" },
              { value: "show", label: "Include mastered" },
              { value: "only", label: "Only mastered" },
            ]}
          />
        </label>
        <label className="grid gap-2" style={{ minWidth: 210 }}>
          <span className="text-sm font-medium" title="Applies to Fill-in word cards only">Importance</span>
          <ChoiceSelect
            describedBy="imp-filter-note"
            value={String(f.minImportance)}
            onValueChange={(v) => setF({ minImportance: Number(v) as typeof f.minImportance })}
            options={[
              { value: "0", label: "Any" },
              { value: "3", label: "3 or more" },
              { value: "4", label: "4 or more" },
              { value: "5", label: "5 only" },
            ]}
          />
          <span id="imp-filter-note" className="sr-only">Applies to Fill-in word cards only</span>
        </label>
        <label className="flex items-center gap-3 py-2"><Checkbox checked={f.favoritesOnly} onCheckedChange={(v) => setF({ favoritesOnly: v === true })} /> Favorites only</label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
          <span>Showing {plural(matchingSentences, "sentence")}</span>
          <span>{plural(matchingCards, "card")}</span>
          {(q || f.mastered !== "hide" || f.minImportance || f.favoritesOnly) ? <span>of {nf.format(savedTotal)} saved cards</span> : null}
        </p>
        {!selecting ? (
          <Button kind="secondary" onClick={() => setSelecting(true)} disabledReason={!matchingCards ? "No cards to select." : undefined}>Select cards to practise</Button>
        ) : (
          <Button kind="tertiary" onClick={() => setSel(Object.fromEntries(savedRows.map(({ c }) => c).filter((c) => c.saved).map((c) => [c.id, true])))}>
            Select all {plural(savedRows.map(({ c }) => c).filter((c) => c.saved).length, "matching saved card")}
          </Button>
        )}
      </div>

      {matchingCards === 0 ? (
        <Banner
          tone="neutral"
          title="No cards match these filters"
          actions={<Button kind="secondary" onClick={() => setF({ q: "", savedOnly: false, mastered: "hide", minImportance: 0, favoritesOnly: false })}>Clear filters</Button>}
        >
          Your library still has {nf.format(savedTotal)} saved cards. Try fewer filters or a different search.
        </Banner>
      ) : (
        <>
          {narrow ? (
            <ul className="flex list-none flex-col gap-3">
              {savedTable.getRowModel().rows.map((row) => { const { c, s } = row.original;
                const fav = Boolean(favorites[favoriteKey(c)]);
                const speech = c.word || s?.fr || "";
                const meaning = [c.meaning, s?.en].find((v) => v && !/\p{Script=Han}/u.test(v)) || "—";
                return (
                  <li key={c.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4" data-card-id={c.id}>
                    <p className="saved-card-fr font-serif text-xl leading-snug wrap-break-word" lang="fr">{c.word || s?.fr || ""}</p>
                    <p className="text-sm text-muted-foreground">{meaning}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="text-xs font-medium text-muted-foreground">Due</span><span className="tabular-nums">{compactDue(c.due)}</span><span className="inline-flex items-baseline gap-1.5 text-sm">{c.mastered ? "Mastered" : STATUS_LABEL[c.status]}</span></p>
                    <div className="flex gap-1">
                      <Button kind="tertiary" iconOnly aria-label={`Play ${c.word || "sentence"}`} icon={<Play aria-hidden />} onClick={() => sayFrench(speech)} />
                      <Button kind="tertiary" iconOnly aria-pressed={fav} aria-label={fav ? "Remove favorite" : "Favorite"} icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />} onClick={() => void setFavorite(speech, !fav)} />
                      <Button kind="tertiary" iconOnly aria-label={c.mastered ? "Restore" : "Mark mastered"} icon={<Archive aria-hidden />} onClick={() => (c.mastered ? void restoreMastered(c.id) : masterCard(c.id))} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
          <div className="w-full">
            <Table className="saved-table">
              <colgroup>
                {selecting && <col className="saved-col-hide saved-col-check" />}
                <col className="saved-col-french" />
                <col className="saved-col-hide saved-col-type" />
                <col className="saved-col-hide saved-col-meaning" />
                <col className="saved-col-hide saved-col-status" />
                <col className="saved-col-due" />
                <col className="saved-col-hide saved-col-imp" />
                <col className="saved-col-hide saved-col-saved" />
                <col className="saved-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  {selecting && <th scope="col" className="saved-col-hide"><span className="sr-only">Select</span></th>}
                  <th scope="col">French</th>
                  <th scope="col" className="saved-col-hide">Type</th>
                  <th scope="col" className="saved-col-hide">Meaning</th>
                  <th scope="col" className="saved-col-hide">Status</th>
                  {sortHeader("due", "Due")}
                  {sortHeader("importance", "Importance", true)}
                  {sortHeader("saved", "Saved", true)}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {savedTable.getRowModel().rows.map((row) => { const { c, s } = row.original;
                  const wordLookups = getCardLookups({ lookups }, c);
                  const fav = Boolean(favorites[favoriteKey(c)]);
                  const speech = c.word || s?.fr || "";
                  return (
                    <tr key={c.id} data-card-id={c.id} data-saved={c.savedAt}>
                      {selecting && (
                        <td className="saved-col-hide">
                          {c.saved && <Checkbox aria-label={`Select ${c.kind} card${c.word ? ` for ${c.word}` : ""}`} checked={!!sel[c.id]} onCheckedChange={(v) => setSel({ ...sel, [c.id]: v === true })} />}
                        </td>
                      )}
                      <td className="saved-french font-serif wrap-break-word" title={c.word || s?.fr || ""}>
                        <span className="block wrap-break-word">{c.word ? <strong lang="fr">{c.word}</strong> : <span lang="fr" className="saved-sentence">{s?.fr ?? ""}</span>}</span>
                      </td>
                      <td className="saved-col-hide"><span className="block wrap-break-word">{c.kind}</span></td>
                      <td className="saved-col-hide wrap-break-word" title={[c.meaning, s?.en].find((v) => v && !/\p{Script=Han}/u.test(v)) || ""}><span className="block wrap-break-word">{[c.meaning, s?.en].find((v) => v && !/\p{Script=Han}/u.test(v)) || "—"}</span></td>
                      <td className="saved-col-hide"><span className="block wrap-break-word">{c.mastered ? "Mastered" : STATUS_LABEL[c.status]}</span></td>
                      <td className="tabular-nums"><span className="block wrap-break-word">{compactDue(c.due)}</span></td>
                      <td className="saved-col-hide" data-col="imp"><span className="block wrap-break-word">{wordLookups !== null ? <span className=""><Importance count={wordLookups} /></span> : "—"}</span></td>
                      <td className="saved-col-hide tabular-nums"><span className="block wrap-break-word">{shortSavedDate(c.savedAt)}</span></td>
                      <td className="whitespace-nowrap">
                        <span className="flex gap-1">
                          <Button kind="tertiary" iconOnly aria-label={`Play ${c.word || "sentence"}`} icon={<Play aria-hidden />} onClick={() => sayFrench(speech)} />
                          <Button kind="tertiary" iconOnly aria-pressed={fav} aria-label={fav ? "Remove favorite" : "Favorite"} icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />} onClick={() => void setFavorite(speech, !fav)} />
                          <Button kind="tertiary" iconOnly aria-label={c.mastered ? "Restore" : "Mark mastered"} icon={<Archive aria-hidden />} onClick={() => (c.mastered ? void restoreMastered(c.id) : masterCard(c.id))} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          )}
          <div className="saved-pager mt-3 flex flex-wrap items-center gap-3">
            <Button kind="secondary" icon={<ChevronLeft aria-hidden />} disabledReason={curPage === 0 ? "You are on the first page." : undefined} onClick={() => setPage(curPage - 1)}>Prev</Button>
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">Page {curPage + 1} of {pageCount}</span>
            <Button kind="secondary" iconAfter={<ChevronRight aria-hidden />} disabledReason={curPage >= pageCount - 1 ? "You are on the last page." : undefined} onClick={() => setPage(curPage + 1)}>Next</Button>
            <span className="text-sm text-muted-foreground tabular-nums">Rows {rowFrom}–{rowTo} of {savedRows.length}</span>
          </div>
        </>
      )}
      {selecting && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" role="region" aria-label="Bulk practice">
          <p className="min-w-0 flex-1 font-medium" aria-live="polite">
            Practise {plural(selectedIds.length, "selected card")} from {nf.format(savedTotal)} library cards
            {selectedIds.length ? <span className="text-sm text-muted-foreground"> from {plural(selSentences, "sentence")}</span> : null}
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
  const lib = useLibrary();
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
    restoreMastered(id)
      .then(() => {
        setPending((p) => ({ ...p, [id]: "done" }));
        announce("Card restored to your default review.");
      })
      .catch(() => {
        setPending((p) => ({ ...p, [id]: "error" }));
        announce("Couldn’t restore the card. It’s still in Mastered.", true);
      });
  };
  if (lib.state === "loading" && forced !== "empty")
    return (
      <div className="flex flex-col gap-3">
        <Spinner label="Loading mastered cards…" />
        <Skeleton lines={4} />
      </div>
    );
  if (lib.state === "error" && forced !== "empty")
    return (
      <Banner tone="error" title="Mastered cards didn’t load" live="assertive" actions={<Button kind="secondary" onClick={lib.retry}>Retry</Button>}>
        {lib.error || "The server didn’t respond."}
      </Banner>
    );
  if (!mastered.length)
    return (
      <Banner tone="neutral" title="No mastered cards">
        Cards you mark as mastered are hidden from your default review and listed here. Nothing is ever deleted.
      </Banner>
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Mastered cards are hidden from your default review. Restore one to bring it back. Nothing here is deleted.</p>
      <div style={{ maxWidth: 420 }}>
        <FieldText label="Search mastered cards" type="search" value={q} onChange={setQ} lang="fr" />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">Showing {shown.length} of {plural(mastered.length, "mastered card")}</p>
      {shown.length === 0 ? (
        <Banner tone="neutral" title="No mastered cards match your search" actions={<Button kind="secondary" onClick={() => setQ("")}>Clear search</Button>} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {shown.slice(0, 30).map((c) => {
            const s = sentences.find((x) => x.id === c.sentenceId)!;
            const st = pending[c.id];
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 flex flex-col" style={{ minWidth: 200 }}>
                  <span lang="fr">{s.fr}</span>
                  <span className="text-sm text-muted-foreground">{c.kind} card{c.word ? ` · ${c.word}` : ""}</span>
                </div>
                {st === "done" ? (
                  <Pill tone="success">Restored</Pill>
                ) : st === "error" ? (
                  <>
                    <span className="text-sm text-muted-foreground" style={{ color: "var(--error)" }}>Restore failed</span>
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
      {shown.length > 30 && <p className="flex items-start gap-2 text-sm text-muted-foreground"><Search aria-hidden /> Showing the first 30. Search to find others.</p>}
    </div>
  );
}
