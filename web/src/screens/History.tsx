import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  attemptKind,
  canReopen,
  clearAttempts,
  clearStudyRecords,
  fmtWhen,
  listAttempts,
  listStudyRecords,
  sentenceCount,
  sourceLabel,
  type AttemptRecord,
  type StudyRecord,
} from "../api/history";
import { LANE_LABEL, loadDays, type DayTime, type Lane } from "../api/time";
import { fmtDuration, plural } from "../lib/format";
import { openAnalysisInStudy } from "../state/study";
import { announce, clearAttemptHistory, go, patchStudy, set, useApp } from "../state/store";
import { Banner, Button, Dialog, DisabledReason, PageHead, Pill, Skeleton, Spinner, Tabs } from "../components/ui";

type Tab = "analyses" | "time" | "attempts";
const TABS: Tab[] = ["analyses", "time", "attempts"];

/** Loads one list from the server; `reload` fetches it again. */
function useList<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; data?: T }>({ status: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: "loading", data: s.data }));
    load()
      .then((data) => live && setState({ status: "ok", data }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function HistoryScreen() {
  const route = useApp((s) => s.route);
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const asked = params.get("tab") as Tab;
  const tab: Tab = TABS.includes(asked) ? asked : "analyses";
  return (
    <div className="page">
      <PageHead
        back={<Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go("progress")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Progress</Button>}
        title="History"
        desc="A record of what you’ve done. This isn’t your card library — saved cards live in Review."
      />
      <div className="stack gap-5">
        <Tabs
          label="History type"
          idBase="hist"
          value={tab}
          onChange={(t) => go(`progress/history?tab=${t}`, { focus: false })}
          tabs={[
            { value: "analyses", label: "Study analyses" },
            { value: "time", label: "Study time" },
            { value: "attempts", label: "Recall & Dictation" },
          ]}
        />
        <div id="hist-panel" role="tabpanel" aria-labelledby={`hist-tab-${tab}`} className="stack gap-4">
          {tab === "analyses" ? <Analyses /> : tab === "time" ? <Time /> : <Attempts />}
        </div>
      </div>
    </div>
  );
}

function Loading({ status, what, onRetry }: { status: "loading" | "error"; what: string; onRetry: () => void }) {
  return status === "loading" ? (
    <>
      <Spinner label={`Loading ${what}…`} />
      <Skeleton lines={4} />
    </>
  ) : (
    <Banner tone="error" title={`${what[0].toUpperCase()}${what.slice(1)} didn’t load`} live="assertive" actions={<Button kind="secondary" onClick={onRetry}>Retry</Button>}>
      Your records are safe. Check your connection and try again.
    </Banner>
  );
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="list-btn" onClick={onClick} style={{ minHeight: 56 }}>
      <span className="grow stack gap-1">{children}</span>
      <ChevronRight aria-hidden className="chev" />
    </button>
  );
}

const BackButton = ({ onBack }: { onBack: () => void }) => (
  <Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={onBack} style={{ alignSelf: "flex-start", marginLeft: -12 }}>
    Back to list
  </Button>
);

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text);

/* ---------------- Study analyses ---------------- */

