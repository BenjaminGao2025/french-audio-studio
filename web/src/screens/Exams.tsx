import { useEffect, useState } from "react";
import { Play, ChevronLeft, ChevronRight, Sparkles, ClipboardList } from "lucide-react";
import {
  EXAM_LISTENING,
  EXAM_READING,
  EXAM_READING_PASSAGE,
  EXAM_SPEAKING,
  EXAM_STRUCTURE,
  EXAM_TOTAL_MINUTES,
  EXAM_WRITING,
  type McQ,
} from "../data/fixtures";
import { fmtClock, fmtDuration, plural } from "../lib/format";
import { announce, armFailure, get, go, initialExam, retryPlayback, set, simulate, startPlayback, useApp, type ExamResult, type ExamSection, type ExamState } from "../state/store";
import { Banner, Button, DemoNote, PageHead, Pill, Segmented, Skeleton, Spinner, Tabs } from "../components/ui";
import { BackTo, SimRecorder } from "./Practice";

const SECTION_NAME: Record<ExamSection, string> = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };
const ORDER: ExamSection[] = ["listening", "reading", "writing", "speaking"];
const MODE_NAME = { practice: "Skill practice", section: "Single-section timed mock", full: "Full four-skill mock — demo structure" };

function patchExam(p: Partial<ExamState>) {
  set((s) => ({ exam: { ...s.exam, ...p } }));
}

