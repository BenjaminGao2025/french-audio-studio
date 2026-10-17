import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, SkipForward } from "lucide-react";
import { Ring, useBlockFlow } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { useToday, useMe } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import { api } from "@/api";
import { fmtMinutes } from "@/lib/format";

export const Route = createFileRoute("/wrapup")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () => meta("Wrap-up", "A calm summary of today's French study blocks."),
  component: Wrap,
});

const questions = [
  ["hard", "What was hard today?"],
  ["solved", "What did you push through?"],
  ["unsolved", "What's still unsolved?"],
  ["tomorrow", "What will you try tomorrow?"],
] as const;

function Wrap() {
  const today = useToday();
  const { block } = Route.useSearch();
  const flow = useBlockFlow(block);
  const me = useMe();
  const name = me.data?.email?.split("@")[0];
  const [fields, setFields] = useState({ hard: "", solved: "", unsolved: "", tomorrow: "" });
  const [mood, setMood] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = Object.values(fields).some((v) => v.trim().length > 0);

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-lg text-center">
        <DataView query={today}>
          {(d) => {
            const doneMin = d.blocks.reduce((acc, b) => acc + b.actual_sec / 60, 0);
            const doneCount = d.blocks.filter((b) => b.status === "done").length;
            return (
              <>
                <Ring
                  value={d.blocks.length ? doneCount / d.blocks.length : 0}
                  size={96}
                  label={fmtMinutes(doneMin)}
                />
                <h1 className="fr mt-6 text-4xl">Bien joué{name ? `, ${name}` : ""}.</h1>
                <p className="mt-2 text-muted-foreground">
                  Today is logged. Tomorrow is already prepared.
                </p>
                <ul className="panel mt-8 divide-y divide-border text-left text-sm">
                  {d.blocks.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                      {b.status === "done" ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <SkipForward className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="flex-1">{b.title}</span>
                      <span className="text-muted-foreground">
                        {b.status === "done"
                          ? fmtMinutes(b.actual_sec / 60)
                          : b.status === "skipped"
                            ? "skipped · moved to tomorrow"
                            : "not done"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            );
          }}
        </DataView>

        {saved ? (
          <p className="mt-6 text-sm text-muted-foreground">Review saved. See you tomorrow.</p>
        ) : (
          <form
            className="mt-6 space-y-4 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              if (!filled) return;
              setBusy(true);
              void api.reviews
                .add({
                  day: new Date().toISOString().slice(0, 10),
                  ...fields,
                  mood: mood ?? undefined,
                })
                .then(() => {
                  setSaved(true);
                  if (block) flow.finish();
                })
                .finally(() => setBusy(false));
            }}
          >
            {questions.map(([k, label]) => (
              <div key={k}>
                <label className="text-sm text-muted-foreground">{label}</label>
                <input
                  value={fields[k]}
                  onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-input bg-card px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mood:</span>
              {[1, 2, 3, 4, 5].map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMood(m)}
                  className={`h-8 w-8 rounded-full border text-sm ${mood === m ? "border-primary bg-accent" : "border-border"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button className={btn.primary} disabled={!filled || busy}>
              Save review
            </button>
            {!filled && (
              <p className="text-xs text-muted-foreground">Answer at least one question.</p>
            )}
          </form>
        )}
        <Link to="/" className={`${btn.ghost} mt-8`}>
          Back to Today
        </Link>
      </div>
    </div>
  );
}
