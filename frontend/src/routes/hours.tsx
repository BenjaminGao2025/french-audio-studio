import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { AppShell, Bar, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { useGameState, useHoursLedger, useLogTime } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import { api } from "@/api";
import { fmtHours } from "@/lib/format";
import type { Lane } from "@/api/types";

export const Route = createFileRoute("/hours")({
  head: () =>
    meta("Hours & milestones", "Active, manual and input hours by lane, with milestones to 1000h."),
  component: Hours,
});

const laneLabels: Record<Lane, string> = {
  course: "Course",
  listening: "Listening",
  reading: "Reading",
  speaking: "Speaking",
  writing: "Writing",
  review: "Review",
  car: "Car (passive)",
};

function Hours() {
  const ledger = useHoursLedger();
  const game = useGameState();
  const logTime = useLogTime();
  const [lane, setLane] = useState<Lane>("speaking");
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-10">
        <h1 className="fr text-4xl">Hours & milestones</h1>
        <DataView query={ledger} skeletonLines={8}>
          {(l) => {
            const total = l.active_hours + l.manual_hours;
            return (
              <>
                <p className="mt-1 text-muted-foreground">
                  {fmtHours(total)} counted toward 1000h · {l.phase}
                </p>

                <div className="panel mt-8 p-8">
                  <div className="relative h-2 rounded-full bg-secondary">
                    <div
                      className="absolute h-full rounded-full bg-primary"
                      style={{ width: `${(total / 1000) * 100}%` }}
                    />
                    {l.milestones.map((m) => (
                      <div
                        key={m}
                        className="absolute -top-1.5"
                        style={{ left: `calc(${m / 10}% - 10px)` }}
                      >
                        <div
                          className={cn(
                            "h-5 w-5 rounded-full border-2 bg-card",
                            total >= m ? "border-primary" : "border-border",
                          )}
                        />
                        <div className="mt-2 -ml-1 text-xs text-muted-foreground">{m}h</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-10 text-sm text-muted-foreground">
                    Next: <b className="font-medium text-foreground">{l.next_milestone}h</b> —{" "}
                    {fmtHours(l.hours_to_go)} to go
                  </div>
                </div>

                <div className="panel mt-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-6 py-3 font-medium">Lane</th>
                        <th className="px-6 py-3 font-medium">Active</th>
                        <th className="px-6 py-3 font-medium">Manual</th>
                        <th className="px-6 py-3 font-medium">Input</th>
                        <th className="w-1/3 px-6 py-3">This week</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {l.lanes.map((row) => (
                        <tr key={row.lane}>
                          <td className="px-6 py-3 font-medium">{laneLabels[row.lane]}</td>
                          <td className="px-6 py-3 tabular-nums">{fmtHours(row.active)}</td>
                          <td className="px-6 py-3 tabular-nums">{fmtHours(row.manual)}</td>
                          <td className="px-6 py-3 tabular-nums text-muted-foreground">
                            {fmtHours(row.input)}
                          </td>
                          <td className="px-6 py-3">
                            <Bar
                              value={
                                row.week_target ? (row.active + row.manual) / row.week_target : 0
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
                    Input hours (passive playback) are shown separately and never count toward
                    1000h.
                  </p>
                </div>
              </>
            );
          }}
        </DataView>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <form
            className="panel space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Number(minutes);
              if (!Number.isFinite(m) || m < 1 || m > 300 || note.trim().length === 0) return;
              logTime.mutate(
                { lane, minutes: m, note: note.trim() },
                {
                  onSuccess: () => {
                    setNote("");
                    game.refetch();
                  },
                },
              );
            }}
          >
            <h2 className="font-medium">Log manual time</h2>
            <div className="flex flex-wrap gap-2">
              <select
                value={lane}
                onChange={(e) => setLane(e.target.value as Lane)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(laneLabels) as Lane[])
                  .filter((x) => x !== "car")
                  .map((x) => (
                    <option key={x} value={x}>
                      {laneLabels[x]}
                    </option>
                  ))}
              </select>
              <input
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                inputMode="numeric"
                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Minutes"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              maxLength={200}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Note (required) — e.g. tutor lesson with Marie"
            />
            <button className={btn.primary} disabled={logTime.isPending || !note.trim()}>
              Add
            </button>
          </form>

          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Today's manual logs</h2>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={game.data?.today.family_day ?? false}
                  onChange={(e) =>
                    void api.game.familyDay(e.target.checked).then(() => game.refetch())
                  }
                />
                Family day
              </label>
            </div>
            <ul className="mt-4 divide-y divide-border text-sm">
              {(game.data?.today.logs ?? []).map((log) => (
                <li key={log.id} className="flex items-center gap-3 py-2.5">
                  <Chip>{laneLabels[log.lane]}</Chip>
                  <span className="tabular-nums">{log.minutes} min</span>
                  <span className="flex-1 truncate text-muted-foreground">{log.note}</span>
                  <button
                    onClick={() => void api.game.deleteLog(log.id).then(() => game.refetch())}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete log"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {(game.data?.today.logs ?? []).length === 0 && (
                <li className="py-3 text-muted-foreground">No manual logs today.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-secondary/60 p-6 text-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Counting rules · read-only
          </div>
          <ul className="mt-3 space-y-1.5">
            <li>
              • <b>Active hours</b> — heartbeat time inside a block (shadowing, recording,
              answering, intensive reading, review, writing) + block timing. Weight 1.0. Counts
              toward 1000h.
            </li>
            <li>
              • <b>Manual hours</b> — tutor lessons, external course, textbook self-study, logged by
              hand with a required note. Weight 1.0. Counts toward 1000h (cap 6h/week).
            </li>
            <li>
              • <b>Input hours</b> — passive playback of episodes/audio (car lane, background
              listening). Shown separately. <b>Never</b> counts toward 1000h.
            </li>
            <li>
              • <b>Not counted</b> — browsing dashboards, settings, waiting for generation.
            </li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
