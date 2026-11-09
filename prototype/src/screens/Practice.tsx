import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Headphones, Mic, PenSquare, Radio, AudioLines, GraduationCap, Square, Play, Pause, RotateCcw, Sparkles } from "lucide-react";
import { LISTEN_TASK, SPEAK_TASK, STUDIO_SAMPLES, WRITE_TASK } from "../data/fixtures";
import { fmtClock, plural } from "../lib/format";
import { announce, go, retryPlayback, set, simulate, startPlayback, updatePlayer, useApp } from "../state/store";
import { Banner, Button, DemoNote, DisabledReason, PageHead, Pill, Segmented, Spinner } from "../components/ui";
import { EpisodeList, EpisodePlayer } from "./Episodes";
import { ExamCollection, ExamModes, ExamResults, ExamRun } from "./Exams";

export function PracticeScreen({ parts }: { parts: string[] }) {
  const [a, b] = parts;
  if (a === "write") return <Write />;
  if (a === "speak") return <Speak />;
  if (a === "listen") return <Listen />;
  if (a === "studio") return <Studio />;
  if (a === "episodes") return b ? <EpisodePlayer id={b} /> : <EpisodeList />;
  if (a === "exams") {
    if (b === "modes") return <ExamModes />;
    if (b === "run") return <ExamRun />;
    if (b === "results") return <ExamResults />;
    return <ExamCollection />;
  }
  return <Hub />;
}

export function BackTo({ label, to }: { label: string; to: string }) {
  return (
    <Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go(to)} style={{ alignSelf: "flex-start", marginLeft: -12 }}>
      {label}
    </Button>
  );
}

