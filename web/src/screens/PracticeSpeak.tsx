/* SCR-PRA-03 Speaking practice: record → transcript → hints → say it again → corrections. */
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import {
  type ExamTask,
  type SpeakAttempt,
  type SpeakSubject,
  type SpeakTasks,
  type Turn,
  getSpeakAttempt,
  getSpeakTasks,
  roleplayReply,
  submitSpeak,
  submitSpeakRound2,
  waitForFeedback,
  wordCount,
} from "../api/practice";
import { fmtClock } from "../lib/format";
import { announce, go, set, startPlayback, useApp } from "../state/store";
import { Banner, Button, PageHead, Pill, Segmented, Spinner } from "../components/ui";
import { Recorder, type Recording } from "../components/Recorder";
import { AiLabel, Checklist, ErrorHints, Round2 } from "./PracticeFeedback";
import { BackTo } from "./Practice";

const TASKS: ExamTask[] = ["T1", "T2", "T3"];

function useDraft(key: string): [string, (v: string) => void] {
  const v = useApp((s) => s.drafts[key] ?? "");
  return [v, (nv: string) => set((s) => ({ drafts: { ...s.drafts, [key]: nv } }))];
}

type Phase = "answer" | "wait1" | "round1" | "wait2" | "round2";

function phaseOf(a: SpeakAttempt): Phase {
  if (a.status === "generating_1") return "wait1";
  if (a.status === "generating_2") return "wait2";
  if (a.transcript_2 && Object.keys(a.feedback_2 ?? {}).length) return "round2";
  return Object.keys(a.feedback_1 ?? {}).length ? "round1" : "answer";
}

const say = (text: string) => startPlayback({ kind: "practice", label: "Examiner", route: "practice/speak" }, Math.max(2, text.length / 14), { texts: [text] });

