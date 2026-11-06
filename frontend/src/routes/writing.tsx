import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { BlockShell, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { useSettledAttempt } from "@/api/hooks";
import { DataView, Skeleton } from "@/components/fr/states";
import { RubricPanel } from "@/components/fr/widgets";
import type { Attempt, WriteTaskSpec } from "@/api/types";

export const Route = createFileRoute("/writing")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta(
      "Writing exam",
      "TCF Canada writing tasks with live word count, timer and rubric feedback.",
    ),
  component: Writing,
});

type Phase = "idle" | "writing" | "round1" | "revising" | "round2";

function Writing() {
  const { block } = Route.useSearch();
  const tasksQ = useQuery({ queryKey: ["write-tasks"], queryFn: () => api.write.tasks() });

  const [taskId, setTaskId] = useState<string>("T1");
  const [text, setText] = useState("");
  const [left, setLeft] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const submitted = useRef(false);

  const tasks = tasksQ.data?.tasks ?? [];
  const t: WriteTaskSpec | undefined = tasks.find((x) => x.task === taskId) ?? tasks[0];
  const wc = text.trim().split(/\s+/).filter(Boolean).length;
  const outOfRange = t ? wc < t.word_range[0] || wc > t.word_range[1] : false;

  const submit = () => {
    if (!t || phase !== "writing" || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    void api.write
      .attempt({ task: t.task, subject: t.subjects[0], level: "A2", text, seconds })
      .then((a) => {
        setAttempt(a);
        setPhase("round1");
      })
      .finally(() => setBusy(false));
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (phase !== "writing") return;
    const id = setInterval(() => {
      setLeft((l) => Math.max(0, l - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (left === 0 && phase === "writing") submitRef.current();
  }, [left, phase]);

  const switchTask = (k: string) => {
    if (
      phase === "writing" &&
      text.trim() &&
      !window.confirm("Switch task? Your current text will be lost.")
    )
      return;
    setTaskId(k);
    setText("");
    setPhase("idle");
    setAttempt(null);
  };

  const startTask = (k: string) => {
    const spec = tasks.find((x) => x.task === k);
    if (!spec) return;
    submitted.current = false;
    setLeft(spec.minutes * 60);
    startedAt.current = Date.now();
    setPhase("writing");
  };

  const current = useSettledAttempt("write", attempt, phase === "round2" ? 2 : 1);
  const hints = (current?.feedback1 as { hints?: string[] } | undefined)?.hints ?? [];

  return (
    <BlockShell
      kicker="Writing exam"
      title={`Writing · ${taskId}`}
      progress={phase === "round2" ? 0.9 : phase === "idle" ? 0.1 : 0.4}
      blockId={block}
      lane="writing"
    >
      <DataView query={tasksQ} skeletonLines={4}>
        {() => (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-full bg-secondary p-1">
                {tasks.map((x) => (
                  <button
                    key={x.task}
                    onClick={() => switchTask(x.task)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm",
                      taskId === x.task
                        ? "bg-card font-medium shadow-soft"
                        : "text-muted-foreground",
                    )}
                  >
                    {x.task}{" "}
                    <span className="text-xs text-muted-foreground">
                      {x.word_range[0]}–{x.word_range[1]}w · {x.minutes}m
                    </span>
                  </button>
                ))}
              </div>
              {phase === "writing" && (
                <div
                  className={cn("font-mono text-2xl tabular-nums", left < 60 && "text-destructive")}
                >
                  {String(Math.floor(left / 60)).padStart(2, "0")}:
                  {String(left % 60).padStart(2, "0")}
                </div>
              )}
            </div>

            {phase === "idle" && t && (
              <div className="panel mx-auto max-w-2xl p-8 text-center">
                <p className="fr text-xl leading-relaxed whitespace-pre-line">
                  {t.subjects[0]?.prompt}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {t.word_range[0]}–{t.word_range[1]} words · {t.minutes} minutes · auto-submits at
                  00:00
                </p>
                <button className={cn(btn.primary, "mt-6")} onClick={() => startTask(t.task)}>
                  <Play className="h-4 w-4" /> Start
                </button>
              </div>
            )}

            {phase === "writing" && t && (
              <div className="panel p-8">
                <p className="fr text-xl leading-relaxed whitespace-pre-line">
                  {t.subjects[0]?.prompt}
                </p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="fr mt-6 h-72 w-full resize-none rounded-lg border border-input bg-background p-5 text-lg leading-relaxed outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Écrivez ici…"
                />
                <div className="mt-4 flex items-center justify-between">
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      outOfRange ? "font-medium text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {wc} words · target {t.word_range[0]}–{t.word_range[1]}
                    {outOfRange && wc > 0 && (
                      <Chip tone="bad">A1 non-atteint risk: word count</Chip>
                    )}
                  </span>
                  <button className={btn.primary} onClick={submit} disabled={busy || wc === 0}>
                    Submit
                  </button>
                </div>
              </div>
            )}

            {(phase === "round1" || phase === "revising") && (
              <div className="panel mx-auto max-w-2xl p-8">
                <h3 className="text-sm font-medium">
                  Round 1 · Hints{" "}
                  <span className="font-normal text-muted-foreground">
                    (try fixing yourself before seeing corrections)
                  </span>
                </h3>
                {current?.status === "pending" ? (
                  <div className="mt-4">
                    <Skeleton lines={3} />
                  </div>
                ) : current?.status === "failed" ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {typeof current.error === "string" && current.error
                      ? current.error
                      : "Feedback failed. Revise and continue, or try again later."}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {hints.map((h) => (
                      <li key={h}>• {h}</li>
                    ))}
                  </ul>
                )}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="fr mt-6 h-48 w-full resize-none rounded-lg border border-input bg-background p-4 text-lg outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  className={cn(btn.primary, "mt-4")}
                  disabled={busy}
                  onClick={() => {
                    if (!attempt) return;
                    setBusy(true);
                    void api.write
                      .round2(attempt.id, text, Math.round((Date.now() - startedAt.current) / 1000))
                      .then((a) => {
                        setAttempt(a);
                        setPhase("round2");
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  I've revised — show round 2
                </button>
              </div>
            )}

            {phase === "round2" && current && <Round2 attempt={current} />}
          </>
        )}
      </DataView>
    </BlockShell>
  );
}

function Round2({ attempt }: { attempt: Attempt }) {
  const rubricQ = useQuery({
    queryKey: ["write-rubric", attempt.id],
    queryFn: () => api.write.rubric(attempt.id),
  });
  const fb = attempt.feedback2;
  if (attempt.status === "pending") {
    return (
      <div className="panel mx-auto max-w-2xl p-8">
        <Skeleton lines={4} />
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {fb && (
          <div className="panel p-6">
            <h3 className="text-sm font-medium">Round 2 · Minimal edits</h3>
            <p className="fr mt-3 text-lg leading-relaxed">{fb.corrected_text}</p>
            <ul className="mt-4 space-y-2 text-sm">
              {fb.sentences.map((s, i) => (
                <li key={i}>
                  <del className="text-destructive">{s.original}</del> →{" "}
                  <ins className="bg-accent no-underline">{s.corrected}</ins>
                  <span className="ml-2 text-muted-foreground">{s.explanation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <aside>
        <DataView query={rubricQ} skeletonLines={4} quiet>
          {(r) => <RubricPanel rubric={r} />}
        </DataView>
      </aside>
    </div>
  );
}
