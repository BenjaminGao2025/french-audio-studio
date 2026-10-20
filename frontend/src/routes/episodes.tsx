import { audioController } from "@/lib/audio-controller";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Headphones, Plus, Trash2 } from "lucide-react";
import { AppShell, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { useEpisodes } from "@/api/hooks";
import { DataView, EmptyState } from "@/components/fr/states";
import { BlockTimer } from "@/components/fr/widgets";
import { api } from "@/api";

export const Route = createFileRoute("/episodes")({
  head: () =>
    meta("Episodes", "Passive listening: generated French episodes for the car and the couch."),
  component: Episodes,
});

function Episodes() {
  const eps = useEpisodes();
  const [minutes, setMinutes] = useState(20);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <AppShell>
      <BlockTimer lane="car" active={playing !== null} />
      <div className="mx-auto max-w-xl px-4 py-10 md:px-10">
        <h1 className="fr text-3xl">Listen on the go</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Passive playback — logged as Input hours, never toward the 1000h goal.
        </p>

        <form
          className="panel mt-6 flex flex-wrap items-center gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void api.episodes
              .create({ minutes, request: request || undefined, level: "A2" })
              .then(() => {
                setRequest("");
                eps.refetch();
              })
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Could not create the episode."),
              )
              .finally(() => setBusy(false));
          }}
        >
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {[20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Topic (optional)…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button className={btn.ghost} disabled={busy}>
            <Plus className="h-4 w-4" /> New episode
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <DataView
          query={eps}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              title="No episodes yet"
              hint="Generate one above — tonight's episode includes your journal sentences."
            />
          }
        >
          {(list) => (
            <ul className="mt-4 space-y-3">
              {list.map((ep) => (
                <li key={ep.id} className="panel p-5">
                  <div className="flex items-center gap-3">
                    <Headphones className="h-5 w-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {ep.title || (ep.status === "generating" ? "Generating…" : "Untitled")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ep.level} · {ep.minutes} min · {ep.created_at}
                      </div>
                    </div>
                    <Chip>{ep.status && ep.status !== "ready" ? ep.status : ep.level}</Chip>
                    <button
                      onClick={() =>
                        void api.episodes.remove(ep.id).then(() => {
                          if (playing === ep.id) setPlaying(null);
                          return eps.refetch();
                        })
                      }
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete episode"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {ep.status === "failed" && ep.error && (
                    <p className="mt-2 text-xs text-destructive">{ep.error}</p>
                  )}
                  {(!ep.status || ep.status === "ready") && (
                    <audio
                      controls
                      preload="none"
                      src={api.episodes.audioUrl(ep.id)}
                      onPlay={(event) => {
                        const current = event.currentTarget;
                        audioController.claim(current);
                        setPlaying(ep.id);
                      }}
                      onEnded={() => setPlaying((p) => (p === ep.id ? null : p))}
                      onError={() => setPlaying((p) => (p === ep.id ? null : p))}
                      onPause={() => setPlaying((p) => (p === ep.id ? null : p))}
                      className="mt-3 w-full"
                    />
                  )}
                  {playing === ep.id && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Playing — car lane heartbeat active.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DataView>
      </div>
    </AppShell>
  );
}
