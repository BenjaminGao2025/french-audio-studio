import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, Ring } from "@/components/fr/kit";
import { btn, errorMessage, meta } from "@/components/fr/kit-utils";
import { api } from "@/api";
import { Recorder } from "@/components/fr/widgets";
import { Skeleton, DataView, EmptyState } from "@/components/fr/states";
import type { ReciteResult } from "@/api/types";

export const Route = createFileRoute("/retell")({
  head: () => meta("Retell", "Retell today's text from memory and get a similarity score."),
  component: Retell,
});

function Retell() {
  const journals = useQuery({ queryKey: ["homework"], queryFn: () => api.homework.list() });
  const latest = journals.data?.entries
    .slice()
    .sort((a, b) => String(b["created_at"] ?? "").localeCompare(String(a["created_at"] ?? "")))[0];
  const [result, setResult] = useState<ReciteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center px-6 py-8 text-center">
        <h1 className="text-lg font-semibold">Retell today's text without looking</h1>
        <p className="mt-1 text-sm text-muted-foreground">~30 seconds · from memory</p>
        <div className="flex flex-1 flex-col items-center justify-center">
          <DataView
            query={journals}
            isEmpty={(d) => d.entries.length === 0}
            empty={<EmptyState title="No journal today — do the Journal block first" />}
          >
            {() =>
              busy ? (
                <Skeleton lines={4} />
              ) : result ? (
                <>
                  <Ring
                    value={result.similarity}
                    size={120}
                    label={`${Math.round(result.similarity * 100)}%`}
                  />
                  <p className="mt-4 font-medium">
                    {result.passed_count === result.total
                      ? "Similar to the original"
                      : `${result.passed_count} of ${result.total} sentences kept`}
                  </p>
                  <ul className="mt-4 max-w-md space-y-1 text-left text-sm text-muted-foreground">
                    {result.sentences.map((s, i) => (
                      <li key={i}>
                        {s.passed ? "✓" : "✗"} <span className="fr">{s.text}</span>
                      </li>
                    ))}
                  </ul>
                  {result.new_speak_cards > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {result.new_speak_cards} speak card(s) created for missed sentences.
                    </p>
                  )}
                  <Link to="/" className={`${btn.primary} mt-8`}>
                    Back to Today
                  </Link>
                </>
              ) : (
                <>
                  <Recorder
                    onDone={(blob) => {
                      if (!latest) return;
                      setBusy(true);
                      setError(null);
                      void api.homework
                        .recite(latest.id, blob)
                        .then(setResult)
                        .catch((e: unknown) => setError(errorMessage(e)))
                        .finally(() => setBusy(false));
                    }}
                  />
                  {error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </>
              )
            }
          </DataView>
        </div>
      </div>
    </AppShell>
  );
}
