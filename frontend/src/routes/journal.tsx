import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, EyeOff, Plus, Volume2 } from "lucide-react";
import { BlockShell } from "@/components/fr/kit";
import { btn, errorMessage, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { Skeleton } from "@/components/fr/states";
import { AudioButton, Recorder } from "@/components/fr/widgets";
import type { Journal } from "@/api/types";

export const Route = createFileRoute("/journal")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta(
      "Journal block",
      "Say what you want to say: write, translate, shadow and recite in French.",
    ),
  component: JournalPage,
});

const stepNames = [
  "Write in Chinese",
  "Simple French",
  "Shadow by sentence",
  "Full shadow + record",
  "Recite + record",
];

function JournalPage() {
  const { block } = Route.useSearch();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [cur, setCur] = useState(0);
  const [native, setNative] = useState("");
  const [journal, setJournal] = useState<Journal | null>(null);
  const [recalled, setRecalled] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reflection, setReflection] = useState("");

  const analysis = useQuery({
    queryKey: ["journal-analysis", journal?.id],
    queryFn: () => api.analyze.text(journal?.french ?? ""),
    enabled: !!journal?.french,
  });

  const go = (next: number) => {
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
  };

  // Older entries have French but no parts: fall back to its paragraphs.
  const parts = journal?.parts.length
    ? journal.parts
    : (journal?.french ?? "")
        .split(/\n\s*\n/)
        .filter((french) => french.trim())
        .map((french) => ({ source: "", french }));
  const hasFirst = !!journal?.recordings.some((r) => r.kind === "first");
  const hasFinal = !!journal?.recordings.some((r) => r.kind === "final");
  const newWords = analysis.data?.sentences.flatMap((s) => s.words).slice(0, 6) ?? [];

  const createAndPrepare = () => {
    if (native.trim().length < 5) return;
    setBusy(true);
    setError(null);
    // A failed prepare (slow AI, 503) keeps the entry, so a retry does not create another one.
    const entry =
      journal && journal.native_text === native.trim()
        ? Promise.resolve(journal)
        : api.homework.create(native.trim()).then((j) => {
            setJournal(j);
            return j;
          });
    void entry
      .then((j) => api.homework.prepare(j.id))
      .then((j) => {
        setJournal(j);
        go(1);
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const upload = (kind: "first" | "final", blob: Blob, then?: () => void) => {
    if (!journal) return;
    setBusy(true);
    setError(null);
    void api.homework
      .uploadRecording(journal.id, kind, blob)
      .then((j) => {
        setJournal(j);
        then?.();
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const errorAlert = error && (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {error}
    </p>
  );

  return (
    <BlockShell
      kicker="Journal · 45 min"
      title="“Say what I want to say” journal"
      progress={(step + (saved ? 1 : 0)) / 5}
      blockId={block}
      lane="speaking"
      finishDisabled={!saved}
    >
      <ol className="mb-8 grid grid-cols-5 gap-2">
        {stepNames.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => i <= maxStep && setStep(i)}
              disabled={i > maxStep}
              className="w-full text-left disabled:cursor-not-allowed"
            >
              <div
                className={cn(
                  "h-1 rounded-full",
                  i < step ? "bg-primary" : i === step ? "bg-primary/50" : "bg-border",
                )}
              />
              <div
                className={cn(
                  "mt-2 text-xs",
                  i === step ? "font-medium" : "text-muted-foreground",
                  i > maxStep && "opacity-40",
                )}
              >
                {i + 1}. {s}
              </div>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="panel min-h-[460px] p-10">
          {step === 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                Write today's thought in Chinese. 50–100 characters. Don't think about French yet.
              </p>
              <textarea
                value={native}
                onChange={(e) => setNative(e.target.value)}
                className="mt-4 h-64 w-full resize-none rounded-lg border border-input bg-background p-4 text-lg outline-none focus:ring-2 focus:ring-ring"
                placeholder="今天…"
              />
              {errorAlert}
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{native.trim().length} characters · aim for 50–100</span>
                <button
                  className={btn.primary}
                  disabled={busy || native.trim().length < 5}
                  onClick={createAndPrepare}
                >
                  Make simple French →
                </button>
              </div>
            </>
          )}

          {step === 1 && journal && (
            <>
              <p className="text-sm text-muted-foreground">
                Your thought in simple A2 French. Listen once to each sentence.
              </p>
              <div className="mt-4">
                <AudioButton
                  url={journal.reference_url ? api.homework.referenceUrl(journal.id) : null}
                  label="Listen once"
                />
              </div>
              <div className="mt-6 space-y-5">
                {parts.map((p, i) => (
                  <div key={i} className="flex gap-4">
                    <span className="mt-1">
                      <AudioButton url={api.speech.ttsUrl(p.french)} label="" />
                    </span>
                    <div>
                      <p className="fr text-2xl">{p.french}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{p.source}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className={cn(btn.primary, "mt-8")} onClick={() => go(2)}>
                Start shadowing →
              </button>
            </>
          )}

          {step === 2 && parts.length > 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">
                Sentence {cur + 1} of {parts.length} · listen, then say it at the same time
              </p>
              <p className="fr mt-8 text-4xl leading-snug">{parts[cur]!.french}</p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <AudioButton url={api.speech.ttsUrl(parts[cur]!.french)} label="Play" />
                <Recorder
                  onDone={() => void api.homework.practice(journal!.id, `${cur}-${Date.now()}`, 10)}
                />
                <button
                  className={btn.primary}
                  onClick={() => (cur < parts.length - 1 ? setCur(cur + 1) : go(3))}
                >
                  Next sentence
                </button>
              </div>
            </div>
          )}

          {step === 3 && journal && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="fr max-w-xl space-y-2 text-2xl leading-relaxed">
                {parts.map((p, i) => (
                  <p key={i}>{p.french}</p>
                ))}
              </div>
              <div className="mt-10">
                {hasFirst ? (
                  <button className={btn.primary} onClick={() => go(4)}>
                    First recording saved · continue →
                  </button>
                ) : (
                  <Recorder
                    maxSeconds={180}
                    onDone={(blob) => upload("first", blob, () => go(4))}
                  />
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Shadow the full text and record</p>
              {errorAlert}
            </div>
          )}

          {step === 4 && journal && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex flex-col items-center text-muted-foreground">
                <EyeOff className="h-8 w-8" />
                <p className="mt-3">Text hidden. Recite from memory and record it.</p>
              </div>
              <div className="mt-8 flex items-center gap-3">
                <Recorder maxSeconds={180} onDone={(blob) => upload("final", blob)} />
                {hasFinal && (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <Check className="h-4 w-4" /> Final recording saved
                  </span>
                )}
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recalled}
                  onChange={(e) => setRecalled(e.target.checked)}
                />
                I said it without looking at the text
              </label>
              <textarea
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                placeholder="Quick reflection (what was hard?)…"
                className="mt-4 h-20 w-full max-w-xl resize-none rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                className={cn(btn.primary, "mt-4")}
                disabled={saved || busy || !hasFinal || reflection.trim().length < 3}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void api.homework
                    .finish(journal.id, reflection.trim(), recalled)
                    .then((j) => {
                      setJournal(j);
                      setSaved(true);
                    })
                    .catch((e: unknown) => setError(errorMessage(e)))
                    .finally(() => setBusy(false));
                }}
              >
                {saved ? "Saved ✓" : "Finish journal"}
              </button>
              {errorAlert}
              {saved && (
                <a
                  href={api.homework.archiveUrl(journal.id)}
                  className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-3 w-3" /> Download archive (.zip)
                </a>
              )}
            </div>
          )}
        </div>

        <aside className="panel h-fit p-6">
          <h2 className="text-sm font-medium">Today's new words</h2>
          {analysis.isPending && journal?.french ? (
            <div className="mt-4">
              <Skeleton lines={4} />
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {newWords.map((w) => (
                <li key={w.word} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="fr text-lg">{w.word}</div>
                    <div className="ipa">{w.ipa}</div>
                    <div className="text-xs text-muted-foreground">{w.en}</div>
                  </div>
                  <button
                    onClick={() => {
                      void api.srs.addNote({
                        sentence: w.word,
                        translation_en: w.en,
                        modes: ["listen", "speak"],
                      });
                      setAdded([...added, w.word]);
                    }}
                    disabled={added.includes(w.word)}
                    className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:border-transparent disabled:bg-accent disabled:text-accent-foreground"
                  >
                    {added.includes(w.word) ? (
                      "Added"
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Plus className="h-3 w-3" />
                        Add to cards
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {newWords.length === 0 && (
                <li className="text-sm text-muted-foreground">New words appear after step 2.</li>
              )}
            </ul>
          )}
          {journal && (
            <div className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
              <Volume2 className="mr-1 inline h-3 w-3" /> Reference audio plays from the server.
            </div>
          )}
        </aside>
      </div>
    </BlockShell>
  );
}
