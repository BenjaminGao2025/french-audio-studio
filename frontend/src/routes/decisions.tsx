import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { AppShell, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { useCheckpoints } from "@/api/hooks";
import { DataView, EmptyState } from "@/components/fr/states";
import { api } from "@/api";
import { fmtHours } from "@/lib/format";
import type { Checkpoint } from "@/api/types";

export const Route = createFileRoute("/decisions")({
  head: () =>
    meta(
      "Decision board",
      "Checkpoints with four-skill trends on unseen items, risks and decisions.",
    ),
  component: Decisions,
});

const kindLabel: Record<string, string> = {
  week_8: "Week 8 checkpoint",
  week_16: "Week 16 checkpoint",
  hours_100: "100-hour checkpoint",
  hours_300: "300-hour checkpoint",
};

function SkillChart({ skills }: { skills: { skill: string; series: number[]; last: number }[] }) {
  const strokes = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4"];
  return (
    <>
      <svg viewBox="0 0 300 120" className="mt-6 w-full">
        {[30, 60, 90].map((y) => (
          <line
            key={y}
            x1="0"
            x2="300"
            y1={y}
            y2={y}
            className="stroke-border"
            strokeDasharray="2 4"
          />
        ))}
        {skills.map((s, i) => (
          <polyline
            key={s.skill}
            points={s.series
              .map(
                (v, k) => `${20 + k * (260 / Math.max(1, s.series.length - 1))},${115 - v * 1.5}`,
              )
              .join(" ")}
            className={`fill-none ${strokes[i % 4]}`}
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {skills.map((s) => (
          <span key={s.skill}>
            {s.skill} {s.last}%
          </span>
        ))}
      </div>
    </>
  );
}

function DecisionForm({ cp, onDone }: { cp: Checkpoint; onDone: () => void }) {
  const [decision, setDecision] = useState<string>("proceed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-5 space-y-3 border-t border-border pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void api.checkpoints
          .decide(cp.id, decision, note)
          .then(onDone)
          .finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-wrap gap-3 text-sm">
        {[
          ["proceed", "Proceed as planned"],
          ["adjust", "Adjust the plan"],
          ["postpone", "Postpone"],
        ].map(([v, label]) => (
          <label key={v} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`d-${cp.id}`}
              checked={decision === v}
              onChange={() => setDecision(v!)}
              className="accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? One or two sentences."
        className="h-20 w-full resize-none rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button className={btn.primary} disabled={busy}>
        Save decision
      </button>
    </form>
  );
}

function CheckpointCard({ cp, refetch }: { cp: Checkpoint; refetch: () => void }) {
  const [recording, setRecording] = useState(false);
  const report = cp.report;
  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{kindLabel[cp.kind] ?? cp.kind}</h2>
        <Chip tone={cp.status === "open" ? "accent" : cp.status === "decided" ? "muted" : "muted"}>
          {cp.status === "open" ? "Open" : cp.status === "decided" ? "Decided" : "Upcoming"}
        </Chip>
      </div>
      {!report ? (
        <div className="mt-4">
          {cp.kind === "week_16" ? (
            <div className="text-sm text-muted-foreground">
              <p>No data yet — this checkpoint opens at week 16.</p>
              <p className="mt-2">
                Rule: if unseen-item scores are below A2 in any skill, the exam date moves. Required
                actions: full mock exam and a go/no-go decision recorded here.
              </p>
            </div>
          ) : (
            <EmptyState title="No data yet" hint="This checkpoint hasn't opened." />
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {fmtHours(cp.hours_at)} at checkpoint · {fmtHours(report.active_hours)} active
          </p>
          <SkillChart skills={report.skills} />
          <p className="mt-1 text-xs text-muted-foreground">
            Trends use UNSEEN validation items only.
          </p>

          <div className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Process metrics
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {Object.entries(report.process_metrics).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular-nums">{v}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recommendation
          </div>
          <p className="mt-1 text-sm">{report.recommendation}</p>

          <div className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Risks
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {report.risks.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>

          {cp.status === "decided" ? (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
              <span>
                Decision: <b className="font-medium">{cp.decision}</b>
                {cp.decision_note && (
                  <span className="text-muted-foreground"> — {cp.decision_note}</span>
                )}
              </span>
              <a href={api.checkpoints.exportUrl(cp.id)} className={btn.ghost}>
                <Download className="h-4 w-4" /> Export .md
              </a>
            </div>
          ) : recording ? (
            <DecisionForm
              cp={cp}
              onDone={() => {
                setRecording(false);
                refetch();
              }}
            />
          ) : (
            <button onClick={() => setRecording(true)} className={`${btn.ghost} mt-6`}>
              Record decision
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Decisions() {
  const cps = useCheckpoints();
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-10">
        <h1 className="fr text-4xl">Decision board</h1>
        <p className="mt-1 text-muted-foreground">
          Five-minute read per checkpoint. Trends use unseen items only.
        </p>
        <DataView query={cps} skeletonLines={6}>
          {(list) => (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {list.map((c) => (
                <CheckpointCard key={c.id} cp={c} refetch={cps.refetch} />
              ))}
            </div>
          )}
        </DataView>
      </div>
    </AppShell>
  );
}
