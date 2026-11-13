/* SCR-PRA-03 Speaking practice: record → transcript → hints → say it again → corrections. */
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2 } from "lucide-react";
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
import { PageHead, Spinner, Textarea, pageFrame } from "../components/ui";
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
  const sendRef = useRef<HTMLButtonElement>(null);
  const retakeRef = useRef<HTMLButtonElement>(null);

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
      <div className={pageFrame()}>
        <PageHead back={<BackTo label="Practice" to="practice" />} title="Speak" />
        {loadErr ? <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t load the speaking tasks</AlertTitle><AlertDescription>{loadErr}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={load}>Retry</Button></div></AlertDescription></Alert> : <Spinner label="Loading tasks…" />}
      </div>
    );
  }

  const builtIns = data.subjects[task] ?? [];
  const answering = phase === "answer" || phase === "wait1";
  return (
    <div className={pageFrame()}>
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Speak"
        eyebrow="Expression orale · practice"
      />
      <div className="flex flex-col gap-6">
        {answering && !attempt && (
          <div className="flex flex-col gap-3">
            <ToggleGroup type="single" variant="outline" value={task} onValueChange={(next) => { if (next && (TASKS as readonly string[]).includes(next)) { const t = next as ExamTask; setTask(t); setSubject(data.subjects[t]?.[0] ?? null); setTurns([]); } }} aria-label="Task">{(TASKS.map((t) => ({ value: t, label: t === data.recommended_task ? `${t} · suggested` : t }))).map((o) => (<ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>))}</ToggleGroup>
            <label className="grid gap-2" style={{ maxWidth: 480 }}>
              <span className="text-sm font-medium">Subject</span>
              <Select value={subj && builtIns.some((s) => s.id === subj.id) ? subj.id : (builtIns[0]?.id ?? "subject")} onValueChange={(v) => { const s = builtIns.find((x) => x.id === v); if (s) { setSubject(s); setTurns([]); } }}><SelectTrigger aria-label={"Subject"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(builtIns.map((s) => ({ value: s.id, label: s.title }))).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
            </label>
          </div>
        )}

        {subj && spec && (
          <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2" aria-label="Subject">
            <p className="text-sm font-medium">{spec.name_en}</p>
            <p lang="fr" className="font-medium">{subj.title}</p>
            <p lang="fr">{subj.prompt}</p>
            {task === "T1" && !!subj.questions?.length && (
              <ol className="flex flex-col gap-1" style={{ paddingLeft: 20 }}>
                {subj.questions.map((q, i) => (
                  <li key={i} lang="fr">
                    {q}{" "}
                    <Button type="button" variant="ghost" size="icon" aria-label={`Listen to question ${i + 1}`} onClick={() => say(q)}>{<Volume2 aria-hidden />}</Button>
                  </li>
                ))}
              </ol>
            )}
            {task === "T2" && !!subj.target_points?.length && <p className="text-sm text-muted-foreground">Find out about: <span lang="fr">{subj.target_points.join(" · ")}</span></p>}
            {task === "T3" && !!subj.structure_hints?.length && <p className="text-sm text-muted-foreground">Plan: <span lang="fr">{subj.structure_hints.join(" · ")}</span></p>}
            <p className="text-xs leading-4 text-muted-foreground tabular-nums">About {fmtClock(spec.timer_seconds)}</p>
          </section>
        )}

        {answering ? (
          <>
            {task === "T2" && turns.length > 0 && <Dialogue turns={turns} />}
            {replyBusy && <Spinner label="The examiner is answering…" />}
            {replyErr && <Alert variant="default"><AlertTitle>The examiner didn’t answer</AlertTitle><AlertDescription>{replyErr} Ask your next question or send what you have.</AlertDescription></Alert>}
            <Recorder label={task === "T2" ? "Ask the examiner a question" : "Record your answer"} onText={(r) => void onTake(r)} disabled={phase === "wait1"} />
            <div className="grid gap-2">
              <label htmlFor="speak-ta" className="text-sm font-medium">Transcript (you can correct it or type)</label>
              <Textarea id="speak-ta" onCmdEnter={() => sendRef.current?.click()} lang="fr" rows={6} value={transcript} readOnly={phase === "wait1"} onChange={(e) => { setTranscript(e.target.value); setError(""); }} />
              <p className="text-sm tabular-nums text-muted-foreground">{wordCount(transcript)} words{audioSecs ? ` · ${fmtClock(audioSecs)} recorded` : ""}</p>
            </div>
            {error && <Alert variant="destructive" role="alert"><AlertTitle>Feedback didn’t load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {phase === "wait1" && <Spinner label="Listening to your answer… this usually takes 10–40 seconds." />}
            <div className="flex flex-wrap items-center gap-2">
              <Button ref={sendRef} type="button" variant="default" aria-disabled={(!!(phase === "wait1") || !!(!transcript.trim() ? "Record or type your answer first." : undefined)) || undefined} aria-busy={phase === "wait1" || undefined} className={cn((!!(phase === "wait1") || !!(!transcript.trim() ? "Record or type your answer first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "wait1") || !!(!transcript.trim() ? "Record or type your answer first." : undefined)) { event.preventDefault(); return; } (() => void submit1())(); }}>{phase === "wait1" ? <Loader2 className="animate-spin" aria-hidden /> : null}{error ? "Retry" : "Get feedback"}{(!transcript.trim() ? "Record or type your answer first." : undefined) ? <span className="sr-only">{!transcript.trim() ? "Record or type your answer first." : undefined}</span> : null}</Button>
              {(transcript || turns.length > 0) && phase === "answer" && <Button type="button" variant="ghost" onClick={reset}>Clear</Button>}
            </div>
          </>
        ) : (
          attempt && (
            <div className="flex flex-col gap-6">
              <div id="speak-fb" tabIndex={-1} className="flex flex-col gap-4">
                <AiLabel />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">What you said</span>
                  <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.transcript_1}</p>
                </div>
                <Round1 a={attempt} />
              </div>
              <hr className="border-t" />
              {phase === "round2" ? (
                <div className="flex flex-col gap-4">
                  <p className="text-lg font-semibold text-balance">Round 2 · corrections</p>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-muted-foreground">Your second take</span>
                    <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.transcript_2}</p>
                  </div>
                  <Round2 fb={attempt.feedback_2} correctedLabel="Corrected transcript" />
                  <Alert variant="default"><AlertTitle>Speaking practice complete</AlertTitle><AlertDescription>Saved to your speaking attempts.<div className="mt-3 flex flex-wrap items-center gap-2"><><Button type="button" variant="default" onClick={reset}>Speak again</Button><Button type="button" variant="outline" onClick={() => go("practice")}>Back to Practice</Button></></div></AlertDescription></Alert>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-semibold text-balance">Round 2 · say it again</p>
                  <Recorder label="Record your second take" onText={(r) => { setRetakeSecs((s) => s + r.seconds); setRetake(retake ? `${retake} ${r.text}` : r.text); }} disabled={phase === "wait2"} />
                  <div className="grid gap-2">
                    <label htmlFor="speak-rev" className="text-sm font-medium">Second take transcript</label>
                    <Textarea id="speak-rev" onCmdEnter={() => retakeRef.current?.click()} lang="fr" rows={6} value={retake} readOnly={phase === "wait2"} onChange={(e) => { setRetake(e.target.value); setError(""); }} />
                  </div>
                  {error && <Alert variant="destructive" role="alert"><AlertTitle>Corrections didn’t load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                  {phase === "wait2" && <Spinner label="Checking your second take…" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button ref={retakeRef} type="button" variant="default" aria-disabled={(!!(phase === "wait2") || !!(!retake.trim() ? "Record or type your second take first." : undefined)) || undefined} aria-busy={phase === "wait2" || undefined} className={cn((!!(phase === "wait2") || !!(!retake.trim() ? "Record or type your second take first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "wait2") || !!(!retake.trim() ? "Record or type your second take first." : undefined)) { event.preventDefault(); return; } (() => void submit2())(); }}>{phase === "wait2" ? <Loader2 className="animate-spin" aria-hidden /> : null}{error ? "Retry" : "Get corrections"}{(!retake.trim() ? "Record or type your second take first." : undefined) ? <span className="sr-only">{!retake.trim() ? "Record or type your second take first." : undefined}</span> : null}</Button>
                    <Button type="button" variant="ghost" onClick={reset}>Start over</Button>
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
    <ol className="divide-y overflow-hidden rounded-lg border" aria-label="Role-play so far">
      {turns.map((t, i) => (
        <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-3 items-start">
          <Badge variant={t.role === "user" ? "secondary" : "outline"}>{t.role === "user" ? "You" : "Examiner"}</Badge>
          <span lang="fr" className="min-w-0 flex-1">{t.content}</span>
          {t.role === "assistant" && <Button type="button" variant="ghost" size="icon" aria-label="Listen again" onClick={() => say(t.content)}>{<Volume2 aria-hidden />}</Button>}
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
    <div className="flex flex-col gap-4">
      {fb.praise && <p><span className="font-medium">What works · </span>{fb.praise}</p>}
      {fb.stats && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          <Badge variant="outline">{Math.round(fb.stats.wpm)} words/min</Badge>
          <span className="text-sm text-muted-foreground">{fb.stats.pace_note}</span>
        </p>
      )}
      {fb.t2_questions && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          <Badge variant={fb.t2_questions.forms_ok ? "secondary" : "outline"}>{fb.t2_questions.count} questions asked</Badge>
          <span className="text-sm text-muted-foreground">{fb.t2_questions.note}</span>
        </p>
      )}
      {t3 && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          {(["opinion", "arguments", "example", "conclusion"] as const).map((k) => <Badge variant={t3[k] ? "secondary" : "outline"}>{k}</Badge>)}
          <span className="text-sm text-muted-foreground">{t3.note}</span>
        </p>
      )}
      <Checklist items={fb.checklist} />
      <ErrorHints errors={fb.errors} />
    </div>
  );
}
