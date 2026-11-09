/* SCR-PRA-02 Writing practice: TCF Canada tasks, two feedback rounds (hints, then corrections). */
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
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
import { Banner, Button, PageHead, Pill, Segmented, Spinner } from "../components/ui";
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
      <div className="page">
        <PageHead back={<BackTo label="Practice" to="practice" />} title="Write" desc="TCF Canada writing tasks with two rounds of feedback." />
        {loadErr ? <Banner tone="error" title="Couldn’t load the writing tasks" live="assertive" actions={<Button kind="secondary" onClick={load}>Retry</Button>}>{loadErr}</Banner> : <Spinner label="Loading tasks…" />}
      </div>
    );
  }

  const builtIns = data.subjects[task] ?? [];
  const subj = subject ?? builtIns[0] ?? null;
  const editing = phase === "draft" || phase === "wait1";
  const n = wordCount(editing ? draft : revision);
  const over = spec ? n > spec.max_words : false;
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Write" eyebrow="Expression écrite · practice" desc="Write, get hints and fix your own mistakes, then see the corrections. Your draft is kept on this device." />
      <div className="stack gap-5">
        {editing && !attempt && (
          <div className="stack gap-3">
            <Segmented
              label="Task"
              value={task}
              onChange={(t) => { setTask(t); setSubject(data.subjects[t]?.[0] ?? null); setGenErr(""); }}
              options={TASKS.map((t) => ({ value: t, label: t === data.recommended_task ? `${t} · suggested` : t }))}
            />
            <div className="row gap-3" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field" style={{ minWidth: 0, flex: "1 1 260px", maxWidth: 480 }}>
                <span className="field-label">Subject</span>
                <select
                  className="select"
                  value={subj && builtIns.some((s) => s.id === subj.id) ? subj.id : "custom"}
                  onChange={(e) => { const s = builtIns.find((x) => x.id === e.target.value); if (s) setSubject(s); }}
                >
                  {builtIns.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  {subj && !builtIns.some((s) => s.id === subj.id) && <option value="custom">{subj.title} (new)</option>}
                </select>
              </label>
              <Button kind="tertiary" icon={<Sparkles aria-hidden />} busy={genBusy} onClick={() => void generate()}>New subject</Button>
            </div>
            {genBusy && <Spinner label="Writing a new subject…" />}
            {genErr && <Banner tone="error" title="Couldn’t make a new subject" live="assertive">{genErr}</Banner>}
          </div>
        )}

        {subj && spec && <SubjectCard subject={subj} spec={spec} />}

        {editing ? (
          <>
            <div className="field">
              <label htmlFor="write-ta" className="field-label">Your text in French</label>
              <textarea id="write-ta" className="textarea" lang="fr" rows={10} value={draft} readOnly={phase === "wait1"} aria-describedby="write-count" onChange={(e) => { setDraft(e.target.value); setError(""); }} />
              <p id="write-count" className={over ? "counter counter--over" : "counter"}>
                {n} {n === 1 ? "word" : "words"}{spec ? ` · target ${spec.min_words}–${spec.max_words}` : ""}
              </p>
            </div>
            {error && <Banner tone="error" title="Feedback didn’t load" live="assertive">{error} Your text is kept.</Banner>}
            {phase === "wait1" && <Spinner label="Reading your text… this usually takes 10–40 seconds." />}
            <div className="sticky-actions">
              <div className="btn-row">
                <Button kind="primary" busy={phase === "wait1"} onClick={() => void submit1()}>{error ? "Retry" : "Get feedback"}</Button>
              </div>
            </div>
          </>
        ) : (
          attempt && (
            <div className="stack gap-5">
              <div id="write-fb" tabIndex={-1} className="stack gap-4">
                <AiLabel />
                <div className="stack gap-1">
                  <span className="def-label">Your first draft</span>
                  <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.text_1}</p>
                </div>
                <Round1 a={attempt} />
              </div>
              <hr className="divider" />
              {phase === "round2" ? (
                <div className="stack gap-4">
                  <p className="t-section">Round 2 · corrections</p>
                  <div className="stack gap-1">
                    <span className="def-label">Your revision</span>
                    <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{attempt.text_2}</p>
                  </div>
                  <Round2 fb={attempt.feedback_2} correctedLabel="Corrected text" />
                  <Banner tone="success" title="Writing practice complete" actions={<><Button kind="primary" onClick={reset}>Write another</Button><Button kind="secondary" onClick={() => go("practice")}>Back to Practice</Button></>}>
                    Saved to your writing attempts.
                  </Banner>
                </div>
              ) : (
                <div className="stack gap-3">
                  <p className="t-section">Round 2 · fix it yourself</p>
                  <p className="t-support">Use the hints above to correct your text, then send it for the corrections.</p>
                  <div className="field">
                    <label htmlFor="write-rev" className="field-label">Your revised text</label>
                    <textarea id="write-rev" className="textarea" lang="fr" rows={10} value={revision} readOnly={phase === "wait2"} onChange={(e) => { setRevision(e.target.value); setError(""); }} />
                    <p className={over ? "counter counter--over" : "counter"}>{n} {n === 1 ? "word" : "words"}</p>
                  </div>
                  {error && <Banner tone="error" title="Corrections didn’t load" live="assertive">{error} Your revision is kept.</Banner>}
                  {phase === "wait2" && <Spinner label="Checking your revision…" />}
                  <div className="btn-row">
                    <Button kind="primary" busy={phase === "wait2"} disabledReason={!revision.trim() ? "Write your revision first." : undefined} onClick={() => void submit2()}>
                      {error ? "Retry" : "Get corrections"}
                    </Button>
                    <Button kind="tertiary" onClick={reset}>Start over</Button>
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
    <section className="panel stack gap-2" aria-label="Subject">
      <p className="t-label">{spec.name_en}</p>
      <p lang="fr" className="t-strong">{subject.title}</p>
      <p lang="fr">{subject.prompt}</p>
      {subject.doc1 && <p lang="fr" className="t-support"><span className="t-strong">Document 1 · </span>{subject.doc1}</p>}
      {subject.doc2 && <p lang="fr" className="t-support"><span className="t-strong">Document 2 · </span>{subject.doc2}</p>}
      {!!subject.requirements?.length && (
        <ul className="stack gap-1" style={{ paddingLeft: 20 }}>
          {subject.requirements.map((r, i) => <li key={i} lang="fr">{r}</li>)}
        </ul>
      )}
      {!!subject.stems?.length && <p lang="fr" className="t-support">Starters: {subject.stems.join(" · ")}</p>}
      {!!subject.words?.length && <p lang="fr" className="t-support">Words: {subject.words.join(" · ")}</p>}
      <p className="t-meta">
        {spec.min_words}–{spec.max_words} words{spec.part1_range ? ` (comparison ${spec.part1_range}, opinion ${spec.part2_range})` : ""}. {spec.desc_en}
      </p>
    </section>
  );
}

function Round1({ a }: { a: WriteAttempt }) {
  const fb = a.feedback_1;
  if (!fb || !Object.keys(fb).length) return null;
  return (
    <div className="stack gap-4">
      {fb.praise && <p><span className="t-strong">What works · </span>{fb.praise}</p>}
      {fb.word_count && (
        <p className="row gap-2">
          <Pill tone={fb.word_count.in_range ? "success" : "warning"}>{fb.word_count.in_range ? "Length OK" : "Length"}</Pill>
          <span className="t-support">{fb.word_count.note}</span>
        </p>
      )}
      {fb.register?.note && (
        <p className="row gap-2">
          <Pill tone={fb.register.fits ? "success" : "warning"}>Register · {fb.register.choice}</Pill>
          <span className="t-support">{fb.register.note}</span>
        </p>
      )}
      {fb.t3_comparison && (
        <p className="row gap-2">
          <Pill tone={fb.t3_comparison.compared && fb.t3_comparison.position_clear ? "success" : "warning"}>Comparison and position</Pill>
          <span className="t-support">{fb.t3_comparison.note}</span>
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
    <section className="stack gap-2" aria-labelledby="write-past">
      <h2 id="write-past" className="t-section">Recent writing</h2>
      <ul className="list">
        {attempts.slice(0, 5).map((a) => (
          <li key={a.id}>
            <button className="list-btn" onClick={() => onOpen(a)}>
              <span className="grow stack">
                <span lang="fr" className="t-strong">{a.subject?.title || a.task}</span>
                <span className="t-support">{a.task} · {fmtWhen(a.created_at)} · {a.status === "failed" ? "Feedback failed" : a.text_2 ? "Both rounds" : a.status === "ready" ? "Round 1 done" : "In progress"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
