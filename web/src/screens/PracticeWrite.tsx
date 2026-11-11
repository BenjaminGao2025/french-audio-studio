/* SCR-PRA-02 Writing practice: TCF Canada tasks, two feedback rounds (hints, then corrections). */
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  type ExamTask,
  type WriteAttempt,
  type WriteSubject,
  type WriteTasks,
  getWriteAttempt,
  getWriteTasks,
  newWriteSubject,
  submitWrite,
  submitWriteRound2,
  waitForFeedback,
  wordCount,
} from "../api/practice";
import { fmtWhen } from "../api/history";
import { announce, go, set, useApp } from "../state/store";
import { PageHead, Spinner, Textarea, pageFrame } from "../components/ui";
import { AiLabel, Checklist, ErrorHints, Round2 } from "./PracticeFeedback";
import { BackTo } from "./Practice";

const TASKS: ExamTask[] = ["T1", "T2", "T3"];

function useDraft(key: string): [string, (v: string) => void] {
  const v = useApp((s) => s.drafts[key] ?? "");
  return [v, (nv: string) => set((s) => ({ drafts: { ...s.drafts, [key]: nv } }))];
}

/** Seconds spent with the page open since the last submit (sent with the attempt, as on the old page). */
function useElapsed() {
  const since = useRef(Date.now());
  return { take: () => { const s = Math.round((Date.now() - since.current) / 1000); since.current = Date.now(); return Math.min(s, 7200); } };
}

type Phase = "draft" | "wait1" | "round1" | "wait2" | "round2";

function phaseOf(a: WriteAttempt): Phase {
  if (a.status === "generating_1") return "wait1";
  if (a.status === "generating_2") return "wait2";
  if (a.text_2 && Object.keys(a.feedback_2 ?? {}).length) return "round2";
  if (a.text_2 && a.status === "failed") return "round1";
  return Object.keys(a.feedback_1 ?? {}).length ? "round1" : "draft";
}