function Analyses() {
  const list = useList(() => listStudyRecords());
  const [src, setSrc] = useState("all");
  const [detail, setDetail] = useState<string | null>(null);
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="analyses" onRetry={list.reload} />;
  const all = list.data ?? [];
  const open = detail ? all.find((r) => r.id === detail) : undefined;
  if (open) return <AnalysisDetail r={open} onBack={() => setDetail(null)} />;
  const shown = all.filter((r) => src === "all" || sourceLabel(r) === src);
  return (
    <>
      <label className="field" style={{ width: 220 }}>
        <span className="field-label">Source</span>
        <select className="select" value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="all">All sources</option>
          <option>Pasted text</option>
          <option>Photo import</option>
          <option>My own idea</option>
        </select>
      </label>
      <p className="t-support" aria-live="polite">
        {plural(all.length, "Study analysis", "Study analyses")}
        {shown.length !== all.length ? ` · Showing ${shown.length}` : ""}
      </p>
      {all.length === 0 ? (
        <Banner tone="neutral" title="No Study analyses yet" actions={<Button kind="secondary" onClick={() => go("study/new")}>Analyse a text</Button>}>
          Texts you analyse in Study appear here.
        </Banner>
      ) : shown.length === 0 ? (
        <Banner tone="neutral" title="No analyses match this filter" actions={<Button kind="secondary" onClick={() => setSrc("all")}>Show all sources</Button>} />
      ) : (
        <ul className="list">
          {shown.map((r) => (
            <li key={r.id}>
              <RowButton onClick={() => setDetail(r.id)}>
                <span lang="fr" className="t-strong">{preview(r.text)}</span>
                <span className="t-support">{fmtWhen(r.created_at)} · {sourceLabel(r)} · {plural(sentenceCount(r), "sentence")}</span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <ClearAction kind="analyses" count={all.length} onCleared={list.reload} />
    </>
  );
}

function AnalysisDetail({ r, onBack }: { r: StudyRecord; onBack: () => void }) {
  const study = useApp((s) => s.study);
  const isOpen = study.analysis.status === "done" && study.analysis.input === r.text;
  const n = sentenceCount(r);
  return (
    <div className="stack gap-4">
      <BackButton onBack={onBack} />
      <h2 className="t-section" tabIndex={-1} data-autofocus>Study analysis · {fmtWhen(r.created_at)}</h2>
      <dl className="stat-grid">
        <div className="stat"><dt className="t-support">Source</dt><dd style={{ margin: 0 }}>{sourceLabel(r)}</dd></div>
        <div className="stat"><dt className="t-support">Sentences</dt><dd style={{ margin: 0 }}>{n}</dd></div>
      </dl>
      <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{r.text}</p>
      {canReopen(r) ? (
        !isOpen && <p className="t-support">Opening it loads its {plural(n, "sentence")} into Study. Nothing is analysed again.</p>
      ) : (
        <DisabledReason>This entry was saved without its analysed sentences, so it can’t be opened. You can analyse the text again in Study.</DisabledReason>
      )}
      <div className="btn-row">
        {canReopen(r) ? (
          <Button kind="primary" onClick={() => openAnalysisInStudy(r)}>{isOpen ? "Open in Study" : "Open this analysis in Study"}</Button>
        ) : (
          <Button
            kind="primary"
            onClick={() => {
              patchStudy({ drafts: { ...study.drafts, text: r.text } });
              go("study/new");
            }}
          >
            Put the text in Study
          </Button>
        )}
        <Button kind="secondary" onClick={() => go("review/saved")}>Saved cards</Button>
      </div>
    </div>
  );
}

/* ---------------- Study time per day ---------------- */

const LANES: Lane[] = ["reading", "listening", "car", "speaking", "writing", "review"];

function Time() {
  const list = useList(() => loadDays(60));
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="study time" onRetry={list.reload} />;
  const days = list.data ?? [];
  const total = days.reduce((a, d) => a + d.seconds, 0);
  return (
    <>
      <p className="t-support" aria-live="polite">
        {plural(days.length, "day")} with study time · {fmtDuration(total / 60)} in all (last 60 study days)
      </p>
      {days.length === 0 ? (
        <Banner tone="neutral" title="No study time yet" actions={<Button kind="secondary" onClick={() => go("study/new")}>Start studying</Button>}>
          Time you spend studying, reviewing or listening is counted automatically and appears here.
        </Banner>
      ) : (
        <ul className="list">
          {days.map((d) => (
            <li key={d.day} className="stack gap-1" style={{ padding: "12px 16px" }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-strong">{dayLabel(d.day)}</span>
                <span className="t-strong num">{fmtDuration(d.seconds / 60)}</span>
              </span>
              <span className="t-support">{laneLine(d)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="t-meta">Study time can’t be cleared here; it’s your 1,000-hour total. Days start at 4:00.</p>
    </>
  );
}

function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function laneLine(d: DayTime) {
  const parts = LANES.filter((l) => (d.lanes[l] ?? 0) >= 30).map((l) => `${LANE_LABEL[l]} ${fmtDuration((d.lanes[l] ?? 0) / 60)}`);
  if (d.manual_seconds >= 30) parts.push(`${fmtDuration(d.manual_seconds / 60)} logged by hand`);
  return parts.join(" · ") || "Less than a minute";
}

/* ---------------- Recall & Dictation attempts ---------------- */

function Attempts() {
  const list = useList(() => listAttempts(500));
  const [kind, setKind] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [detail, setDetail] = useState<string | null>(null);
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="attempts" onRetry={list.reload} />;
  const all = list.data?.attempts ?? [];
  const total = list.data?.total ?? all.length;
  const open = detail ? all.find((a) => a.id === detail) : undefined;
  if (open) return <AttemptDetail a={open} onBack={() => setDetail(null)} />;
  const shown = all.filter(
    (a) => (kind === "all" || attemptKind(a) === kind) && (outcome === "all" || (outcome === "correct") === a.correct),
  );
  const correct = shown.filter((a) => a.correct).length;
  const avg = shown.length ? Math.round(shown.reduce((s, a) => s + a.accuracy, 0) / shown.length) : 0;
  return (
    <>
      <div className="filter-bar">
        <label className="field" style={{ width: 230 }}>
          <span className="field-label">Practice</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Recall and Dictation</option>
            <option>Recall</option>
            <option>Dictation</option>
          </select>
        </label>
        <label className="field" style={{ width: 180 }}>
          <span className="field-label">Outcome</span>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="all">All outcomes</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Not yet correct</option>
          </select>
        </label>
      </div>
      <p className="t-support" aria-live="polite">
        {plural(total, "practice attempt")}
        {total > all.length ? ` · Showing the newest ${all.length}` : ""}
        {shown.length !== all.length ? ` · ${shown.length} match the filters` : ""}
      </p>
      <dl className="stat-grid">
        {[
          ["Attempts", shown.length],
          ["Correct", correct],
          ["Average accuracy", `${avg}%`],
        ].map(([k, v]) => (
          <div key={k} className="stat">
            <dt className="t-support">{k}</dt>
            <dd className="t-section num" style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {all.length === 0 ? (
        <Banner tone="neutral" title="No practice attempts" actions={<Button kind="secondary" onClick={() => go("study/recall")}>Start Recall</Button>}>
          Recall and Dictation attempts appear here.
        </Banner>
      ) : shown.length === 0 ? (
        <Banner tone="neutral" title="No attempts match these filters" actions={<Button kind="secondary" onClick={() => { setKind("all"); setOutcome("all"); }}>Clear filters</Button>} />
      ) : (
        <ul className="list">
          {shown.map((a) => (
            <li key={a.id}>
              <RowButton onClick={() => setDetail(a.id)}>
                <span className="row">
                  <span className="t-strong">{attemptKind(a)}</span>
                  <Pill tone={a.correct ? "success" : "error"}>{a.correct ? "Correct" : "Not yet"}</Pill>
                  <span className="t-support num">{a.accuracy}%</span>
                </span>
                <span lang="fr" className="t-support">{preview(a.sentence)}</span>
                <span className="t-meta">{fmtWhen(a.created_at)}{a.step ? ` · step ${a.step}` : ""}</span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <p className="t-meta">No official or combined score is calculated from practice attempts.</p>
      <ClearAction kind="attempts" count={total} onCleared={list.reload} />
    </>
  );
}

function AttemptDetail({ a, onBack }: { a: AttemptRecord; onBack: () => void }) {
  const kind = attemptKind(a);
  return (
    <div className="stack gap-4">
      <BackButton onBack={onBack} />
      <h2 className="t-section" tabIndex={-1} data-autofocus>{kind} attempt · {fmtWhen(a.created_at)}</h2>
      <dl className="stack gap-3">
        <div><dt className="def-label">Sentence</dt><dd lang="fr" style={{ margin: 0 }}>{a.sentence}</dd></div>
        {a.expected && a.expected !== a.sentence && <div><dt className="def-label">Expected{a.step ? ` (step ${a.step})` : ""}</dt><dd lang="fr" style={{ margin: 0 }}>{a.expected}</dd></div>}
        <div><dt className="def-label">Your answer</dt><dd lang="fr" style={{ margin: 0 }}>{a.answer || "—"}</dd></div>
        <div>
          <dt className="def-label">Result</dt>
          <dd style={{ margin: 0 }}>{a.correct ? "Correct" : "Not yet correct"} · {a.accuracy}% accuracy</dd>
        </div>
      </dl>
      <div className="btn-row">
        <Button kind="secondary" onClick={() => { set((s) => ({ libFilters: { ...s.libFilters, q: a.sentence } })); go("review/saved"); }}>Find saved card</Button>
        <Button kind="tertiary" onClick={() => { patchStudy({ tab: kind === "Recall" ? "recall" : "dictation" }); go(kind === "Recall" ? "study/recall" : "study/dictation"); }}>Practise again</Button>
      </div>
    </div>
  );
}

/* ---------------- clearing (two separate, scoped operations) ---------------- */

function ClearAction({ kind, count, onCleared }: { kind: "analyses" | "attempts"; count: number; onCleared: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"confirm" | "clearing" | "failed">("confirm");
  const [done, setDone] = useState(false);
  const label = kind === "analyses" ? "Clear Study analysis list" : "Clear practice attempt history";
  const run = () => {
    setPhase("clearing");
    (kind === "analyses" ? clearStudyRecords() : clearAttempts())
      .then(() => {
        // Session summaries on this page start counting again from zero too.
        if (kind === "attempts") clearAttemptHistory();
        setOpen(false);
        setPhase("confirm");
        setDone(true);
        onCleared();
        announce(kind === "analyses" ? "Study analysis list cleared." : "Practice attempt history cleared.");
      })
      .catch(() => {
        setPhase("failed");
        announce("Clearing didn’t finish. Nothing was removed.", true);
      });
  };
  return (
    <div className="stack gap-2" style={{ marginTop: 16 }}>
      {done && count === 0 && (
        <Banner tone="success" title="Cleared" live="polite">
          {kind === "analyses" ? "Your Study analysis list is empty." : "Your practice attempt history is empty."} Saved cards, review scheduling, lookup counts and study time are unchanged.
        </Banner>
      )}
      <Button
        kind="tertiary"
        icon={<Trash2 aria-hidden />}
        onClick={() => { setPhase("confirm"); setOpen(true); }}
        disabledReason={count === 0 ? "There’s nothing to clear." : undefined}
        style={{ alignSelf: "flex-start", marginLeft: -12, color: count ? "var(--error)" : undefined }}
      >
        {label}
      </Button>
      {count === 0 && <DisabledReason>There’s nothing to clear.</DisabledReason>}
      {open && (
        <Dialog
          title={`${label}?`}
          onClose={() => phase !== "clearing" && setOpen(false)}
          dismissible={phase !== "clearing"}
          footer={
            <>
              <Button kind="secondary" onClick={() => setOpen(false)} disabled={phase === "clearing"} data-autofocus>Cancel</Button>
              <Button kind="destructive" busy={phase === "clearing"} onClick={run}>
                {phase === "failed" ? "Retry" : phase === "clearing" ? "Clearing…" : kind === "analyses" ? "Clear analysis list" : "Clear attempt history"}
              </Button>
            </>
          }
        >
          <p>
            {kind === "analyses"
              ? `This removes ${plural(count, "entry", "entries")} from your Study analysis list. It can’t be undone.`
              : `This removes ${plural(count, "attempt")} from your practice history. It can’t be undone.`}
          </p>
          <div className="stack gap-2">
            <p className="t-strong">These stay exactly the same:</p>
            <ul className="stack gap-1 t-support" style={{ paddingLeft: 20, color: "var(--text)" }}>
              <li>Saved cards and saved definition snapshots</li>
              <li>Lookup counts and importance</li>
              <li>Review scheduling and mastered cards</li>
              <li>Study time and 1,000-hour progress</li>
              <li>{kind === "analyses" ? "Practice attempt history" : "Study analysis list"}</li>
            </ul>
          </div>
          {phase === "failed" && <Banner tone="error" title="Clearing didn’t finish" live="assertive">Nothing was removed. Try again.</Banner>}
        </Dialog>
      )}
    </div>
  );
}
