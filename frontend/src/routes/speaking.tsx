import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { BlockShell, Chip, Stat } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { useSettledAttempt } from "@/api/hooks";
import { DataView, Skeleton } from "@/components/fr/states";
import { AudioButton, Recorder, RubricPanel } from "@/components/fr/widgets";
import type { Attempt } from "@/api/types";

export const Route = createFileRoute("/speaking")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta(
      "Speaking exam",
      "Practise TCF Canada speaking tasks with a timer, transcript and rubric.",
    ),
  component: Speaking,
});

type Phase = "idle" | "prep" | "recording" | "review";

function Speaking() {
  const { block } = Route.useSearch();
  const tasksQ = useQuery({ queryKey: ["speak-tasks"], queryFn: () => api.speak.tasks() });
  const tasks = tasksQ.data?.tasks ?? [];

  const [taskId, setTaskId] = useState("T1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [el, setEl] = useState(0);
  const [notes, setNotes] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const audioDur = useRef(0);

  const t = tasks.find((x) => x.task === taskId) ?? tasks[0];
  const total = phase === "prep" ? (t?.prep_seconds ?? 0) : (t?.seconds ?? 0);
  const left = Math.max(0, total - el);

  // Timer: pure state updates only; phase transitions happen in an effect below.
  useEffect(() => {
    if (phase !== "prep" && phase !== "recording") return;
    const id = setInterval(() => setEl((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if ((phase === "prep" || phase === "recording") && total > 0 && el >= total) {
      if (phase === "prep") {
        setEl(0);
        setPhase("recording");
      } else {
        setPhase("review");
      }
    }
  }, [el, phase, total]);

  const submitAttempt = (text: string, seconds: number) => {
    if (!t) return;
    setBusy(true);
    void api.speak
      .attempt({
        task: t.task,
        subject: t.subjects[0],
        level: "A2",
        transcript: text,
        seconds,
        audio_duration: audioDur.current,
      })
      .then((a) => setAttempt(a))
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : "Could not save."))
      .finally(() => setBusy(false));
  };
  const current = useSettledAttempt("speak", attempt, 1);

  return (
    <BlockShell
      kicker="Speaking exam"
      title={`Task ${taskId.slice(1)}`}
      progress={phase === "review" ? 1 : total ? el / total : 0}
      blockId={block}
      lane="speaking"
    >
      <DataView query={tasksQ} skeletonLines={4}>
        {() => (
          <>
            <div className="mb-6 flex gap-2">
              {tasks.map((x) => (
                <button
                  key={x.task}
                  onClick={() => {
                    setTaskId(x.task);
                    setPhase("idle");
                    setEl(0);
                    setAttempt(null);
                  }}
                  className={cn(btn.ghost, x.task === taskId && "border-primary")}
                >
                  {x.task}
                </button>
              ))}
            </div>

            {phase !== "review" && t && (
              <div className="panel grid gap-10 p-10 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex items-center gap-4">
                    <div className="grid h-14 w-14 place-items-center rounded-full bg-accent fr text-xl text-accent-foreground">
                      M
                    </div>
                    <div>
                      <div className="font-medium">Mme Lefèvre · examiner</div>
                      <AudioButton
                        url={api.speech.ttsUrl(t.subjects[0]?.prompt ?? "")}
                        label="Play question"
                      />
                    </div>
                  </div>
                  <p className="fr mt-8 text-3xl leading-snug">« {t.subjects[0]?.prompt} »</p>
                  {phase === "prep" && (
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Preparation notes (not recorded)…"
                      className="mt-6 h-32 w-full resize-none rounded-lg border border-input bg-background p-4 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                </div>
                <div className="flex flex-col items-center">
                  <TimerRing
                    left={left}
                    total={total}
                    active={phase === "prep" || phase === "recording"}
                    label={
                      phase === "prep"
                        ? "preparation"
                        : phase === "recording"
                          ? "● recording"
                          : "ready"
                    }
                  />
                  {phase === "idle" && (
                    <button
                      onClick={() => {
                        setEl(0);
                        setPhase(t.prep_seconds ? "prep" : "recording");
                      }}
                      className={cn(btn.primary, "mt-6")}
                    >
                      <Mic className="h-4 w-4" />{" "}
                      {t.prep_seconds ? `Start ${t.prep_seconds}s prep` : "Start answering"}
                    </button>
                  )}
                  {phase === "recording" && (
                    <Recorder
                      maxSeconds={total - el > 0 ? total - el : undefined}
                      onDone={(blob, dur) => {
                        audioDur.current = dur;
                        setFailure(null);
                        void api.speech
                          .transcribe(blob)
                          .then((r) => {
                            setTranscript(r.text);
                            submitAttempt(r.text, Math.round(dur));
                          })
                          .catch((e: unknown) =>
                            setFailure(e instanceof Error ? e.message : "Could not transcribe."),
                          );
                        setPhase("review");
                      }}
                      className="mt-6"
                    />
                  )}
                </div>
              </div>
            )}

            {phase === "review" && (
              <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
                <div className="panel p-8">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Transcript
                  </div>
                  {failure ? (
                    <div role="alert" className="mt-3 text-sm text-destructive">
                      {failure}
                      <button
                        className={cn(btn.ghost, "mt-3 block")}
                        onClick={() => {
                          setFailure(null);
                          setEl(0);
                          setPhase("idle");
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  ) : busy || !attempt ? (
                    <div className="mt-3">
                      <Skeleton lines={4} />
                    </div>
                  ) : (
                    <>
                      <p className="fr mt-3 text-xl leading-relaxed">{transcript || "—"}</p>
                      <div className="mt-8">
                        <RubricLoader attemptId={attempt.id} />
                      </div>
                    </>
                  )}
                </div>
                <aside className="panel grid h-fit grid-cols-2 gap-6 p-6">
                  <Stat label="Words / min" value={current?.wpm ?? "—"} />
                  <Stat
                    label="Pause ratio"
                    value={(current as { pause_ratio?: string } | null)?.pause_ratio ?? "—"}
                  />
                  <Stat
                    label="Questions asked"
                    value={(current as { questions_asked?: number } | null)?.questions_asked ?? "—"}
                  />
                  <Stat label="Status" value={current?.status ?? "—"} />
                </aside>
              </div>
            )}
          </>
        )}
      </DataView>
    </BlockShell>
  );
}

function TimerRing({
  left,
  total,
  active,
  label,
}: {
  left: number;
  total: number;
  active: boolean;
  label: string;
}) {
  const r = 110;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center">
      <svg width="240" height="240" className="-rotate-90">
        <circle cx="120" cy="120" r={r} strokeWidth={6} className="fill-none stroke-border" />
        <circle
          cx="120"
          cy="120"
          r={r}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (total ? 1 - left / total : 0)}
          className={cn("fill-none transition-all", active ? "stroke-primary" : "stroke-border")}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-mono text-5xl tabular-nums">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function RubricLoader({ attemptId }: { attemptId: string }) {
  const rubricQ = useQuery({
    queryKey: ["speak-rubric", attemptId],
    queryFn: () => api.speak.rubric(attemptId),
  });
  return (
    <DataView query={rubricQ} skeletonLines={4} quiet>
      {(r) => (
        <div className="space-y-2">
          {r.dims.map((d) => (
            <div
              key={d.dim}
              className="grid grid-cols-[180px_48px_1fr] gap-4 border-b border-border py-3 text-sm last:border-0"
            >
              <span className="font-medium">{d.dim}</span>
              <Chip tone="accent">{d.cefr}</Chip>
              <span className="text-muted-foreground">{d.evidence ?? ""}</span>
            </div>
          ))}
          <RubricPanel rubric={r} />
        </div>
      )}
    </DataView>
  );
}
