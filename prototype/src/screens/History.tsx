import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, CloudOff, RotateCcw } from "lucide-react";
import type { AnalysisRec, AttemptRec, AudioRec } from "../data/fixtures";
import { fmtClock, fmtDuration, plural } from "../lib/format";
import { openAnalysisInStudy } from "../state/study";
import { announce, clearAttemptHistory, go, patchStudy, set, simulate, useApp } from "../state/store";
import { Banner, Button, Dialog, DisabledReason, PageHead, Pill, Skeleton, Spinner, Tabs } from "../components/ui";
import { saveHistory } from "./Exercise";

type Tab = "analyses" | "audio" | "attempts";

export function HistoryScreen() {
  const route = useApp((s) => s.route);
  const forced = useApp((s) => s.ss["SCR-HIS-01"]);
  const offline = useApp((s) => s.offline);
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const tab = (params.get("tab") as Tab) ?? "attempts";
  const [detail, setDetail] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [n, setN] = useState(0);
  useEffect(() => {
    setLoad("loading");
    let live = true;
    simulate("history", 500, true, { needsNetwork: false })
      .then(() => live && setLoad("ok"))
      .catch(() => live && setLoad("error"));
    return () => {
      live = false;
    };
  }, [n, tab]);
  useEffect(() => setDetail(null), [tab]);
  const forcedDetail = useApp((s) => s.ss["SCR-HIS-02"]);
  useEffect(() => {
    if (forcedDetail) setDetail(forcedDetail);
  }, [forcedDetail]);
  const state = forced || (load !== "ok" ? load : offline ? "offline" : "ok");

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
            { value: "audio", label: "Audio activity" },
            { value: "attempts", label: "Recall & Dictation" },
          ]}
        />
        <div id="hist-panel" role="tabpanel" aria-labelledby={`hist-tab-${tab}`} className="stack gap-4">
          {state === "loading" && (
            <>
              <Spinner label="Loading history…" />
              <Skeleton lines={4} />
            </>
          )}
          {state === "error" && (
            <Banner tone="error" title="History didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setN(n + 1)}>Retry</Button>}>
              Your records are safe. This is a simulated loading failure.
            </Banner>
          )}
          {state === "offline" && (
            <Banner tone="warning" title="Showing records saved on this device">
              <span className="row"><CloudOff aria-hidden width={16} height={16} /> You’re offline (simulated). Newer records from other devices may be missing.</span>
            </Banner>
          )}
          {(state === "ok" || state === "offline" || state === "empty" || state === "nomatch") &&
            (detail ? (
              <Detail tab={tab} id={detail} onBack={() => setDetail(null)} />
            ) : tab === "analyses" ? (
              <Analyses forced={state} onOpen={setDetail} />
            ) : tab === "audio" ? (
              <Audio forced={state} onOpen={setDetail} />
            ) : (
              <Attempts forced={state} onOpen={setDetail} />
            ))}
        </div>
      </div>
    </div>
  );
}

