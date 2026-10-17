import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DataView } from "@/components/fr/states";
import { useState } from "react";
import { AppShell } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { AudioButton, Recorder } from "@/components/fr/widgets";

export const Route = createFileRoute("/shadow")({
  head: () => meta("Shadowing", "Word-by-word shadowing with pronunciation feedback."),
  component: Shadow,
});

type WordStatus = 0 | 1 | 2; // 0 wrong, 1 close, 2 good

function Shadow() {
  const query = useQuery({ queryKey: ["shadow-sentences"], queryFn: () => api.shadow.sentences() });
  return (
    <AppShell>
      <DataView query={query} isEmpty={(d) => d.length === 0}>
        {(sentences) => <ShadowPractice sentences={sentences} />}
      </DataView>
    </AppShell>
  );
}

function ShadowPractice({ sentences }: { sentences: { text: string; ipa: string }[] }) {
  const [idx, setIdx] = useState(0);
  const [statuses, setStatuses] = useState<WordStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const s = sentences[idx];
  const words = s?.text.split(" ") ?? [];

  const score = (blob: Blob) => {
    setBusy(true);
    void api.speech
      .transcribe(blob)
      .then((r) => {
        const said = r.text.toLowerCase();
        setStatuses(
          words.map((w): WordStatus =>
            said.includes(w.toLowerCase().replace(/[.,]/g, "")) ? 2 : 1,
          ),
        );
      })
      .catch(() => setStatuses(words.map(() => 1) as WordStatus[]))
      .finally(() => setBusy(false));
  };

  if (!s) return null;
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col px-6 py-8">
      <div className="text-xs text-muted-foreground">
        Shadowing · sentence {idx + 1} of {sentences.length}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="fr text-3xl leading-snug">
          {words.map((w, i) => (
            <span
              key={i}
              className={cn(
                "mx-1",
                statuses &&
                  (statuses[i] === 2
                    ? "text-primary"
                    : statuses[i] === 1
                      ? "text-warn"
                      : "text-destructive"),
              )}
            >
              {w}
            </span>
          ))}
        </p>
        <p className="ipa mt-3">{s.ipa}</p>
        {statuses && (
          <p className="mt-4 text-xs text-muted-foreground">
            Blue = clear, grey = close. Tap the mic to retry.
          </p>
        )}
      </div>
      <div className="flex items-center justify-center gap-5">
        <AudioButton url={api.speech.ttsUrl(s.text)} label="Model" />
        <Recorder onDone={score} className={cn(busy && "opacity-50")} />
        <button
          className={btn.ghost}
          onClick={() => {
            setStatuses(null);
            setIdx((i) => (i + 1) % sentences.length);
          }}
        >
          Next
        </button>
      </div>
      <Link to="/retell" className={`${btn.ghost} mt-6 self-center`}>
        Quick voice retell →
      </Link>
    </div>
  );
}