export function Write() {
  const [data, setData] = useState<WriteTasks | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [task, setTask] = useState<ExamTask>("T1");
  const [subject, setSubject] = useState<WriteSubject | null>(null);
  const [draft, setDraft] = useDraft("write");
  const [revision, setRevision] = useDraft("write:revision");
  const [attemptId, setAttemptId] = useDraft("write:attempt");
  const [attempt, setAttempt] = useState<WriteAttempt | null>(null);
  const [phase, setPhase] = useState<Phase>("draft");
  const [error, setError] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const elapsed = useElapsed();
  const poll = useRef<AbortController | null>(null);

  const load = () => {
    setLoadErr("");
    getWriteTasks()
      .then((d) => {
        setData(d);
        if (attemptId) return; // The resumed attempt sets its own task and subject.
        setTask(d.recommended_task);
        setSubject((s) => s ?? d.subjects[d.recommended_task]?.[0] ?? null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn’t load the writing tasks."));
  };

  // Resume the attempt this device was working on (feedback may have finished while away).
  useEffect(() => {
    load();
    if (attemptId) {
      getWriteAttempt(attemptId)
        .then((a) => show(a, true))
        .catch(() => setAttemptId(""));
    }
    return () => poll.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (a: WriteAttempt, resume = false) => {
    setAttempt(a);
    setTask((TASKS as string[]).includes(a.task) ? (a.task as ExamTask) : "T1");
    setSubject(a.subject);
    const p = phaseOf(a);
    setPhase(p);
    if (a.status === "failed") setError(a.error || "The AI feedback failed. Try again.");
    if (p === "wait1" || p === "wait2") void follow(a.id, p === "wait1" ? 1 : 2);
    if (resume && p === "round1" && !revision) setRevision(a.text_1);
  };

  const follow = async (id: string, round: 1 | 2) => {
    poll.current?.abort();
    const ctl = new AbortController();
    poll.current = ctl;
    setPhase(round === 1 ? "wait1" : "wait2");
    setError("");
    try {
      const a = await waitForFeedback(() => getWriteAttempt(id), round, { signal: ctl.signal });
      setAttempt(a);
      setPhase(round === 1 ? "round1" : "round2");
      if (round === 1) setRevision(a.text_1);
      announce("Feedback ready.");
      requestAnimationFrame(() => document.getElementById("write-fb")?.focus());
    } catch (e) {
      if (ctl.signal.aborted) return;
      setPhase(round === 1 ? "draft" : "round1");
      setError(e instanceof Error ? e.message : "Feedback didn’t load.");
      announce("Feedback didn’t load. Your text is kept.", true);
    }
  };

  const spec = data?.tasks[task];
  const level = data?.recommended_level ?? "A1";

  const submit1 = async () => {
    const subj = subject ?? data?.subjects[task]?.[0];
    if (!subj) return;
    if (!draft.trim()) {
      setError("Write your text before asking for feedback. Nothing was sent.");
      announce("Write your text first.", true);
      return;
    }
    setError("");
    setPhase("wait1");
    try {
      const a = await submitWrite(task, subj, level, draft.trim(), elapsed.take());
      setAttempt(a);
      setAttemptId(a.id);
      void follow(a.id, 1);
    } catch (e) {
      setPhase("draft");
      setError(e instanceof Error ? e.message : "Couldn’t send your text.");
    }
  };

  const submit2 = async () => {
    if (!attempt || !revision.trim()) return;
    setError("");
    setPhase("wait2");
    try {
      const a = await submitWriteRound2(attempt.id, revision.trim(), elapsed.take());
      setAttempt(a);
      void follow(a.id, 2);
    } catch (e) {
      setPhase("round1");
      setError(e instanceof Error ? e.message : "Couldn’t send your revision.");
    }
  };

  const reset = () => {
    poll.current?.abort();
    setAttempt(null);
    setAttemptId("");
    setDraft("");
    setRevision("");
    setPhase("draft");
    setError("");
    elapsed.take();
    getWriteTasks().then(setData).catch(() => undefined);
  };

  const generate = async () => {
    setGenBusy(true);
    setGenErr("");
    try {
      const s = await newWriteSubject(task, level);
      setSubject(s);
      announce(`New subject: ${s.title}`);
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : "Couldn’t make a new subject.");
    } finally {
      setGenBusy(false);
    }
  };

  if (!data) {
    return (
      <div className={pageFrame()}>
        <PageHead back={<BackTo label="Practice" to="practice" />} title="Write" />
        {loadErr ? <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t load the writing tasks</AlertTitle><AlertDescription>{loadErr}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={load}>Retry</Button></div></AlertDescription></Alert> : <Spinner label="Loading tasks…" />}
      </div>
    );
  }

  const builtIns = data.subjects[task] ?? [];
  const subj = subject ?? builtIns[0] ?? null;
  const editing = phase === "draft" || phase === "wait1";
  const n = wordCount(editing ? draft : revision);
  const over = spec ? n > spec.max_words : false;
  return (
    <div className={pageFrame()}>
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Write" eyebrow="Expression écrite" />
      <div className="flex flex-col gap-6">
        {editing && !attempt && (
          <div className="flex flex-col gap-3">
            <ToggleGroup type="single" variant="outline" value={task} onValueChange={(next) => { if (next && (TASKS as readonly string[]).includes(next)) { const t = next as ExamTask; setTask(t); setSubject(data.subjects[t]?.[0] ?? null); setGenErr(""); } }} aria-label="Task">{(TASKS.map((t) => ({ value: t, label: t === data.recommended_task ? `${t} · suggested` : t }))).map((o) => (<ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>))}</ToggleGroup>
            <div className="flex flex-wrap items-center gap-2 gap-3" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="grid gap-2" style={{ minWidth: 0, flex: "1 1 260px", maxWidth: 480 }}>
                <span className="text-sm font-medium">Subject</span>
                <Select value={subj && builtIns.some((s) => s.id === subj.id) ? subj.id : "custom"} onValueChange={(v) => { const s = builtIns.find((x) => x.id === v); if (s) setSubject(s); }}><SelectTrigger aria-label={"Subject"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{([
                    ...builtIns.map((s) => ({ value: s.id, label: s.title })),
                    ...(subj && !builtIns.some((s) => s.id === subj.id) ? [{ value: "custom", label: `${subj.title} (new)` }] : []),
                  ]).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
              </label>
              <Button type="button" variant="ghost" aria-disabled={(!!(genBusy)) || undefined} aria-busy={genBusy || undefined} className={cn((!!(genBusy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(genBusy)) { event.preventDefault(); return; } (() => void generate())(); }}>{genBusy ? <Loader2 className="animate-spin" aria-hidden /> : null}New subject</Button>
            </div>
            {genBusy && <Spinner label="Writing a new subject…" />}
            {genErr && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t make a new subject</AlertTitle><AlertDescription>{genErr}</AlertDescription></Alert>}
          </div>
        )}

        {subj && spec && <SubjectCard subject={subj} spec={spec} />}

        {editing ? (
          <>
            <div className="grid gap-2">
              <label htmlFor="write-ta" className="text-sm font-medium">Your text in French</label>
              <Textarea id="write-ta" lang="fr" rows={10} value={draft} readOnly={phase === "wait1"} aria-describedby="write-count" onChange={(e) => { setDraft(e.target.value); setError(""); }} />
              <p id="write-count" className={over ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {n} {n === 1 ? "word" : "words"}{spec ? ` · target ${spec.min_words}–${spec.max_words}` : ""}
              </p>
            </div>
            {error && <Alert variant="destructive" role="alert"><AlertTitle>Feedback didn’t load</AlertTitle><AlertDescription>{error} Your text is kept.</AlertDescription></Alert>}
            {phase === "wait1" && <Spinner label="Reading your text… this usually takes 10–40 seconds." />}
            <div className="sticky bottom-0 z-10 bg-background py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="default" aria-disabled={(!!(phase === "wait1")) || undefined} aria-busy={phase === "wait1" || undefined} className={cn((!!(phase === "wait1")) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "wait1")) { event.preventDefault(); return; } (() => void submit1())(); }}>{phase === "wait1" ? <Loader2 className="animate-spin" aria-hidden /> : null}{error ? "Retry" : "Get feedback"}</Button>
              </div>
            </div>
          </>
        ) : (
          attempt && (
            <div className="flex flex-col gap-6">
              <div id="write-fb" tabIndex={-1} className="flex flex-col gap-4">
                <AiLabel />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">Your first draft</span>
                  <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.text_1}</p>
                </div>
                <Round1 a={attempt} />
              </div>
              <hr className="border-t" />
              {phase === "round2" ? (
                <div className="flex flex-col gap-4">
                  <p className="text-lg font-semibold text-balance">Round 2 · corrections</p>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-muted-foreground">Your revision</span>
                    <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.text_2}</p>
                  </div>
                  <Round2 fb={attempt.feedback_2} correctedLabel="Corrected text" />
                  <Alert variant="default"><AlertTitle>Writing practice complete</AlertTitle><AlertDescription>Saved to your writing attempts.<div className="mt-3 flex flex-wrap items-center gap-2"><><Button type="button" variant="default" onClick={reset}>Write another</Button><Button type="button" variant="outline" onClick={() => go("practice")}>Back to Practice</Button></></div></AlertDescription></Alert>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-semibold text-balance">Round 2 · fix it yourself</p>
                  <div className="grid gap-2">
                    <label htmlFor="write-rev" className="text-sm font-medium">Your revised text</label>
                    <Textarea id="write-rev" lang="fr" rows={10} value={revision} readOnly={phase === "wait2"} onChange={(e) => { setRevision(e.target.value); setError(""); }} />
                    <p className={over ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{n} {n === 1 ? "word" : "words"}</p>
                  </div>
                  {error && <Alert variant="destructive" role="alert"><AlertTitle>Corrections didn’t load</AlertTitle><AlertDescription>{error} Your revision is kept.</AlertDescription></Alert>}
                  {phase === "wait2" && <Spinner label="Checking your revision…" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="default" aria-disabled={(!!(phase === "wait2") || !!(!revision.trim() ? "Write your revision first." : undefined)) || undefined} aria-busy={phase === "wait2" || undefined} className={cn((!!(phase === "wait2") || !!(!revision.trim() ? "Write your revision first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "wait2") || !!(!revision.trim() ? "Write your revision first." : undefined)) { event.preventDefault(); return; } (() => void submit2())(); }}>{phase === "wait2" ? <Loader2 className="animate-spin" aria-hidden /> : null}{error ? "Retry" : "Get corrections"}{(!revision.trim() ? "Write your revision first." : undefined) ? <span className="sr-only">{!revision.trim() ? "Write your revision first." : undefined}</span> : null}</Button>
                    <Button type="button" variant="ghost" onClick={reset}>Start over</Button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {!attempt && editing && <PastAttempts attempts={data.attempts} onOpen={(a) => { setAttemptId(a.id); show(a); }} />}
      </div>
    </div>
  );
}

function SubjectCard({ subject, spec }: { subject: WriteSubject; spec: { name_en: string; desc_en: string; min_words: number; max_words: number; part1_range?: string; part2_range?: string } }) {
  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2" aria-label="Subject">
      <p className="text-sm font-medium">{spec.name_en}</p>
      <p lang="fr" className="font-medium">{subject.title}</p>
      <p lang="fr">{subject.prompt}</p>
      {subject.doc1 && <p lang="fr" className="text-sm text-muted-foreground"><span className="font-medium">Document 1 · </span>{subject.doc1}</p>}
      {subject.doc2 && <p lang="fr" className="text-sm text-muted-foreground"><span className="font-medium">Document 2 · </span>{subject.doc2}</p>}
      {!!subject.requirements?.length && (
        <ul className="flex flex-col gap-1" style={{ paddingLeft: 20 }}>
          {subject.requirements.map((r, i) => <li key={i} lang="fr">{r}</li>)}
        </ul>
      )}
      {!!subject.stems?.length && <p lang="fr" className="text-sm text-muted-foreground">Starters: {subject.stems.join(" · ")}</p>}
      {!!subject.words?.length && <p lang="fr" className="text-sm text-muted-foreground">Words: {subject.words.join(" · ")}</p>}
      <p className="text-xs leading-4 text-muted-foreground">
        {spec.min_words}–{spec.max_words} words{spec.part1_range ? ` (comparison ${spec.part1_range}, opinion ${spec.part2_range})` : ""}. {spec.desc_en}
      </p>
    </section>
  );
}

function Round1({ a }: { a: WriteAttempt }) {
  const fb = a.feedback_1;
  if (!fb || !Object.keys(fb).length) return null;
  return (
    <div className="flex flex-col gap-4">
      {fb.praise && <p><span className="font-medium">What works · </span>{fb.praise}</p>}
      {fb.word_count && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          <Badge variant={fb.word_count.in_range ? "secondary" : "outline"}>{fb.word_count.in_range ? "Length OK" : "Length"}</Badge>
          <span className="text-sm text-muted-foreground">{fb.word_count.note}</span>
        </p>
      )}
      {fb.register?.note && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          <Badge variant={fb.register.fits ? "secondary" : "outline"}>Register · {fb.register.choice}</Badge>
          <span className="text-sm text-muted-foreground">{fb.register.note}</span>
        </p>
      )}
      {fb.t3_comparison && (
        <p className="flex flex-wrap items-center gap-2 gap-2">
          <Badge variant={fb.t3_comparison.compared && fb.t3_comparison.position_clear ? "secondary" : "outline"}>Comparison and position</Badge>
          <span className="text-sm text-muted-foreground">{fb.t3_comparison.note}</span>
        </p>
      )}
      <Checklist items={fb.checklist} />
      <ErrorHints errors={fb.errors} />
    </div>
  );
}

function PastAttempts({ attempts, onOpen }: { attempts: WriteAttempt[]; onOpen: (a: WriteAttempt) => void }) {
  if (!attempts.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="write-past">
      <h2 id="write-past" className="text-lg font-semibold text-balance">Recent writing</h2>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {attempts.slice(0, 5).map((a) => (
          <li key={a.id}>
            <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal px-4 py-3 text-left" onClick={() => onOpen(a)}><span className="min-w-0 flex-1 flex flex-col">
                <span lang="fr" className="font-medium">{a.subject?.title || a.task}</span>
                <span className="text-sm font-normal text-muted-foreground">{a.task} · {fmtWhen(a.created_at)} · {a.status === "failed" ? "Feedback failed" : a.text_2 ? "Both rounds" : a.status === "ready" ? "Round 1 done" : "In progress"}</span>
              </span></Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