function Scope({ total, shown, noun }: { total: number; shown: number; noun: string }) {
  return (
    <p className="t-support" aria-live="polite">
      {plural(total, noun)} · All demo dates · Showing {shown === total ? `all ${total}` : `${shown} of ${total}`}
    </p>
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

function Analyses({ forced, onOpen }: { forced: string; onOpen: (id: string) => void }) {
  const list = useApp((s) => s.history.analyses);
  const [src, setSrc] = useState("all");
  const all = forced === "empty" ? [] : list;
  const shown = forced === "nomatch" ? [] : all.filter((a) => src === "all" || a.source === src);
  return (
    <>
      <div className="row gap-3" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ width: 220 }}>
          <span className="field-label">Source</span>
          <select className="select" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="all">All sources</option>
            <option>Pasted text</option>
            <option>Photo import</option>
            <option>My own idea</option>
          </select>
        </label>
      </div>
      <Scope total={all.length} shown={shown.length} noun="Study analysis" />
      {all.length === 0 ? (
        <Banner tone="neutral" title="No Study analyses yet" actions={<Button kind="secondary" onClick={() => go("study/new")}>Analyse a text</Button>}>Texts you analyse in Study appear here.</Banner>
      ) : shown.length === 0 ? (
        <Banner tone="neutral" title="No analyses match this filter" actions={<Button kind="secondary" onClick={() => setSrc("all")}>Show all sources</Button>} />
      ) : (
        <ul className="list">
          {shown.map((a) => (
            <li key={a.id}>
              <RowButton onClick={() => onOpen(a.id)}>
                <span lang="fr" className="t-strong">{a.preview}</span>
                <span className="t-support">{a.date} · {a.source} · {plural(a.sentences, "sentence")}</span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <ClearAction kind="analyses" count={all.length} />
    </>
  );
}

function Audio({ forced, onOpen }: { forced: string; onOpen: (id: string) => void }) {
  const list = useApp((s) => s.history.audio);
  const [f, setF] = useState("all");
  const all = forced === "empty" ? [] : list;
  const shown = forced === "nomatch" ? [] : all.filter((a) => f === "all" || a.owner.startsWith(f));
  return (
    <>
      <label className="field" style={{ width: 220 }}>
        <span className="field-label">Activity</span>
        <select className="select" value={f} onChange={(e) => setF(e.target.value)}>
          <option value="all">All audio</option>
          <option value="Episode">Episodes</option>
          <option value="Study">Study</option>
          <option value="Practice">Practice</option>
          <option value="Audio Studio">Audio Studio</option>
        </select>
      </label>
      <Scope total={all.length} shown={shown.length} noun="audio session" />
      {all.length === 0 ? (
        <Banner tone="neutral" title="No audio activity yet">Play an episode or a sentence. Counted time appears here.</Banner>
      ) : shown.length === 0 ? (
        <Banner tone="neutral" title="No audio sessions match this filter" actions={<Button kind="secondary" onClick={() => setF("all")}>Show all audio</Button>} />
      ) : (
        <ul className="list">
          {shown.map((a) => (
            <li key={a.id}>
              <RowButton onClick={() => onOpen(a.id)}>
                <span className="t-strong">{a.owner}</span>
                <span className="t-support num">{a.date} · {fmtClock(a.contentSeconds)} of audio at {a.speed}× · {fmtClock(a.countedSeconds)} counted</span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <p className="t-meta">Audio activity can’t be cleared here; it’s part of your 1,000-hour total.</p>
    </>
  );
}

function summarize(list: AttemptRec[]) {
  const completed = list.filter((a) => a.state === "completed");
  return {
    attempts: list.length,
    completed: completed.length,
    unaided: completed.filter((a) => !a.hinted && !a.answerKnown && a.outcome === "correct").length,
    hinted: completed.filter((a) => a.hinted && !a.answerKnown).length,
    known: completed.filter((a) => a.answerKnown).length,
  };
}

function retryHistorySaveInPlace(id: string, onDone?: (ok: boolean) => void) {
  const liveAttempt = useAppStateAttempt(id);
  if (liveAttempt) {
    saveHistory(id, true);
    onDone?.(true);
    return;
  }
  simulate("history", 700, true)
    .then(() => {
      set((s) => ({
        history: {
          ...s.history,
          attempts: s.history.attempts.map((x) => (x.id === id ? { ...x, saved: "saved" } : x)),
        },
      }));
      announce("History entry saved.");
      onDone?.(true);
    })
    .catch(() => onDone?.(false));
}

function useAppStateAttempt(id: string) {
  // Check if this attempt was created during the current session in s.attempts
  let found = false;
  set((s) => {
    found = s.attempts.some((a) => a.id === id);
    return {};
  });
  return found;
}

function Attempts({ forced, onOpen }: { forced: string; onOpen: (id: string) => void }) {
  const list = useApp((s) => s.history.attempts);
  const [kind, setKind] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const all = forced === "empty" ? [] : list;
  const shown =
    forced === "nomatch"
      ? []
      : all.filter(
          (a) =>
            (kind === "all" || a.kind === kind) &&
            (outcome === "all" ||
              (outcome === "unaided" && a.state === "completed" && !a.hinted && !a.answerKnown && a.outcome === "correct") ||
              (outcome === "incorrect" && a.state === "completed" && !a.answerKnown && a.outcome === "incorrect") ||
              (outcome === "hinted" && a.hinted && !a.answerKnown) ||
              (outcome === "known" && a.answerKnown) ||
              (outcome === "pending" && a.state === "pending")),
        );
  const sum = summarize(shown);
  return (
    <>
      <div className="filter-bar">
        <label className="field" style={{ width: 180 }}>
          <span className="field-label">Practice</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Recall and Dictation</option>
            <option>Recall</option>
            <option>Dictation</option>
          </select>
        </label>
        <label className="field" style={{ width: 220 }}>
          <span className="field-label">Outcome</span>
          <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="all">All outcomes</option>
            <option value="unaided">Unaided correct</option>
            <option value="incorrect">Unaided incorrect</option>
            <option value="hinted">Hint used</option>
            <option value="known">Answer known</option>
            <option value="pending">Not completed</option>
          </select>
        </label>
      </div>
      <Scope total={all.length} shown={shown.length} noun="practice attempt" />
      <dl className="stat-grid">
        {[
          ["Attempts", sum.attempts],
          ["Completed", sum.completed],
          ["Unaided correct", sum.unaided],
          ["Hint used", sum.hinted],
          ["Answer known", sum.known],
        ].map(([k, v]) => (
          <div key={k} className="stat">
            <dt className="t-support">{k}</dt>
            <dd className="t-section num" style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {all.length === 0 ? (
        <Banner tone="neutral" title="No practice attempts" actions={<Button kind="secondary" onClick={() => go("study/recall")}>Start Recall</Button>}>Recall and Dictation attempts appear here.</Banner>
      ) : shown.length === 0 ? (
        <Banner tone="neutral" title="No attempts match these filters" actions={<Button kind="secondary" onClick={() => { setKind("all"); setOutcome("all"); }}>Clear filters</Button>} />
      ) : (
        <ul className="list">
          {shown.map((a) => (
            <li key={a.id} className="row" style={{ flexWrap: "nowrap" }}>
              <RowButton onClick={() => onOpen(a.id)}>
                <span className="row">
                  <span className="t-strong">{a.kind}</span>
                  <Pill>{a.state === "pending" ? "Not completed" : a.answerKnown ? "Answer known" : a.hinted ? "Hint used" : "Unaided"}</Pill>
                  {a.state === "completed" && !a.answerKnown && <Pill tone={a.outcome === "correct" ? "success" : "error"}>{a.outcome === "correct" ? "Correct" : "Incorrect"}</Pill>}
                  {a.saved === "failed" && <Pill tone="warning">Not saved · Retry</Pill>}
                </span>
                <span className="t-support">{a.date} · {a.scope}{a.step ? `, step ${a.step}` : ""}</span>
              </RowButton>
              {a.saved === "failed" && (
                <div style={{ paddingRight: 16 }}>
                  <Button
                    kind="secondary"
                    className="btn--sm-text"
                    icon={<RotateCcw aria-hidden />}
                    busy={retrying[a.id]}
                    onClick={() => {
                      setRetrying((r) => ({ ...r, [a.id]: true }));
                      retryHistorySaveInPlace(a.id, () => setRetrying((r) => ({ ...r, [a.id]: false })));
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="t-meta">No official or combined score is calculated from practice attempts.</p>
      <ClearAction kind="attempts" count={all.length} />
    </>
  );
}

function Detail({ tab, id, onBack }: { tab: Tab; id: string; onBack: () => void }) {
  const h = useApp((s) => s.history);
  const study = useApp((s) => s.study);
  const [save, setSave] = useState<"idle" | "saving" | "failed">("idle");
  const back = <Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={onBack} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Back to list</Button>;
  if (tab === "analyses") {
    const a = (h.analyses.find((x) => x.id === id) ?? h.analyses[0]) as AnalysisRec | undefined;
    if (!a) return <div className="stack gap-3">{back}<p>Analysis not found.</p></div>;
    const isCurrentlyOpen = study.analysis.status === "done" && study.analysis.input === a.text;
    return (
      <div className="stack gap-4">
        {back}
        <h2 className="t-section" tabIndex={-1} data-autofocus>Study analysis · {a.date}</h2>
        <dl className="stat-grid">
          <div className="stat"><dt className="t-support">Source</dt><dd style={{ margin: 0 }}>{a.source}</dd></div>
          <div className="stat"><dt className="t-support">Sentences</dt><dd style={{ margin: 0 }}>{a.sentences}</dd></div>
        </dl>
        <p lang="fr">{a.text ?? a.preview}</p>
        {!isCurrentlyOpen && (
          <p className="t-support">This analysis is not the one currently open in Study. Opening it loads its {plural(a.sentences, "sentence")} into Study.</p>
        )}
        <div className="btn-row">
          <Button kind="primary" onClick={() => openAnalysisInStudy(a)}>
            {isCurrentlyOpen ? "Open in Study" : "Open this analysis in Study"}
          </Button>
          <Button kind="secondary" onClick={() => go("review/library")}>Saved cards in Word library</Button>
        </div>
      </div>
    );
  }
  if (tab === "audio") {
    const a = (h.audio.find((x) => x.id === id) ?? h.audio[0]) as AudioRec | undefined;
    if (!a) return <div className="stack gap-3">{back}<p>Audio session not found.</p></div>;
    return (
      <div className="stack gap-4">
        {back}
        <h2 className="t-section">{a.owner}</h2>
        <dl className="stat-grid">
          <div className="stat"><dt className="t-support">Audio played</dt><dd className="t-section num" style={{ margin: 0 }}>{fmtClock(a.contentSeconds)}</dd></div>
          <div className="stat"><dt className="t-support">Speed</dt><dd className="t-section num" style={{ margin: 0 }}>{a.speed}×</dd></div>
          <div className="stat"><dt className="t-support">Counted toward 1,000 h</dt><dd className="t-section num" style={{ margin: 0 }}>{fmtClock(a.countedSeconds)}</dd></div>
        </dl>
        <p className="t-support">Counted time is the real time the audio was playing: {fmtClock(a.contentSeconds)} at {a.speed}× is {fmtClock(a.countedSeconds)}.</p>
        {a.owner.startsWith("Episode") && <Button kind="secondary" style={{ alignSelf: "flex-start" }} onClick={() => go("practice/episodes")}>Open Episodes</Button>}
      </div>
    );
  }
  const a = (h.attempts.find((x) => x.id === id) ?? h.attempts[0]) as AttemptRec | undefined;
  if (!a) return <div className="stack gap-3">{back}<p>Attempt not found.</p></div>;
  const retry = () => {
    setSave("saving");
    retryHistorySaveInPlace(a.id, (ok) => setSave(ok ? "idle" : "failed"));
  };
  return (
    <div className="stack gap-4">
      {back}
      <h2 className="t-section">{a.kind} attempt · {a.date}</h2>
      <dl className="stack gap-3">
        <div><dt className="def-label">Sentence</dt><dd lang="fr" style={{ margin: 0 }}>{a.sentence}</dd></div>
        {a.response && <div><dt className="def-label">Your answer</dt><dd lang="fr" style={{ margin: 0 }}>{a.response}</dd></div>}
        <div><dt className="def-label">Scope</dt><dd style={{ margin: 0 }}>{a.scope}{a.step ? `, step ${a.step}` : ""}</dd></div>
        <div>
          <dt className="def-label">Result</dt>
          <dd style={{ margin: 0 }}>
            {a.state === "pending" ? "Not completed — checking didn’t finish (technical issue, not a wrong answer)" : a.answerKnown ? "Answer known (submitted after Show answer)" : `${a.hinted ? "Hint used" : "Unaided"} · ${a.outcome === "correct" ? "Correct" : "Incorrect"}`}
          </dd>
        </div>
      </dl>
      {(a.saved === "failed" || save === "failed") && (
        <Banner tone="error" title="This entry didn’t finish saving" actions={<Button kind="secondary" busy={save === "saving"} onClick={retry}>Retry saving</Button>}>
          The attempt and its result are kept. Retrying won’t create a duplicate.
        </Banner>
      )}
      <div className="btn-row">
        <Button kind="secondary" onClick={() => { set((s) => ({ libFilters: { ...s.libFilters, q: a.sentence } })); go("review/library"); }}>Find card in Word library</Button>
        <Button kind="tertiary" onClick={() => { patchStudy({ tab: a.kind === "Recall" ? "recall" : "dictation" }); go(a.kind === "Recall" ? "study/recall" : "study/dictation"); }}>Practise again</Button>
      </div>
    </div>
  );
}

/* SCR-HIS-03: two separate, scoped clear operations */
function ClearAction({ kind, count }: { kind: "analyses" | "attempts"; count: number }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"confirm" | "clearing" | "failed">("confirm");
  const [done, setDone] = useState(false);
  const savedCardsCount = useApp((s) => s.cards.filter((c) => c.saved).length);
  const masteredCount = useApp((s) => s.cards.filter((c) => c.saved && c.mastered).length);
  const snapshotsCount = useApp((s) => Object.keys(s.snapshots).length);
  const lifetimeHours = useApp((s) => s.audioStats.lifetimeHours);
  const forced = useApp((s) => s.ss["SCR-HIS-03"]);
  useEffect(() => {
    if (forced && forced.startsWith(kind)) {
      setOpen(true);
      const p = forced.split(":")[1];
      if (p === "clearing" || p === "failed") setPhase(p);
    }
  }, [forced, kind]);
  const label = kind === "analyses" ? "Clear Study analysis list" : "Clear practice attempt history";
  const run = () => {
    setPhase("clearing");
    simulate("clear", 1000, true)
      .then(() => {
        if (kind === "attempts") clearAttemptHistory();
        else set((s) => ({ history: { ...s.history, analyses: [] } }));
        setOpen(false);
        setPhase("confirm");
        setDone(true);
        announce(kind === "analyses" ? "Study analysis list cleared." : "Practice attempt history cleared.");
      })
      .catch(() => {
        setPhase("failed");
        announce("Clearing didn’t finish. Nothing was removed.", true);
      });
  };
  return (
    <div className="stack gap-2" style={{ marginTop: 16 }}>
      {done && (
        <Banner tone="success" title="Cleared" live="polite">
          {kind === "analyses"
            ? "Your Study analysis list is empty."
            : "Your practice attempt history is empty and derived attempt counts start again from 0."}{" "}
          Unchanged: {savedCardsCount} saved cards · {snapshotsCount} saved definition snapshots · lookup counts and importance · review scheduling and {masteredCount} mastered cards · {fmtDuration(lifetimeHours * 60)} lifetime audio toward 1,000 hours · Friend access: Free · Unlimited access.
        </Banner>
      )}
      <Button kind="tertiary" icon={<Trash2 aria-hidden />} onClick={() => { setPhase("confirm"); setOpen(true); }} disabledReason={count === 0 ? "There’s nothing to clear." : undefined} style={{ alignSelf: "flex-start", marginLeft: -12, color: count ? "var(--error)" : undefined }}>
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
              <Button kind="destructive" busy={phase === "clearing"} onClick={run}>{phase === "failed" ? "Retry" : phase === "clearing" ? "Clearing…" : kind === "analyses" ? "Clear analysis list" : "Clear attempt history"}</Button>
            </>
          }
        >
          <p>
            {kind === "analyses"
              ? `This removes ${plural(count, "entry", "entries")} from your Study analysis list.`
              : `This removes ${plural(count, "attempt")} from your practice history. Attempt counts shown in History will start again from zero.`}
          </p>
          <div className="stack gap-2">
            <p className="t-strong">These stay exactly the same:</p>
            <ul className="stack gap-1 t-support" style={{ paddingLeft: 20, color: "var(--text)" }}>
              <li>Saved cards and saved definition snapshots</li>
              <li>Lookup counts and importance</li>
              <li>Review scheduling and mastered cards</li>
              <li>Audio activity, audio time and 1,000-hour progress</li>
              <li>{kind === "analyses" ? "Practice attempt history" : "Study analysis list"}</li>
              <li>Your friend’s free, unlimited access and other accounts</li>
            </ul>
          </div>
          {phase === "failed" && <Banner tone="error" title="Clearing didn’t finish" live="assertive">Nothing was removed. Try again.</Banner>}
        </Dialog>
      )}
    </div>
  );
}