export function Speak() {
  const [data, setData] = useState<SpeakTasks | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [task, setTask] = useState<ExamTask>("T1");
  const [subject, setSubject] = useState<SpeakSubject | null>(null);
  const [transcript, setTranscript] = useDraft("speak");
  const [retake, setRetake] = useDraft("speak:round2");
  const [attemptId, setAttemptId] = useDraft("speak:attempt");
  const [audioSecs, setAudioSecs] = useState(0);
  const [retakeSecs, setRetakeSecs] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyErr, setReplyErr] = useState("");
  const [attempt, setAttempt] = useState<SpeakAttempt | null>(null);
  const [phase, setPhase] = useState<Phase>("answer");
  const [error, setError] = useState("");
  const since = useRef(Date.now());
  const poll = useRef<AbortController | null>(null);

  const load = () => {
    setLoadErr("");
    getSpeakTasks()
      .then((d) => {
        setData(d);
        if (attemptId) return;
        setTask(d.recommended_task);
        setSubject((s) => s ?? d.subjects[d.recommended_task]?.[0] ?? null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn’t load the speaking tasks."));
  };

  useEffect(() => {
    load();
    if (attemptId) getSpeakAttempt(attemptId).then(show).catch(() => setAttemptId(""));
    return () => poll.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (a: SpeakAttempt) => {
    setAttempt(a);
    setTask((TASKS as string[]).includes(a.task) ? (a.task as ExamTask) : "T1");
    setSubject(a.subject);
    const p = phaseOf(a);
    setPhase(p);
    if (a.status === "failed") setError(a.error || "The AI feedback failed. Try again.");
    if (p === "wait1" || p === "wait2") void follow(a.id, p === "wait1" ? 1 : 2);
  };

  const follow = async (id: string, round: 1 | 2) => {
    poll.current?.abort();
    const ctl = new AbortController();
    poll.current = ctl;
    setPhase(round === 1 ? "wait1" : "wait2");
    setError("");
    try {
      const a = await waitForFeedback(() => getSpeakAttempt(id), round, { signal: ctl.signal });
      setAttempt(a);
      setPhase(round === 1 ? "round1" : "round2");
      announce("Feedback ready.");
      requestAnimationFrame(() => document.getElementById("speak-fb")?.focus());
    } catch (e) {
      if (ctl.signal.aborted) return;
      setPhase(round === 1 ? "answer" : "round1");
      setError(e instanceof Error ? e.message : "Feedback didn’t load.");
      announce("Feedback didn’t load. Your transcript is kept.", true);
    }
  };

  const spec = data?.tasks[task];
  const level = data?.recommended_level ?? "A1";
  const subj = subject ?? data?.subjects[task]?.[0] ?? null;

  const onTake = async (r: Recording) => {
    setAudioSecs((s) => s + r.seconds);
    setTranscript(transcript ? `${transcript}${task === "T2" ? "\n" : " "}${r.text}` : r.text);
    if (task !== "T2" || !subj) return;
    // Role-play: the examiner answers each question the learner asks.
    const history = turns;
    setTurns([...history, { role: "user", content: r.text }]);
    setReplyBusy(true);
    setReplyErr("");
    try {
      const { reply } = await roleplayReply(subj, history, r.text);
      if (reply) {
        setTurns((t) => [...t, { role: "assistant", content: reply }]);
        say(reply);
      }
    } catch (e) {
      setReplyErr(e instanceof Error ? e.message : "The examiner didn’t answer.");
    } finally {
      setReplyBusy(false);
    }
  };

  const submit1 = async () => {
    if (!subj) return;
    if (!transcript.trim()) {
      setError("Record or type your answer first. Nothing was sent.");
      return;
    }
    setError("");
    setPhase("wait1");
    const seconds = Math.min(7200, Math.round((Date.now() - since.current) / 1000));
    try {
      const a = await submitSpeak(task, subj, level, transcript.trim(), seconds, audioSecs || estimate(transcript));
      setAttempt(a);
      setAttemptId(a.id);
      since.current = Date.now();
      void follow(a.id, 1);
    } catch (e) {
      setPhase("answer");
      setError(e instanceof Error ? e.message : "Couldn’t send your answer.");
    }
  };

  const submit2 = async () => {
    if (!attempt || !retake.trim()) return;
    setError("");
    setPhase("wait2");
    const seconds = Math.min(7200, Math.round((Date.now() - since.current) / 1000));
    try {
      const a = await submitSpeakRound2(attempt.id, retake.trim(), seconds, retakeSecs || estimate(retake));
      setAttempt(a);
      void follow(a.id, 2);
    } catch (e) {
      setPhase("round1");
      setError(e instanceof Error ? e.message : "Couldn’t send your second take.");
    }
  };

  const reset = () => {
    poll.current?.abort();
    setAttempt(null);
    setAttemptId("");
    setTranscript("");
    setRetake("");
    setAudioSecs(0);
    setRetakeSecs(0);
    setTurns([]);
    setPhase("answer");
    setError("");
    since.current = Date.now();
  };

  if (!data) {
    return (
      <div className="page">
        <PageHead back={<BackTo label="Practice" to="practice" />} title="Speak" desc="TCF Canada speaking tasks: answer out loud, then fix it with feedback." />
        {loadErr ? <Banner tone="error" title="Couldn’t load the speaking tasks" live="assertive" actions={<Button kind="secondary" onClick={load}>Retry</Button>}>{loadErr}</Banner> : <Spinner label="Loading tasks…" />}
      </div>
    );
  }

  const builtIns = data.subjects[task] ?? [];
  const answering = phase === "answer" || phase === "wait1";
  return (
    <div className="page">
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Speak"
        eyebrow="Expression orale · practice"
        desc="Answer out loud. Your voice is transcribed on our server and only the text is kept; you can correct the text before sending it."
      />
      <div className="stack gap-5">
        {answering && !attempt && (
          <div className="stack gap-3">
            <Segmented
              label="Task"
              value={task}
              onChange={(t) => { setTask(t); setSubject(data.subjects[t]?.[0] ?? null); setTurns([]); }}
              options={TASKS.map((t) => ({ value: t, label: t === data.recommended_task ? `${t} · suggested` : t }))}
            />
            <label className="field" style={{ maxWidth: 480 }}>
              <span className="field-label">Subject</span>
              <select className="select" value={subj?.id ?? ""} onChange={(e) => { const s = builtIns.find((x) => x.id === e.target.value); if (s) { setSubject(s); setTurns([]); } }}>
                {builtIns.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
          </div>
        )}

        {subj && spec && (
          <section className="panel stack gap-2" aria-label="Subject">
            <p className="t-label">{spec.name_en}</p>
            <p lang="fr" className="t-strong">{subj.title}</p>
            <p lang="fr">{subj.prompt}</p>
            {task === "T1" && !!subj.questions?.length && (
              <ol className="stack gap-1" style={{ paddingLeft: 20 }}>
                {subj.questions.map((q, i) => (
                  <li key={i} lang="fr">
                    {q}{" "}
                    <Button kind="tertiary" iconOnly icon={<Volume2 aria-hidden />} aria-label={`Listen to question ${i + 1}`} onClick={() => say(q)} />
                  </li>
                ))}
              </ol>
            )}
            {task === "T2" && !!subj.target_points?.length && <p className="t-support">Find out about: <span lang="fr">{subj.target_points.join(" · ")}</span></p>}
            {task === "T3" && !!subj.structure_hints?.length && <p className="t-support">Plan: <span lang="fr">{subj.structure_hints.join(" · ")}</span></p>}
            <p className="t-meta">About {fmtClock(spec.timer_seconds)} in the exam. {spec.desc_en}</p>
          </section>
        )}

        {answering ? (
          <>
            {task === "T2" && turns.length > 0 && <Dialogue turns={turns} />}
            {replyBusy && <Spinner label="The examiner is answering…" />}
            {replyErr && <Banner tone="warning" title="The examiner didn’t answer">{replyErr} Ask your next question or send what you have.</Banner>}
            <Recorder label={task === "T2" ? "Ask the examiner a question" : "Record your answer"} onText={(r) => void onTake(r)} disabled={phase === "wait1"} />
            <div className="field">
              <label htmlFor="speak-ta" className="field-label">Transcript (you can correct it or type)</label>
              <textarea id="speak-ta" className="textarea" lang="fr" rows={6} value={transcript} readOnly={phase === "wait1"} onChange={(e) => { setTranscript(e.target.value); setError(""); }} />
              <p className="counter">{wordCount(transcript)} words{audioSecs ? ` · ${fmtClock(audioSecs)} recorded` : ""}</p>
            </div>
            {error && <Banner tone="error" title="Feedback didn’t load" live="assertive">{error}</Banner>}
            {phase === "wait1" && <Spinner label="Listening to your answer… this usually takes 10–40 seconds." />}
            <div className="btn-row">
              <Button kind="primary" busy={phase === "wait1"} disabledReason={!transcript.trim() ? "Record or type your answer first." : undefined} onClick={() => void submit1()}>
                {error ? "Retry" : "Get feedback"}
              </Button>
              {(transcript || turns.length > 0) && phase === "answer" && <Button kind="tertiary" onClick={reset}>Clear</Button>}
            </div>
          </>
        ) : (
          attempt && (
            <div className="stack gap-5">
              <div id="speak-fb" tabIndex={-1} className="stack gap-4">
                <AiLabel />
                <div className="stack gap-1">
                  <span className="def-label">What you said</span>
                  <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.transcript_1}</p>
                </div>
                <Round1 a={attempt} />
              </div>
              <hr className="divider" />
              {phase === "round2" ? (
                <div className="stack gap-4">
                  <p className="t-section">Round 2 · corrections</p>
                  <div className="stack gap-1">
                    <span className="def-label">Your second take</span>
                    <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.transcript_2}</p>
                  </div>
                  <Round2 fb={attempt.feedback_2} correctedLabel="Corrected transcript" />
                  <Banner tone="success" title="Speaking practice complete" actions={<><Button kind="primary" onClick={reset}>Speak again</Button><Button kind="secondary" onClick={() => go("practice")}>Back to Practice</Button></>}>
                    Saved to your speaking attempts.
                  </Banner>
                </div>
              ) : (
                <div className="stack gap-3">
                  <p className="t-section">Round 2 · say it again</p>
                  <p className="t-support">Use the hints above and answer again out loud. Then send your second take for corrections.</p>
                  <Recorder label="Record your second take" onText={(r) => { setRetakeSecs((s) => s + r.seconds); setRetake(retake ? `${retake} ${r.text}` : r.text); }} disabled={phase === "wait2"} />
                  <div className="field">
                    <label htmlFor="speak-rev" className="field-label">Second take transcript</label>
                    <textarea id="speak-rev" className="textarea" lang="fr" rows={6} value={retake} readOnly={phase === "wait2"} onChange={(e) => { setRetake(e.target.value); setError(""); }} />
                  </div>
                  {error && <Banner tone="error" title="Corrections didn’t load" live="assertive">{error}</Banner>}
                  {phase === "wait2" && <Spinner label="Checking your second take…" />}
                  <div className="btn-row">
                    <Button kind="primary" busy={phase === "wait2"} disabledReason={!retake.trim() ? "Record or type your second take first." : undefined} onClick={() => void submit2()}>
                      {error ? "Retry" : "Get corrections"}
                    </Button>
                    <Button kind="tertiary" onClick={reset}>Start over</Button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Rough speaking time for typed answers (about 2 words per second). */
const estimate = (t: string) => Math.max(1, Math.round(wordCount(t) / 2));

function Dialogue({ turns }: { turns: Turn[] }) {
  return (
    <ol className="list" aria-label="Role-play so far">
      {turns.map((t, i) => (
        <li key={i} className="list-row row--top">
          <Pill tone={t.role === "user" ? "info" : undefined}>{t.role === "user" ? "You" : "Examiner"}</Pill>
          <span lang="fr" className="grow">{t.content}</span>
          {t.role === "assistant" && <Button kind="tertiary" iconOnly icon={<Volume2 aria-hidden />} aria-label="Listen again" onClick={() => say(t.content)} />}
        </li>
      ))}
    </ol>
  );
}

function Round1({ a }: { a: SpeakAttempt }) {
  const fb = a.feedback_1;
  if (!fb || !Object.keys(fb).length) return null;
  const t3 = fb.t3_structure;
  return (
    <div className="stack gap-4">
      {fb.praise && <p><span className="t-strong">What works · </span>{fb.praise}</p>}
      {fb.stats && (
        <p className="row gap-2">
          <Pill>{Math.round(fb.stats.wpm)} words/min</Pill>
          <span className="t-support">{fb.stats.pace_note}</span>
        </p>
      )}
      {fb.t2_questions && (
        <p className="row gap-2">
          <Pill tone={fb.t2_questions.forms_ok ? "success" : "warning"}>{fb.t2_questions.count} questions asked</Pill>
          <span className="t-support">{fb.t2_questions.note}</span>
        </p>
      )}
      {t3 && (
        <p className="row gap-2">
          {(["opinion", "arguments", "example", "conclusion"] as const).map((k) => <Pill key={k} tone={t3[k] ? "success" : "warning"}>{k}</Pill>)}
          <span className="t-support">{t3.note}</span>
        </p>
      )}
      <Checklist items={fb.checklist} />
      <ErrorHints errors={fb.errors} />
    </div>
  );
}