function useNow(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function remainingSeconds(e: ExamState, now: number) {
  if (!e.timed || !e.startedAt) return null;
  const pausedNow = e.demoPausedAt ? now - e.demoPausedAt : 0;
  return Math.max(0, e.budgetSeconds - (now - e.startedAt - e.pausedTotal - pausedNow) / 1000);
}

/* ---------------- SCR-EXM-01 ---------------- */
const GATE = [
  ["Exam type", "Pending"],
  ["Source", "Pending"],
  ["Rights", "Not verified"],
  ["Version / year", "Pending"],
  ["Skill", "Pending"],
  ["Prompts", "Incomplete"],
  ["Images where needed", "Missing"],
  ["Audio where needed", "Missing"],
  ["Choices", "Incomplete"],
  ["Answers or assessment basis", "Not verified"],
  ["Transcripts", "Missing"],
  ["Missing assets", "Not checked"],
  ["Duplicates", "Not checked"],
  ["Numbering", "Not checked"],
  ["Timing", "Pending verification"],
  ["Official navigation rules", "Pending verification"],
  ["Speaking phase rules", "Pending verification"],
];

export function ExamCollection() {
  const forced = useApp((s) => s.ss["SCR-EXM-01"]);
  const exam = useApp((s) => s.exam);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [n, setN] = useState(0);
  useEffect(() => {
    setLoad("loading");
    let live = true;
    simulate("exam", 600, true, { needsNetwork: false }).then(() => live && setLoad("ok")).catch(() => live && setLoad("error"));
    return () => {
      live = false;
    };
  }, [n]);
  const state = forced || load;
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Exam practice" eyebrow="TCF Canada-style preparation toward NCLC 7" desc="A planned collection of practice sets. The real materials aren’t ready, so you can preview the flow with original demo content." />
      <div className="stack gap-6">
        {state === "loading" && <><Spinner label="Loading the collection…" /><Skeleton lines={3} /></>}
        {state === "error" && <Banner tone="error" title="The collection didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setN(n + 1)}>Retry</Button>}>Nothing was changed.</Banner>}
        {state === "empty" && <Banner tone="neutral" title="No exam sets yet">Sets will appear here once they pass the checklist below.</Banner>}
        {(state === "ok" || state === "empty") && (
          <>
            <section className="stack gap-3" aria-labelledby="coll-h">
              <div className="row">
                <h2 id="coll-h" className="t-section">Collection</h2>
                <Pill tone="warning">Not ready</Pill>
              </div>
              <p className="t-figure">40 sets planned</p>
              <p className="t-support">Materials not yet verified. None of the 40 planned sets are available or confirmed as official papers.</p>
              <div className="btn-row">
                <Button kind="primary" icon={<Play aria-hidden />} onClick={() => go("practice/exams/modes")}>Preview demo flow</Button>
              </div>
              <p className="t-meta">The preview uses original, clearly labelled sample content. It doesn’t mark the collection as licensed or ready.</p>
            </section>
            <section className="stack gap-3" aria-labelledby="gate-h">
              <h2 id="gate-h" className="t-section">Rights and completeness checklist</h2>
              <p className="t-support">Each set must pass every item before it can be offered.</p>
              <div className="table-wrap">
                <table className="matrix">
                  <caption className="sr-only">Checklist for each planned set</caption>
                  <thead><tr><th scope="col">Requirement</th><th scope="col">Status for the collection</th></tr></thead>
                  <tbody>
                    {GATE.map(([k, v]) => (
                      <tr key={k}><th scope="row" style={{ fontWeight: 500 }}>{k}</th><td><Pill tone={v === "Missing" ? "error" : "warning"}>{v}</Pill></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="stack gap-3" aria-labelledby="struct-h">
              <h2 id="struct-h" className="t-section">Official-format structure (as supplied)</h2>
              <ul className="list">
                {EXAM_STRUCTURE.map((s) => (
                  <li key={s.key} className="list-row"><span className="grow t-strong">{s.name}</span><span className="t-support">{s.detail} · {s.minutes} min</span></li>
                ))}
                <li className="list-row"><span className="grow t-strong">Full total</span><span className="t-support">{fmtDuration(EXAM_TOTAL_MINUTES)}</span></li>
              </ul>
            </section>
            <ResultLists exam={exam} />
          </>
        )}
      </div>
    </div>
  );
}

function ResultLists({ exam }: { exam: ExamState }) {
  return (
    <div className="grid-2">
      <section className="stack gap-2">
        <h2 className="t-label">Practice records</h2>
        {exam.practiceResults.length ? (
          <ul className="list">{exam.practiceResults.map((r, i) => <li key={r.id} className="list-row">Practice {i + 1} · {r.sections.map((s) => s.name).join(", ")}</li>)}</ul>
        ) : <p className="t-support">No practice records yet.</p>}
      </section>
      <section className="stack gap-2">
        <h2 className="t-label">Timed mock results</h2>
        {exam.mockResults.length ? (
          <ul className="list">{exam.mockResults.map((r, i) => <li key={r.id} className="list-row">Mock {i + 1} · {MODE_NAME[r.mode]}</li>)}</ul>
        ) : <p className="t-support">No timed mock results yet.</p>}
      </section>
    </div>
  );
}

/* ---------------- SCR-EXM-02 ---------------- */
export function ExamModes() {
  const [mode, setMode] = useState<ExamState["mode"]>("practice");
  const [section, setSection] = useState<ExamSection>("listening");
  const exam = useApp((s) => s.exam);
  const running = exam.phase === "running" || exam.phase === "transition";
  const minutes = mode === "full" ? EXAM_TOTAL_MINUTES : EXAM_STRUCTURE.find((s) => s.key === section)!.minutes;
  const start = () => {
    const now = Date.now();
    set((s) => ({
      exam: {
        ...initialExam(),
        practiceResults: s.exam.practiceResults,
        mockResults: s.exam.mockResults,
        mode,
        section: mode === "full" ? "listening" : section,
        timed: mode !== "practice",
        startedAt: now,
        sectionStartedAt: now,
        budgetSeconds: minutes * 60,
        phase: "running",
      },
    }));
    go("practice/exams/run");
  };
  const rules: [string, string][] = [
    ["Timing", mode === "practice" ? "Untimed." : `${fmtDuration(minutes)} total${mode === "full" ? " across four sections" : ""}. The timer starts when you begin.`],
    ["Submission", mode === "practice" ? "Check answers when you’re ready." : "Submit at the end. When time runs out, your answers are submitted automatically."],
    ["Pause", mode === "practice" ? "Leave and come back any time." : "There’s no pause in the exam interface."],
    ["Leaving", mode === "practice" ? "Your answers are kept." : "The timer keeps running if you leave. Answers are kept within this demo session."],
    ["Resuming", "Come back to continue where you were, with your answers kept."],
    ["Previous questions", "You can go back within a section in this preview. Official navigation rules are pending verification."],
    ["Explanations", mode === "practice" ? "Shown after each question." : "Shown only after you submit."],
  ];
  return (
    <div className="page">
      <PageHead back={<BackTo label="Exam practice" to="practice/exams" />} title="Choose a mode" desc="All modes use original demo content and structural placeholders. This is not a complete or validated paper." />
      <div className="stack gap-5">
        {running && (
          <Banner tone="info" title="You have a session in progress" actions={<Button kind="secondary" onClick={() => go("practice/exams/run")}>Resume session</Button>}>
            {MODE_NAME[exam.mode]} · {SECTION_NAME[exam.section]}
          </Banner>
        )}
        <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Mode</legend>
          {(Object.keys(MODE_NAME) as ExamState["mode"][]).map((m) => (
            <label key={m} className="option">
              <input type="radio" name="exam-mode" checked={mode === m} onChange={() => setMode(m)} />
              <span className="stack">
                <span className="t-strong">{MODE_NAME[m]}</span>
                <span className="t-support">
                  {m === "practice" && "One skill, untimed, with explanations and dictionary lookups."}
                  {m === "section" && "One section under its time limit. This is a single section — not a complete four-skill set."}
                  {m === "full" && `All four sections in order (${fmtDuration(EXAM_TOTAL_MINUTES)}), with unfilled slots clearly labelled.`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode !== "full" && (
          <div className="stack gap-2">
            <p className="field-label">Section</p>
            <Segmented label="Section" value={section} onChange={setSection} options={ORDER.map((k) => ({ value: k, label: SECTION_NAME[k] }))} />
          </div>
        )}
        <section className="panel stack gap-3" aria-labelledby="pre-h">
          <div className="row">
            <h2 id="pre-h" className="t-label">Before you start</h2>
            <Pill tone="warning">Incomplete mock — practice mode</Pill>
          </div>
          <dl className="stack gap-2">
            {rules.map(([k, v]) => (
              <div key={k} className="row row--top" style={{ flexWrap: "nowrap", gap: 12 }}>
                <dt className="t-strong" style={{ width: 150, flex: "none" }}>{k}</dt>
                <dd style={{ margin: 0 }} className="grow">{v} <Pill>Demo rule</Pill></dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="btn-row">
          <Button kind="primary" onClick={start}>Start {mode === "practice" ? "practice" : "timed preview"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- SCR-EXM-03 … 08 ---------------- */
export function ExamRun() {
  const exam = useApp((s) => s.exam);
  const forced = useApp((s) => s.ss["SCR-EXM-08"]);
  const now = useNow(500);
  const left = remainingSeconds(exam, now);

  useEffect(() => {
    if (exam.leftAt) {
      patchExam({ leftAt: null, resumedNotice: true });
      announce("Resumed. The timer kept running while you were away.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (exam.timed && exam.phase === "running" && left !== null && left <= 0) {
      patchExam({ phase: "timeout" });
      announce("Time’s up. Your answers are being submitted.", true);
      setTimeout(() => submit(true), 1500);
    }
  }, [left, exam.phase, exam.timed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (forced === "submitfail") patchExam({ phase: "submitfail" });
    if (forced === "resumed") patchExam({ resumedNotice: true });
  }, [forced]);

  if (!exam.startedAt || exam.phase === "intro" || exam.phase === "results") {
    return (
      <div className="page">
        <PageHead back={<BackTo label="Exam practice" to="practice/exams" />} title="Exam preview" />
        <Banner tone="neutral" title="No session in progress" actions={<Button kind="primary" onClick={() => go("practice/exams/modes")}>Choose a mode</Button>} />
      </div>
    );
  }

  const fullIdx = ORDER.indexOf(exam.section);
  const isFull = exam.mode === "full";
  const lastSection = !isFull || fullIdx === ORDER.length - 1;

  return (
    <div className="page">
      <PageHead
        back={<BackTo label="Leave (timer keeps running)" to="practice/exams" />}
        eyebrow={`${MODE_NAME[exam.mode]} · ${exam.timed ? "Timed" : "Untimed"}`}
        title={SECTION_NAME[exam.section]}
        actions={exam.timed && left !== null ? (
          <span className="stack" style={{ alignItems: "flex-end" }}>
            <span className="exam-timer" role="timer" aria-label={`Time left: ${Math.floor(left / 60)} minutes`}>{fmtClock(left)}</span>
            <span className="t-meta">{isFull ? "Total time left" : "Section time left"}{exam.demoPausedAt ? " · paused by demo control" : ""}</span>
          </span>
        ) : undefined}
      />
      <div className="stack gap-5">
        <div className="row">
          <Pill tone="warning">Incomplete mock — practice mode</Pill>
          {!isFull && <Pill>Single section · not a complete four-skill set</Pill>}
        </div>
        {isFull && (
          <ol className="stage-list" aria-label="Sections">
            {ORDER.map((k, i) => (
              <li key={k} aria-current={i === fullIdx ? "step" : undefined} className={i < fullIdx ? "done" : undefined}>
                {i < fullIdx ? "Done: " : ""}{SECTION_NAME[k]} · {EXAM_STRUCTURE[i].minutes} min
              </li>
            ))}
          </ol>
        )}
        {exam.resumedNotice && (
          <Banner tone="info" title="Welcome back" actions={<Button kind="tertiary" onClick={() => patchExam({ resumedNotice: false })}>Dismiss</Button>}>
            Your answers are kept.{exam.timed ? " The timer kept running while you were away (Demo rule)." : ""}
          </Banner>
        )}
        {exam.phase === "timeout" && <Banner tone="warning" title="Time’s up" live="assertive">Your answers are being submitted (Demo rule).</Banner>}
        {exam.phase === "submitting" && <Spinner label="Submitting your answers…" />}
        {exam.phase === "submitfail" && (
          <Banner tone="error" title="Submission didn’t go through" live="assertive" actions={<Button kind="primary" onClick={() => submit(false)}>Retry submission</Button>}>
            All your responses are kept. Nothing was lost.
          </Banner>
        )}

        {exam.phase === "transition" ? (
          <Transition />
        ) : (
          <>
            {exam.section === "listening" && <McSection qs={EXAM_LISTENING} slots={39} audio />}
            {exam.section === "reading" && <McSection qs={EXAM_READING} slots={39} passage={EXAM_READING_PASSAGE} />}
            {exam.section === "writing" && <WritingSection />}
            {exam.section === "speaking" && <SpeakingSection />}
            {(exam.phase === "running" || exam.phase === "submitfail") && (
              <div className="btn-row">
                {lastSection ? (
                  <Button kind="primary" onClick={() => submit(false)} disabledReason={exam.phase === "submitfail" ? "Use Retry submission above." : undefined}>
                    {exam.mode === "practice" ? "Finish practice" : isFull ? "Submit mock" : "Submit section"}
                  </Button>
                ) : (
                  <Button kind="primary" onClick={() => { patchExam({ phase: "transition" }); announce(`${SECTION_NAME[exam.section]} complete.`); }}>
                    Finish {SECTION_NAME[exam.section]}
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        <DemoControls />
      </div>
    </div>
  );
}

function submit(timedOut: boolean) {
  const e = get().exam;
  patchExam({ phase: "submitting" });
  announce("Submitting…");
  simulate("exam", 1200, true, { needsNetwork: false })
    .then(() => {
      const ex = get().exam;
      const sections = (ex.mode === "full" ? ORDER : [ex.section]).map((k) => resultFor(k, ex));
      const r: ExamResult = { id: `r${Date.now()}`, mode: ex.mode, timedOut, sections };
      set((s) => ({
        exam: {
          ...s.exam,
          phase: "results",
          practiceResults: ex.mode === "practice" ? [...s.exam.practiceResults, r] : s.exam.practiceResults,
          mockResults: ex.mode !== "practice" ? [...s.exam.mockResults, r] : s.exam.mockResults,
        },
      }));
      announce("Submitted. Results ready.");
      go("practice/exams/results");
    })
    .catch(() => {
      patchExam({ phase: "submitfail" });
      announce("Submission didn’t go through. Your responses are kept.", true);
    });
  return e;
}

function resultFor(k: ExamSection, ex: ExamState): ExamResult["sections"][number] {
  if (k === "listening" || k === "reading") {
    const qs = k === "listening" ? EXAM_LISTENING : EXAM_READING;
    const answered = qs.filter((q) => ex.answers[q.id] !== undefined);
    return {
      key: k,
      name: SECTION_NAME[k],
      correct: qs.filter((q) => ex.answers[q.id] === q.answer).length,
      answered: answered.length,
      sample: qs.length,
      unfilled: 39 - qs.length,
      missed: qs.filter((q) => ex.answers[q.id] !== q.answer).map((q) => q.id),
    };
  }
  if (k === "writing")
    return {
      key: k,
      name: "Writing",
      missed: EXAM_WRITING.filter((t) => !(ex.writing[t.id] ?? "").trim()).map((t) => t.id),
      qualitative: "Clear purpose in each task you completed. Next: vary sentence openings and add one linking word per paragraph.",
    };
  return {
    key: k,
    name: "Speaking",
    missed: EXAM_SPEAKING.filter((t) => ex.recordings[t.id] !== "recorded").map((t) => t.id),
    qualitative: "You kept each answer on topic. Next: give one concrete example per point.",
  };
}

function Transition() {
  const exam = useApp((s) => s.exam);
  const now = useNow(1000);
  const i = ORDER.indexOf(exam.section);
  const next = ORDER[i + 1];
  const left = remainingSeconds(exam, now);
  const done = EXAM_STRUCTURE[i];
  return (
    <section className="panel stack gap-4" aria-labelledby="tr-h">
      <h2 id="tr-h" className="t-section" tabIndex={-1}>{SECTION_NAME[exam.section]} section complete</h2>
      <p>
        Structure: {done.name} has {plural(done.slots, done.key === "writing" || done.key === "speaking" ? "task" : "question slot")}.
        {done.key === "listening" || done.key === "reading" ? ` 3 are filled with sample content; ${done.slots - 3} are unfilled demo slots.` : ""}
      </p>
      <p>Your answers are kept. {left !== null && <>Total time left: <span className="num t-strong">{fmtClock(left)}</span>.</>}</p>
      <p className="t-strong">Next: {SECTION_NAME[next]} · {EXAM_STRUCTURE[i + 1].minutes} min · {EXAM_STRUCTURE[i + 1].detail}</p>
      <div className="btn-row">
        <Button kind="primary" iconAfter={<ChevronRight aria-hidden />} onClick={() => { patchExam({ section: next, phase: "running", qIndex: 0, sectionStartedAt: Date.now() }); announce(`${SECTION_NAME[next]} section.`); }}>
          Start {SECTION_NAME[next]}
        </Button>
      </div>
    </section>
  );
}

function McSection({ qs, slots, audio, passage }: { qs: McQ[]; slots: number; audio?: boolean; passage?: string }) {
  const exam = useApp((s) => s.exam);
  const p = useApp((s) => s.player);
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "failed">>({});
  const [explain, setExplain] = useState<Record<string, boolean>>({});
  const i = exam.qIndex;
  const q = qs[i];
  const mine = p?.owner.kind === "practice" && p.owner.label === "Exam sample audio" ? p : null;
  const choose = (opt: number) => {
    patchExam({ answers: { ...get().exam.answers, [q.id]: opt } });
    setSaveState((s) => ({ ...s, [q.id]: "saving" }));
    simulate("save", 400, true, { needsNetwork: false })
      .then(() => setSaveState((s) => ({ ...s, [q.id]: "saved" })))
      .catch(() => setSaveState((s) => ({ ...s, [q.id]: "failed" })));
  };
  return (
    <div className="stack gap-5">
      {passage && (
        <section className="panel stack gap-2" aria-labelledby="passage-h">
          <h2 id="passage-h" className="t-label">Passage (original sample)</h2>
          <p lang="fr">{passage}</p>
        </section>
      )}
      <nav aria-label="Questions" className="stack gap-2">
        <p className="t-support">{slots} question slots · questions 1–{qs.length} have sample content · {slots - qs.length} unfilled demo slots</p>
        <div className="q-grid">
          {Array.from({ length: slots }, (_, k) => {
            const filled = k < qs.length;
            const answered = filled && exam.answers[qs[k].id] !== undefined;
            return (
              <button
                key={k}
                type="button"
                className={`q-cell${filled ? "" : " unfilled"}${answered ? " answered" : ""}`}
                aria-current={k === i ? "true" : undefined}
                aria-label={`Question ${k + 1}${filled ? (answered ? ", answered" : ", not answered") : ", unfilled demo slot"}`}
                onClick={() => patchExam({ qIndex: k })}
              >
                {k + 1}
              </button>
            );
          })}
        </div>
      </nav>
      {q ? (
        <fieldset className="stack gap-3" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-section" style={{ marginBottom: 8 }}>Question {i + 1} of {slots}</legend>
          {audio && (
            <div className="stack gap-2">
              <div className="btn-row">
                <Button kind="secondary" icon={<Play aria-hidden />} busy={mine?.status === "loading"} onClick={() => startPlayback({ kind: "practice", label: "Exam sample audio", route: "practice/exams/run" }, 12)}>Play sample audio</Button>
                <span className="t-support">{mine ? (mine.status === "playing" ? "Playing" : mine.status === "ended" ? "Played" : mine.status === "error" ? "Couldn’t play" : "Loading…") : "Not played"}</span>
                <Pill tone="demo">Simulated audio</Pill>
              </div>
              {mine?.status === "error" && <Banner tone="error" title="Sample audio couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry audio</Button>}>Your answers are kept.</Banner>}
            </div>
          )}
          <p className="t-strong">{q.q}</p>
          {q.options.map((o, k) => (
            <label key={o} className="option">
              <input type="radio" name={q.id} checked={exam.answers[q.id] === k} onChange={() => choose(k)} />
              <span>{String.fromCharCode(65 + k)}. {o}</span>
            </label>
          ))}
          <p className="t-support" aria-live="polite">
            {saveState[q.id] === "saving" ? "Saving answer…" : saveState[q.id] === "saved" ? "Answer saved in this demo session." : saveState[q.id] === "failed" ? "" : exam.answers[q.id] !== undefined ? "Answer kept." : "Not answered yet."}
          </p>
          {saveState[q.id] === "failed" && (
            <Banner tone="error" title="Answer not saved" actions={<Button kind="secondary" onClick={() => choose(exam.answers[q.id])}>Retry</Button>}>Your choice is still selected on this page.</Banner>
          )}
          {exam.mode === "practice" ? (
            exam.answers[q.id] !== undefined && (
              explain[q.id] ? (
                <p className={exam.answers[q.id] === q.answer ? "banner banner--success" : "banner banner--error"}>{exam.answers[q.id] === q.answer ? "Correct." : `Answer: ${String.fromCharCode(65 + q.answer)}.`} {q.why}</p>
              ) : (
                <Button kind="tertiary" style={{ alignSelf: "flex-start", marginLeft: -12 }} onClick={() => setExplain({ ...explain, [q.id]: true })}>Show explanation</Button>
              )
            )
          ) : (
            <p className="t-meta">Explanations are shown after you submit.</p>
          )}
        </fieldset>
      ) : (
        <Banner tone="neutral" title={`Question ${i + 1} · unfilled demo slot`}>
          This preview only has sample content for questions 1–{qs.length}. The slot shows where a question would go in the full structure.
        </Banner>
      )}
      <div className="btn-row">
        <Button kind="secondary" icon={<ChevronLeft aria-hidden />} disabledReason={i === 0 ? "This is the first question." : undefined} onClick={() => patchExam({ qIndex: i - 1 })}>Previous</Button>
        <Button kind="secondary" iconAfter={<ChevronRight aria-hidden />} disabledReason={i === slots - 1 ? "This is the last question." : undefined} onClick={() => patchExam({ qIndex: i + 1 })}>Next question</Button>
      </div>
    </div>
  );
}

function WritingSection() {
  const exam = useApp((s) => s.exam);
  const [task, setTask] = useState("w1");
  const t = EXAM_WRITING.find((x) => x.id === task)!;
  const text = exam.writing[task] ?? "";
  const save = exam.writingSave[task];
  const doSave = (id: string) => {
    patchExam({ writingSave: { ...get().exam.writingSave, [id]: "saving" } });
    simulate("save", 600, true, { needsNetwork: false })
      .then(() => patchExam({ writingSave: { ...get().exam.writingSave, [id]: "saved" } }))
      .catch(() => patchExam({ writingSave: { ...get().exam.writingSave, [id]: "failed" } }));
  };
  return (
    <div className="stack gap-4">
      <Tabs label="Writing tasks" idBase="wr" value={task} onChange={setTask} tabs={EXAM_WRITING.map((w) => ({ value: w.id, label: `${w.title}${(exam.writing[w.id] ?? "").trim() ? " · started" : ""}` }))} />
      <div id="wr-panel" role="tabpanel" aria-labelledby={`wr-tab-${task}`} className="stack gap-3">
        <p lang="fr" className="t-strong">{t.prompt}</p>
        <div className="field">
          <label htmlFor={`wr-${task}`} className="field-label">Your answer</label>
          <textarea
            id={`wr-${task}`}
            className="textarea"
            lang="fr"
            rows={8}
            value={text}
            onChange={(e) => patchExam({ writing: { ...get().exam.writing, [task]: e.target.value }, writingSave: { ...get().exam.writingSave, [task]: "saving" } })}
            onBlur={() => doSave(task)}
          />
          <p className="counter">{plural(text.trim() ? text.trim().split(/\s+/).length : 0, "word")} · {save === "saving" ? "Saving draft…" : save === "saved" ? "Draft saved in this demo session" : save === "failed" ? "Draft not saved" : "Draft kept on this page"}</p>
        </div>
        {save === "failed" && <Banner tone="error" title="Draft didn’t save" actions={<Button kind="secondary" onClick={() => doSave(task)}>Retry</Button>}>Your text is still here.</Banner>}
        <p className="t-meta">{exam.mode === "practice" ? "Feedback appears after you finish." : "Feedback appears only after you submit."}</p>
      </div>
    </div>
  );
}

const SPEAK_STAGES = ["Task 1", "Preparation", "Task 2", "Task 3", "Complete"];

function SpeakingSection() {
  const exam = useApp((s) => s.exam);
  const now = useNow(1000);
  const st = exam.speakingStage;
  const used = exam.sectionStartedAt ? Math.min(12 * 60, (now - exam.sectionStartedAt) / 1000) : 0;
  const task = st === 0 ? EXAM_SPEAKING[0] : st === 2 ? EXAM_SPEAKING[1] : st === 3 ? EXAM_SPEAKING[2] : null;
  return (
    <div className="stack gap-4">
      <p className="t-support">Unofficial speaking simulation · Recording practice. No examiner is present.</p>
      <ol className="stage-list" aria-label="Speaking stages">
        {SPEAK_STAGES.map((s, i) => <li key={s} aria-current={i === st ? "step" : undefined} className={i < st ? "done" : undefined}>{i < st ? "Done: " : ""}{s}</li>)}
      </ol>
      <div className="panel stack gap-2">
        <p className="t-strong num">Speaking clock (simulated): {fmtClock(used)} of 12:00 used</p>
        <p className="t-support">The 12 minutes include the 2-minute preparation — it isn’t added on top. Timing configuration pending verification.</p>
      </div>
      {st === 1 && (
        <Banner tone="info" title="Preparation">Plan your answer for Task 2. This preparation is part of the 12-minute total. No recording during preparation.</Banner>
      )}
      {task && (
        <section className="stack gap-3" aria-labelledby="sp-h">
          <h2 id="sp-h" className="t-section">{task.title}</h2>
          <p lang="fr" className="t-strong">{task.prompt}</p>
          <SimRecorder id={task.id} onRecorded={() => patchExam({ recordings: { ...get().exam.recordings, [task.id]: "recorded" } })} />
        </section>
      )}
      {st === 4 && <Banner tone="success" title="All speaking stages complete">Submit to see unofficial feedback.</Banner>}
      {st < 4 && (
        <div className="stack gap-1">
          <div className="btn-row">
            <Button kind="secondary" iconAfter={<ChevronRight aria-hidden />} onClick={() => { patchExam({ speakingStage: st + 1 }); announce(`${SPEAK_STAGES[st + 1]}.`); }}>
              Go to {SPEAK_STAGES[st + 1]}
            </Button>
          </div>
          <p className="t-meta">Manual stage change · Demo rule. Official subtask timings are not simulated.</p>
        </div>
      )}
    </div>
  );
}

function DemoControls() {
  const exam = useApp((s) => s.exam);
  const isFull = exam.mode === "full";
  const i = ORDER.indexOf(exam.section);
  const adjustTo = (secondsLeft: number) => {
    const e = get().exam;
    if (!e.startedAt) return;
    const now = Date.now();
    const pausedNow = e.demoPausedAt ? now - e.demoPausedAt : 0;
    const elapsedTarget = e.budgetSeconds - secondsLeft;
    patchExam({ startedAt: now - elapsedTarget * 1000 - e.pausedTotal - pausedNow });
  };
  return (
    <aside className="demo-controls" aria-label="Demo controls, outside the exam">
      <p className="t-strong">Demo controls · outside the exam interface</p>
      <p className="t-meta">For reviewing this prototype only. A real timed exam would have none of these.</p>
      <div className="btn-row">
        {exam.timed && (
          <Button kind="tertiary" className="btn--sm-text" onClick={() => {
            const e = get().exam;
            if (e.demoPausedAt) patchExam({ pausedTotal: e.pausedTotal + (Date.now() - e.demoPausedAt), demoPausedAt: null });
            else patchExam({ demoPausedAt: Date.now() });
          }}>
            {exam.demoPausedAt ? "Resume timer (demo)" : "Pause timer (demo)"}
          </Button>
        )}
        {exam.timed && <Button kind="tertiary" className="btn--sm-text" onClick={() => adjustTo(30)}>Jump to 0:30 left</Button>}
        {exam.timed && <Button kind="tertiary" className="btn--sm-text" onClick={() => adjustTo(0)}>Jump to timeout</Button>}
        {isFull && i < 3 && exam.phase === "running" && <Button kind="tertiary" className="btn--sm-text" onClick={() => patchExam({ phase: "transition" })}>Jump to next section (demo)</Button>}
        <Button kind="tertiary" className="btn--sm-text" onClick={() => { armFailure("exam"); announce("The next submission will fail."); }}>Make next submission fail</Button>
        <Button kind="tertiary" className="btn--sm-text" onClick={() => { armFailure("save"); announce("The next answer save will fail."); }}>Make next save fail</Button>
        <Button kind="tertiary" className="btn--sm-text" onClick={() => { armFailure("audio"); announce("The next audio play will fail."); }}>Make next audio fail</Button>
      </div>
    </aside>
  );
}

/* ---------------- SCR-EXM-09 ---------------- */
export function ExamResults() {
  const exam = useApp((s) => s.exam);
  const last = [...exam.practiceResults, ...exam.mockResults].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (!last)
    return (
      <div className="page">
        <PageHead back={<BackTo label="Exam practice" to="practice/exams" />} title="Results" />
        <Banner tone="neutral" title="No results yet" actions={<Button kind="primary" onClick={() => go("practice/exams/modes")}>Preview demo flow</Button>} />
      </div>
    );
  const retry = (k: ExamSection, missed: string) => {
    const qIdx = (k === "listening" ? EXAM_LISTENING : EXAM_READING).findIndex((q) => q.id === missed);
    set((s) => ({ exam: { ...s.exam, mode: "practice", timed: false, section: k, phase: "running", startedAt: Date.now(), sectionStartedAt: Date.now(), qIndex: Math.max(0, qIdx), speakingStage: k === "speaking" ? 0 : s.exam.speakingStage, missedRetry: missed } }));
    go("practice/exams/run");
  };
  return (
    <div className="page">
      <PageHead
        back={<BackTo label="Exam practice" to="practice/exams" />}
        eyebrow={last.mode === "practice" ? "Practice record" : "Timed mock result"}
        title={last.mode === "practice" ? "Practice results" : "Mock results"}
        desc="Sample counts and unofficial feedback only. This is not a TCF, CEFR or NCLC score, a certified level or a readiness check."
      />
      <div className="stack gap-5">
        {last.timedOut && <Banner tone="warning" title="Submitted when time ran out">Answers given before the timeout were kept.</Banner>}
        <ul className="list">
          {last.sections.map((s) => (
            <li key={s.key} className="stack gap-2" style={{ padding: 16 }}>
              <h2 className="t-section">{s.name}</h2>
              {s.correct !== undefined ? (
                <>
                  <p><span className="t-strong num">{s.correct} correct · {s.sample! - s.correct} incorrect or unanswered</span> out of {s.sample} sample questions.</p>
                  <p className="t-support">{s.unfilled} unfilled demo slots were not scored.</p>
                </>
              ) : (
                <div className="stack gap-2">
                  <span className="ai-label"><Sparkles aria-hidden width={12} height={12} /> AI-style demo feedback · Not an official assessment</span>
                  <p>{s.qualitative}</p>
                </div>
              )}
              {s.missed.length > 0 && (
                <div className="row">
                  <span className="t-support">{plural(s.missed.length, s.correct !== undefined ? "question" : "task")} to retry</span>
                  <Button kind="secondary" onClick={() => retry(s.key, s.missed[0])}>Retry a missed {s.correct !== undefined ? "question" : "task"}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="btn-row">
          <Button kind="primary" onClick={() => go("practice/exams")}>Back to Exam practice</Button>
          <Button kind="tertiary" icon={<ClipboardList aria-hidden />} onClick={() => go("practice/exams/modes")}>Start another preview</Button>
        </div>
        <p className="row"><DemoNote>Practice records and timed mock results are stored separately.</DemoNote></p>
      </div>
    </div>
  );
}