/* SCR-PRA-01 */
function Hub() {
  const dest = [
    { to: "practice/write", icon: <PenSquare aria-hidden />, title: "Write", text: "Short writing tasks with qualitative feedback." },
    { to: "practice/speak", icon: <Mic aria-hidden />, title: "Speak", text: "Recording practice with simulated controls. No microphone is used." },
    { to: "practice/listen", icon: <Headphones aria-hidden />, title: "Listen", text: "Guided listening: a short clip with questions and explanations." },
    { to: "practice/episodes", icon: <Radio aria-hidden />, title: "Episodes", text: "Continuous listening: longer audio you can come back to." },
    { to: "practice/studio", icon: <AudioLines aria-hidden />, title: "Audio Studio", text: "A tool for preparing listening material from your own French text." },
    { to: "practice/exams", icon: <GraduationCap aria-hidden />, title: "Exam practice", text: "TCF Canada-style structure · 40 sets planned · Materials not yet verified." },
  ];
  return (
    <div className="page">
      <PageHead title="Practice" desc="Practise one skill at a time, listen for longer, or prepare your own listening material." />
      <ul className="list">
        {dest.map((d) => (
          <li key={d.to}>
            <button className="list-btn" onClick={() => go(d.to)}>
              <span className="dest-icon">{d.icon}</span>
              <span className="grow stack">
                <span className="t-strong">{d.title}</span>
                <span className="t-support">{d.text}</span>
              </span>
              <ChevronRight aria-hidden className="chev" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useDraft(key: string): [string, (v: string) => void] {
  const v = useApp((s) => s.drafts[key] ?? "");
  return [v, (nv: string) => set((s) => ({ drafts: { ...s.drafts, [key]: nv } }))];
}

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/* SCR-PRA-02 */
function Write() {
  const forced = useApp((s) => s.ss["SCR-PRA-02"]);
  const [draft, setDraft] = useDraft("write");
  const [phase, setPhase] = useState<"draft" | "empty" | "submitting" | "feedback" | "failed" | "done">("draft");
  useEffect(() => {
    if (forced) setPhase(forced as typeof phase);
    if (forced === "feedback" && !draft) setDraft("Salut Léa ! Tu es libre samedi ? On peut aller au marché Jean-Talon à 10 h. Il y a des fraises et un bon café. Dis-moi !");
  }, [forced]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = wordCount(draft);
  const submit = () => {
    if (!draft.trim()) {
      setPhase("empty");
      announce("Write your message before submitting.", true);
      return;
    }
    setPhase("submitting");
    simulate("write", 1200, true)
      .then(() => {
        setPhase("feedback");
        announce("Feedback ready.");
        requestAnimationFrame(() => document.getElementById("write-fb")?.focus());
      })
      .catch(() => {
        setPhase("failed");
        announce("Feedback didn’t load. Your text is kept.", true);
      });
  };
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Write" desc="Write a short message. Your draft is kept if you leave this page." />
      <div className="stack gap-5">
        <div className="stack gap-2">
          <p className="t-label">Task</p>
          <p lang="fr" className="t-body t-strong">{WRITE_TASK.prompt}</p>
          <p className="t-support">{WRITE_TASK.promptEn} Aim for {WRITE_TASK.min}–{WRITE_TASK.max} words.</p>
        </div>
        {phase === "done" ? (
          <Banner tone="success" title="Writing practice complete" live="polite" actions={<><Button kind="primary" onClick={() => go("practice")}>Back to Practice</Button><Button kind="secondary" onClick={() => { setDraft(""); setPhase("draft"); }}>Write another</Button></>}>
            Saved to your practice records (separate from timed mock results).
          </Banner>
        ) : phase === "feedback" ? (
          <div className="stack gap-4">
            <div id="write-fb" tabIndex={-1} className="stack gap-3">
              <span className="ai-label"><Sparkles aria-hidden width={12} height={12} /> AI-style demo feedback · Not an official assessment</span>
              <p className="t-support">Your text</p>
              <p lang="fr">{draft}</p>
              <hr className="divider" />
              <p className="t-strong">What works</p>
              <ul className="stack gap-1" style={{ paddingLeft: 20 }}>
                <li>You give a place, a time and a reason — all three parts of the task.</li>
                <li>The tone suits a message to a friend.</li>
              </ul>
              <p className="t-strong">Try next</p>
              <ul className="stack gap-1" style={{ paddingLeft: 20 }}>
                <li>Add a sentence that links ideas, for example <span lang="fr">“Comme il fait beau, on pourrait…”</span></li>
                <li>Close with a clear question: <span lang="fr">“Ça te dit ?”</span></li>
              </ul>
              <p className="t-meta">No score or level is given. This feedback is simulated.</p>
            </div>
            <div className="btn-row">
              <Button kind="primary" onClick={() => { setPhase("done"); announce("Writing practice complete."); }}>Finish</Button>
              <Button kind="secondary" onClick={() => setPhase("draft")}>Revise my text</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="write-ta" className="field-label">Your message in French</label>
              <textarea id="write-ta" className="textarea" lang="fr" rows={8} value={draft} readOnly={phase === "submitting"} aria-invalid={phase === "empty" || undefined} aria-describedby="write-count" onChange={(e) => { setDraft(e.target.value); if (phase === "empty") setPhase("draft"); }} />
              <p id="write-count" className="counter">{plural(n, "word")} · draft saved on this device</p>
              {phase === "empty" && <p className="field-error" role="alert">Write your message before submitting. Nothing was sent.</p>}
            </div>
            {phase === "failed" && <Banner tone="error" title="Feedback didn’t load" live="assertive">Your text is kept exactly as you wrote it.</Banner>}
            {phase === "submitting" && <Spinner label="Preparing feedback…" />}
            <div className="sticky-actions">
              <div className="btn-row">
                <Button kind="primary" busy={phase === "submitting"} onClick={submit}>{phase === "failed" ? "Retry" : "Get feedback"}</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* SCR-PRA-03 */
export function SimRecorder({ id, onRecorded }: { id: string; onRecorded?: () => void }) {
  const forced = useApp((s) => s.ss["SCR-PRA-03"]);
  const [phase, setPhase] = useState<"idle" | "recording" | "recorded" | "playing" | "failed">("idle");
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (forced === "recording" || forced === "failed" || forced === "recorded") setPhase(forced);
  }, [forced]);
  useEffect(() => {
    if (phase !== "recording" && phase !== "playing") return;
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  return (
    <div className="stack gap-3" role="group" aria-label={`Simulated recorder ${id}`}>
      <div className="btn-row">
        {phase === "idle" || phase === "failed" ? (
          <Button kind="secondary" icon={<Mic aria-hidden />} onClick={() => {
            setSecs(0);
            simulate("speak", 300, true, { needsNetwork: false }).then(() => { setPhase("recording"); announce("Simulated recording started."); }).catch(() => { setPhase("failed"); announce("Simulated recording failed.", true); });
          }}>
            {phase === "failed" ? "Retry recording" : "Start simulated recording"}
          </Button>
        ) : phase === "recording" ? (
          <Button kind="secondary" icon={<Square aria-hidden />} onClick={() => { setPhase("recorded"); announce(`Recording stopped at ${fmtClock(secs)}.`); onRecorded?.(); }}>Stop recording</Button>
        ) : (
          <>
            <Button kind="secondary" icon={phase === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={() => { setSecs(0); setPhase(phase === "playing" ? "recorded" : "playing"); }}>
              {phase === "playing" ? "Pause my recording" : "Play my recording"}
            </Button>
            <Button kind="tertiary" icon={<RotateCcw aria-hidden />} onClick={() => { setPhase("idle"); setSecs(0); }}>Record again</Button>
          </>
        )}
        <span className="t-support num" aria-live="off">
          {phase === "recording" ? `Recording (simulated) · ${fmtClock(secs)}` : phase === "recorded" ? "Recorded (simulated)" : phase === "playing" ? `Playing simulated recording · ${fmtClock(secs)}` : "Not recorded"}
        </span>
      </div>
      {phase === "failed" && <Banner tone="error" title="Simulated recording failed" live="assertive">No microphone is involved — this is a demo failure state. Try again.</Banner>}
      <p className="t-meta">No microphone permission is requested. Recording, playback and timing are simulated.</p>
    </div>
  );
}

function Speak() {
  const forced = useApp((s) => s.ss["SCR-PRA-03"]);
  const [recorded, setRecorded] = useState(false);
  const [phase, setPhase] = useState<"task" | "loading" | "feedback" | "failed" | "done">("task");
  useEffect(() => {
    if (forced === "feedback" || forced === "done") { setRecorded(true); setPhase(forced); }
  }, [forced]);
  const getFb = () => {
    setPhase("loading");
    simulate("speak", 1200, true).then(() => setPhase("feedback")).catch(() => setPhase("failed"));
  };
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Speak" eyebrow="Recording practice · Unofficial speaking simulation" desc="Answer out loud. No examiner is present and no recording leaves this page." />
      <div className="stack gap-5">
        <div className="stack gap-2">
          <p className="t-label">Task</p>
          <p lang="fr" className="t-strong">{SPEAK_TASK.prompt}</p>
          <p className="t-support">{SPEAK_TASK.promptEn} Speak for about one minute.</p>
        </div>
        {phase === "done" ? (
          <Banner tone="success" title="Speaking practice complete" actions={<Button kind="primary" onClick={() => go("practice")}>Back to Practice</Button>}>Saved to your practice records.</Banner>
        ) : (
          <>
            <SimRecorder id="speak" onRecorded={() => setRecorded(true)} />
            {phase === "loading" && <Spinner label="Preparing feedback…" />}
            {phase === "failed" && <Banner tone="error" title="Feedback didn’t load" live="assertive">Your simulated recording is kept.</Banner>}
            {phase === "feedback" && (
              <div className="stack gap-2">
                <span className="ai-label"><Sparkles aria-hidden width={12} height={12} /> AI-style demo feedback · Not an official assessment</span>
                <ul className="stack gap-1" style={{ paddingLeft: 20 }}>
                  <li>Clear structure: you describe what you like, then what you’d change.</li>
                  <li>Try linking words such as <span lang="fr">“par contre”</span> and <span lang="fr">“en plus”</span>.</li>
                </ul>
                <p className="t-meta">Pronunciation isn’t evaluated in this prototype. No score or level is given.</p>
              </div>
            )}
            <div className="btn-row">
              {phase === "feedback" ? (
                <Button kind="primary" onClick={() => setPhase("done")}>Finish</Button>
              ) : (
                <Button kind="primary" onClick={getFb} busy={phase === "loading"} disabledReason={!recorded ? "Record an answer first." : undefined}>{phase === "failed" ? "Retry" : "Get feedback"}</Button>
              )}
            </div>
            {!recorded && <DisabledReason>Record an answer first.</DisabledReason>}
          </>
        )}
      </div>
    </div>
  );
}

/* SCR-PRA-04 */
function Listen() {
  const p = useApp((s) => s.player);
  const forced = useApp((s) => s.ss["SCR-PRA-04"]);
  const [ans, setAns] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (forced === "checked") { setAns({ lq1: 1, lq2: 0 }); setChecked(true); }
    if (forced === "done") setDone(true);
  }, [forced]);
  const mine = p?.owner.kind === "practice" ? p : null;
  const all = LISTEN_TASK.questions.every((q) => ans[q.id] !== undefined);
  const correct = LISTEN_TASK.questions.filter((q) => ans[q.id] === q.answer).length;
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Listen" eyebrow="Guided listening" desc="Play the clip as many times as you like, then answer the questions." />
      <div className="stack gap-5">
        <div className="stack gap-3" role="group" aria-label="Listening clip player">
          <p className="t-strong" lang="fr">{LISTEN_TASK.title}</p>
          <div className="btn-row">
            <Button kind="secondary" icon={mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />} busy={mine?.status === "loading"} onClick={() => {
              if (!mine) return startPlayback({ kind: "practice", label: "Listening clip", route: "practice/listen" }, 14);
              if (mine.status === "playing") return updatePlayer({ status: "paused" });
              if (mine.status === "error") return retryPlayback();
              updatePlayer({ status: "playing", position: mine.status === "ended" ? 0 : mine.position });
            }}>
              {mine?.status === "playing" ? "Pause clip" : mine?.status === "ended" ? "Replay clip" : "Play clip"}
            </Button>
            <span className="t-support num">{mine ? `${fmtClock(mine.position)} / ${fmtClock(mine.duration)}` : "0:14"}</span>
            <Pill tone="demo">Simulated audio</Pill>
          </div>
          {mine?.status === "error" && <Banner tone="error" title="The clip couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>Your answers are kept.</Banner>}
        </div>
        {done ? (
          <Banner tone="success" title="Listening practice complete" actions={<Button kind="primary" onClick={() => go("practice")}>Back to Practice</Button>}>
            {correct} of {LISTEN_TASK.questions.length} sample questions correct. This is practice, not a score.
          </Banner>
        ) : (
          <>
            {LISTEN_TASK.questions.map((q, qi) => (
              <fieldset key={q.id} className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="t-strong" style={{ marginBottom: 8 }}>Question {qi + 1}. {q.q}</legend>
                {q.options.map((o, i) => (
                  <label key={o} className="option">
                    <input type="radio" name={q.id} checked={ans[q.id] === i} disabled={checked} onChange={() => setAns({ ...ans, [q.id]: i })} />
                    <span>{o}{checked && i === q.answer ? " — correct answer" : ""}{checked && ans[q.id] === i && i !== q.answer ? " — your answer" : ""}</span>
                  </label>
                ))}
                {checked && (
                  <p className={ans[q.id] === q.answer ? "banner banner--success" : "banner banner--error"}>
                    {ans[q.id] === q.answer ? "Correct." : "Not this time."} {q.why}
                  </p>
                )}
              </fieldset>
            ))}
            {checked && (
              <div className="stack gap-1">
                <span className="def-label">Transcript</span>
                <p lang="fr">{LISTEN_TASK.transcript}</p>
              </div>
            )}
            <div className="btn-row">
              {checked ? (
                <>
                  <Button kind="primary" onClick={() => setDone(true)}>Finish</Button>
                  <Button kind="secondary" onClick={() => { setChecked(false); setAns({}); }}>Try again</Button>
                </>
              ) : (
                <Button kind="primary" onClick={() => { setChecked(true); announce(`${correct} of ${LISTEN_TASK.questions.length} correct.`); }} disabledReason={!all ? "Answer every question first." : undefined}>Check answers</Button>
              )}
            </div>
            {!all && !checked && <DisabledReason>Answer every question first.</DisabledReason>}
          </>
        )}
      </div>
    </div>
  );
}

/* SCR-PRA-05 */
function Studio() {
  const forced = useApp((s) => s.ss["SCR-PRA-05"]);
  const p = useApp((s) => s.player);
  const [src, setSrc] = useState<string>("st1");
  const [own, setOwn] = useDraft("studio");
  const [phase, setPhase] = useState<"choose" | "preparing" | "error" | "ready">("choose");
  useEffect(() => {
    if (forced) setPhase(forced as typeof phase);
  }, [forced]);
  const text = src === "own" ? own : STUDIO_SAMPLES.find((s) => s.id === src)!.text;
  const mine = p?.owner.kind === "studio" ? p : null;
  const prepare = () => {
    setPhase("preparing");
    simulate("studio", 1400, true).then(() => { setPhase("ready"); announce("Audio ready to play (simulated)."); }).catch(() => { setPhase("error"); announce("Audio preparation failed.", true); });
  };
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Audio Studio" desc="A tool for preparing listening material: choose a sample or paste your own French, then prepare audio to listen to." />
      <div className="stack gap-5">
        <Segmented label="Text source" value={src} onChange={(v) => { setSrc(v); setPhase("choose"); }} options={[...STUDIO_SAMPLES.map((s) => ({ value: s.id, label: s.title })), { value: "own", label: "My own text" }]} />
        {src === "own" ? (
          <div className="field">
            <label htmlFor="studio-ta" className="field-label">French text</label>
            <textarea id="studio-ta" className="textarea" lang="fr" rows={4} value={own} onChange={(e) => setOwn(e.target.value)} />
          </div>
        ) : (
          <p lang="fr" className="t-fr-lg" style={{ fontSize: 20 }}>{text}</p>
        )}
        <p className="t-support">Voice: Canadian French · Demo voice · same voice every time</p>
        {phase === "preparing" && <Spinner label="Preparing audio…" />}
        {phase === "error" && <Banner tone="error" title="Audio preparation failed" live="assertive">Your text is kept. Try again.</Banner>}
        {phase === "ready" ? (
          <div className="stack gap-3">
            <Banner tone="success" title="Audio ready (simulated)" />
            <div className="btn-row">
              <Button kind="primary" icon={mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />} busy={mine?.status === "loading"} onClick={() => {
                if (!mine) return startPlayback({ kind: "studio", label: "Audio Studio · prepared text", route: "practice/studio" }, 8);
                if (mine.status === "playing") return updatePlayer({ status: "paused" });
                if (mine.status === "error") return retryPlayback();
                updatePlayer({ status: "playing", position: mine.status === "ended" ? 0 : mine.position });
              }}>
                {mine?.status === "playing" ? "Pause" : mine?.status === "ended" ? "Play again" : "Play"}
              </Button>
              <span className="t-support num">{mine ? `${mine.status === "playing" ? "Playing" : mine.status === "ended" ? "Ended" : mine.status === "error" ? "Couldn’t play" : "Paused"} · ${fmtClock(mine.position)} / ${fmtClock(mine.duration)}` : "Ready"}</span>
              <Button kind="tertiary" onClick={() => setPhase("choose")}>Prepare different text</Button>
            </div>
            {mine?.status === "error" && <Banner tone="error" title="Couldn’t play" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>} />}
          </div>
        ) : (
          <div className="btn-row">
            <Button kind="primary" busy={phase === "preparing"} onClick={prepare} disabledReason={!text.trim() ? "Add some French text first." : undefined}>{phase === "error" ? "Retry" : "Prepare audio"}</Button>
          </div>
        )}
        <p className="row"><DemoNote>Generated speech is simulated. No audio service is called.</DemoNote></p>
      </div>
    </div>
  );
}
