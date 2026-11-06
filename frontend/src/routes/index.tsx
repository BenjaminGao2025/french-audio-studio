import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Circle, Play, SkipForward, Info, CloudOff, PackageCheck } from "lucide-react";
import { AppShell, Bar, Chip, RouteLink, Stat } from "@/components/fr/kit";
import { meta, withBlock } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { useBlockActions, useGameState, useSrsQueue, useToday, useMe } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import { fmtDay, fmtHours, fmtMinutes, greeting } from "@/lib/format";
import { useT } from "@/i18n";
import { api } from "@/api";
import type { BlockStatus } from "@/api/types";

export const Route = createFileRoute("/")({
  head: () =>
    meta("Today", "Your French study cockpit: today's blocks, hours and review, ready to start."),
  component: Today,
});

function StatusIcon({ s }: { s: BlockStatus }) {
  if (s === "done")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  if (s === "active")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-primary">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      </span>
    );
  if (s === "skipped")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-muted-foreground">
        <SkipForward className="h-3 w-3" />
      </span>
    );
  return <Circle className="h-6 w-6 text-border" />;
}

function Today() {
  const t = useT();
  const me = useMe();
  const name = me.data?.email?.split("@")[0];
  const today = useToday();
  const game = useGameState();
  const queue = useSrsQueue("speak,listen", 0);
  const actions = useBlockActions();

  return (
    <AppShell>
      <DataView query={today} skeletonLines={6}>
        {(data) => {
          const openTodos = data.todos.filter((x) => !x.done);
          const firstOpen = data.blocks.find(
            (b) => b.status === "planned" || b.status === "active",
          );
          const weekMin = game.data?.week.minutes ?? 0;
          const weekTarget = data.phase.week_target_min;
          return (
            <>
              {openTodos.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border bg-accent/50 px-4 py-2 text-xs text-accent-foreground md:px-10">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {openTodos.map((todo) => (
                    <label key={todo.id} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        onChange={() => void api.todos.done(todo.id).then(() => today.refetch())}
                      />
                      {todo.text}
                      {todo.due && <span className="text-muted-foreground">· by {todo.due}</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-10 lg:grid-cols-[1fr_300px]">
                <section>
                  <p className="text-sm text-muted-foreground">
                    {fmtDay()} · {data.phase.name} ({data.phase.hours_from}–{data.phase.hours_to}h)
                  </p>
                  <h1 className="fr mt-2 text-5xl font-medium tracking-tight">
                    {greeting()}
                    {name ? `, ${name}` : ""}.
                  </h1>
                  <p className="mt-2 flex items-center gap-2 text-muted-foreground">
                    {data.fallback ? (
                      <>
                        <CloudOff className="h-4 w-4" /> Using fallback material — generation failed
                        overnight.
                      </>
                    ) : data.materials_ready ? (
                      <>
                        <PackageCheck className="h-4 w-4" /> Materials prepared overnight. Just
                        press start.
                      </>
                    ) : (
                      "Materials are still being prepared."
                    )}
                  </p>

                  <div className="mt-8 flex flex-wrap items-center gap-5">
                    {firstOpen ? (
                      <RouteLink
                        route={withBlock(firstOpen.route, firstOpen.id)}
                        onClick={() => actions.start.mutate(firstOpen.id)}
                        className="inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 text-lg font-medium text-primary-foreground shadow-soft transition hover:opacity-90"
                      >
                        <Play className="h-5 w-5 fill-current" /> {t("startToday")}
                      </RouteLink>
                    ) : (
                      <span className="inline-flex items-center gap-3 rounded-full bg-secondary px-8 py-4 text-lg font-medium text-muted-foreground">
                        <Check className="h-5 w-5" /> All done today
                      </span>
                    )}
                    <label className="flex cursor-pointer items-center gap-3 text-sm">
                      <button
                        role="switch"
                        aria-checked={data.minimal}
                        onClick={() => actions.minimal.mutate(!data.minimal)}
                        className={cn(
                          "relative h-6 w-11 rounded-full transition",
                          data.minimal ? "bg-primary" : "bg-border",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all",
                            data.minimal ? "left-5" : "left-0.5",
                          )}
                        />
                      </button>
                      I only have 20 minutes today
                    </label>
                  </div>

                  <ol className="mt-10 space-y-2">
                    {data.blocks.map((b) => (
                      <li key={b.id}>
                        <RouteLink
                          route={withBlock(b.route, b.id)}
                          className={cn(
                            "group flex items-center gap-5 rounded-xl border px-5 py-4 transition",
                            b.status === "active"
                              ? "border-primary/40 bg-card shadow-soft"
                              : "border-transparent hover:border-border hover:bg-card",
                          )}
                        >
                          <span className="w-12 font-mono text-sm text-muted-foreground">
                            {b.start_time ?? "—"}
                          </span>
                          <StatusIcon s={b.status} />
                          <span
                            className={cn(
                              "flex-1",
                              b.status === "done" &&
                                "text-muted-foreground line-through decoration-border",
                            )}
                          >
                            {b.title}
                          </span>
                          <span className="text-sm text-muted-foreground">{b.planned_min} min</span>
                          {b.status === "active" && <Chip tone="accent">In progress</Chip>}
                          {b.status === "skipped" && <Chip>skipped</Chip>}
                        </RouteLink>
                      </li>
                    ))}
                  </ol>
                </section>

                <aside className="space-y-4">
                  <div className="panel p-6">
                    <Stat
                      label="Active hours this week"
                      value={
                        <>
                          {fmtHours(weekMin / 60)}
                          <span className="text-base text-muted-foreground">
                            {" "}
                            / {fmtHours(weekTarget / 60)}
                          </span>
                        </>
                      }
                    />
                    <div className="mt-3">
                      <Bar value={weekTarget ? weekMin / weekTarget : 0} />
                    </div>
                  </div>
                  <div className="panel grid grid-cols-2 gap-4 p-6">
                    <Stat
                      label={`To ${data.next_milestone.hours}h milestone`}
                      value={fmtHours(data.next_milestone.hours_to_go)}
                      sub={game.data ? `${fmtHours(game.data.hours_total)} logged` : undefined}
                    />
                    <Stat label="Cards due" value={queue.data?.counts.total ?? "—"} />
                  </div>
                  <div className="panel p-6 text-sm">
                    <div className="text-xs text-muted-foreground">Yesterday</div>
                    <p className="mt-1">
                      {data.yesterday.blocks_done} of {data.yesterday.blocks_total} blocks ·{" "}
                      {fmtMinutes(data.yesterday.active_minutes)} active
                      {data.yesterday.listening_understood_pct != null &&
                        ` · listening ${data.yesterday.listening_understood_pct}% understood`}
                      .
                    </p>
                  </div>
                  <Link
                    to="/hours"
                    className="block px-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    See hours & milestones →
                  </Link>
                </aside>
              </div>
            </>
          );
        }}
      </DataView>
    </AppShell>
  );
}
