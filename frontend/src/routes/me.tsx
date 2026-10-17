import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Bar, BestOnDesktop, Stat } from "@/components/fr/kit";
import { meta } from "@/components/fr/kit-utils";
import { useGameState, useHoursLedger, useMe } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import { fmtHours } from "@/lib/format";

export const Route = createFileRoute("/me")({
  head: () => meta("Me", "Your totals, streak and account."),
  component: Me,
});

function Me() {
  const me = useMe();
  const game = useGameState();
  const ledger = useHoursLedger();

  return (
    <AppShell>
      <div className="mx-auto max-w-xl px-4 py-10 md:px-10">
        <h1 className="fr text-3xl">Me</h1>
        <DataView query={me} skeletonLines={2}>
          {(u) => <p className="mt-1 text-sm text-muted-foreground">{u.email ?? "Signed in"}</p>}
        </DataView>

        <div className="panel mt-6 grid grid-cols-2 gap-6 p-6">
          <DataView query={game} skeletonLines={2}>
            {(g) => (
              <>
                <Stat label="Total hours" value={fmtHours(g.hours_total)} />
                <Stat label="Streak" value={`${g.streak_days} days`} />
              </>
            )}
          </DataView>
        </div>

        <DataView query={ledger} skeletonLines={2}>
          {(l) => (
            <div className="panel mt-4 p-6">
              <Stat
                label={`To ${l.next_milestone}h milestone`}
                value={fmtHours(l.hours_to_go)}
                sub={l.phase}
              />
              <div className="mt-3">
                <Bar value={(l.active_hours + l.manual_hours) / l.next_milestone} />
              </div>
            </div>
          )}
        </DataView>

        <div className="mt-6">
          <BestOnDesktop
            items={[
              "Intensive reading with grammar panels",
              "Writing exam with rubric",
              "Decision board & item bank",
            ]}
          />
        </div>

        <Link
          to="/settings"
          className="mt-6 block px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Settings →
        </Link>
      </div>
    </AppShell>
  );
}
