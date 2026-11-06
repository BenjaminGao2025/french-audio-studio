import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Chip } from "@/components/fr/kit";
import { meta } from "@/components/fr/kit-utils";
import { useItems, useItemsSummary } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import type { Skill } from "@/api/types";

export const Route = createFileRoute("/items")({
  head: () => meta("Item bank", "Practice and validation item pools by skill and source."),
  component: Items,
});

const sourceLegend: [string, string, "accent" | "muted" | "warn"][] = [
  ["official_sample", "Official sample", "accent"],
  ["user", "Self-made", "muted"],
  ["llm", "AI-generated", "warn"],
  ["imported", "Imported", "muted"],
];

const skills: Skill[] = ["listening", "reading", "writing", "speaking"];

function Items() {
  const summary = useItemsSummary();
  const [skill, setSkill] = useState<Skill | "">("");
  const [pool, setPool] = useState<"practice" | "validation" | "">("");
  const rows = useItems(skill || undefined, pool || undefined);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-10">
        <h1 className="fr text-4xl">Item bank</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {sourceLegend.map(([k, label, tone]) => (
            <Chip key={k} tone={tone}>
              {label}
            </Chip>
          ))}
        </div>

        <DataView query={summary} skeletonLines={5}>
          {(s) => (
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {(["practice", "validation"] as const).map((p) => (
                <div key={p} className="panel p-6">
                  <h2 className="text-lg font-semibold">
                    {p === "practice" ? "Practice (seen)" : "Validation (unseen)"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {p === "practice"
                      ? "Use freely. Scores here never count for decisions."
                      : "Locked until a checkpoint. Used once, then moved to Practice."}
                  </p>
                  <ul className="mt-5 divide-y divide-border">
                    {skills.map((sk) => {
                      const row = s.pools[p][sk];
                      return (
                        <li key={sk} className="flex items-center gap-3 py-3 text-sm">
                          <span className="w-24 font-medium capitalize">{sk}</span>
                          <span className="w-10 tabular-nums">{row?.total ?? 0}</span>
                          <span className="ml-auto flex gap-1.5">
                            {sourceLegend.map(([src, , tone]) =>
                              row?.by_source[src] ? (
                                <Chip key={src} tone={tone}>
                                  {row.by_source[src]}
                                </Chip>
                              ) : null,
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DataView>

        <div className="panel mt-6 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={skill}
              onChange={(e) => setSkill(e.target.value as Skill | "")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">All skills</option>
              {skills.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
            <select
              value={pool}
              onChange={(e) => setPool(e.target.value as "practice" | "validation" | "")}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Both pools</option>
              <option value="practice">Practice</option>
              <option value="validation">Validation</option>
            </select>
          </div>
          <DataView query={rows} isEmpty={(d) => d.rows.length === 0}>
            {(d) => (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      {[
                        "Skill",
                        "Task",
                        "Level",
                        "Format",
                        "Source",
                        "License",
                        "Pool",
                        "Created",
                        "Exposed",
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 capitalize">{r.skill}</td>
                        <td className="px-3 py-2">{r.task}</td>
                        <td className="px-3 py-2">{r.level}</td>
                        <td className="px-3 py-2">{r.format}</td>
                        <td className="px-3 py-2">{r.source}</td>
                        <td className="px-3 py-2">{r.license}</td>
                        <td className="px-3 py-2">{r.pool}</td>
                        <td className="px-3 py-2 tabular-nums">{r.created_at}</td>
                        <td className="px-3 py-2 tabular-nums">{r.exposed_at ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DataView>
        </div>
      </div>
    </AppShell>
  );
}
