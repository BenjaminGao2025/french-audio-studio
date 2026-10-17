import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Play, Turtle } from "lucide-react";
import { BlockShell, Bar, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { useListeningGate } from "@/api/hooks";
import { DataView, ErrorState, Skeleton } from "@/components/fr/states";
import { AudioButton } from "@/components/fr/widgets";

export const Route = createFileRoute("/listening")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta(
      "Listening 3-step",
      "Blind listen, reveal and break down, then relisten and check understanding.",
    ),
  component: Listening,
});

const relistenStages = [
  { label: "Slow ×1", stage: "slow20" as const },
  { label: "Normal ×1", stage: "normal" as const },
  { label: "Normal ×2", stage: "normal" as const },
];

function Listening() {
  const { block } = Route.useSearch();
  const session = useQuery({
    queryKey: ["listening-session", block ?? "solo"],
    queryFn: () => api.listening.createSession(block),
  });
  const gate = useListeningGate();

  const [step, setStep] = useState(0);
  const [gist, setGist] = useState<0 | 1 | 2 | null>(null);
  const [sel, setSel] = useState(0);
  const [blindPlays, setBlindPlays] = useState(0);
  const [relistenDone, setRelistenDone] = useState<boolean[]>([false, false, false]);
  const [ans, setAns] = useState<number | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);

  if (session.isPending)
    return (
      <BlockShell
        kicker="Listening"
        title="Listening 3-step"
        progress={0}
        blockId={block}
        lane="listening"
      >
        <Skeleton lines={6} />
      </BlockShell>
    );
  if (session.isError)
    return (
      <BlockShell
        kicker="Listening"
        title="Listening 3-step"
        progress={0}
        blockId={block}
        lane="listening"
      >
        <ErrorState error={session.error} retry={session.refetch} />
      </BlockShell>
    );

  const s = session.data;
  if (!s) return null;
  const words = s.material.words;
  const q = s.material.question;
  const audioUrl = (slow: boolean) => {
    const u = slow ? s.audio_url_slow : s.audio_url_normal;
    return u || api.speech.ttsUrl(s.material.text);
  };

  return (
    <BlockShell
      kicker={`Item ${s.index} of ${s.total}`}
      title="Listening 3-step"
      progress={(s.index - 1 + step / 4) / s.total}
      blockId={block}
      lane="listening"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            {["Blind listen", "Reveal", "Relisten", "Check"].map((x, i) => (
              <Chip key={x} tone={i === step ? "accent" : "muted"}>
                {i + 1}. {x}
              </Chip>
            ))}
          </div>
          <Chip>
            <Turtle className="h-3 w-3" />{" "}
            {s.rate_stage === "normal" ? "Normal speed" : s.rate_stage}
          </Chip>
        </div>

        <div className="panel p-10">
          {step === 0 && (
            <div className="text-center">
              <AudioButton
                url={audioUrl(false)}
                label="Play audio"
                size="lg"
                onPlay={() => setBlindPlays((p) => p + 1)}
              />
              <p className="mt-4 text-sm text-muted-foreground">
                Normal speed · no text · {blindPlays ? `played ${blindPlays}×` : "tap to play"}
              </p>
              <p className="mt-10 text-sm font-medium">How much did you understand?</p>
              <div className="mt-3 flex justify-center gap-2">
                {(["Understood", "Half", "Not at all"] as const).map((g, gi) => (
                  <button
                    key={g}
                    disabled={blindPlays === 0}
                    onClick={() => {
                      const self = (gi === 0 ? 2 : gi === 1 ? 1 : 0) as 0 | 1 | 2;
                      setGist(self);
                      void api.listening.blind(s.id, self, blindPlays);
                      setStep(1);
                    }}
                    className={cn(btn.ghost, gist !== null && "border-primary")}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {blindPlays === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Listen at least once first.</p>
              )}
            </div>
          )}
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">Tap any word.</p>
              <p className="fr mt-4 flex flex-wrap gap-x-2 gap-y-1 text-3xl leading-relaxed">
                {words.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setSel(i)}
                    className={cn(
                      "rounded px-0.5 transition",
                      sel === i ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
                    )}
                  >
                    {t.w}
                  </button>
                ))}
              </p>
              {words[sel] && (
                <div className="mt-8 rounded-lg bg-secondary p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="fr text-xl">{words[sel]?.w.replace(/[.,]/g, "")}</span>
                    <span className="ipa">{words[sel]?.ipa}</span>
                  </div>
                  <div className="mt-1 text-sm">{words[sel]?.en}</div>
                  {words[sel]?.note && (
                    <div className="mt-2 text-sm text-muted-foreground">{words[sel]?.note}</div>
                  )}
                  <button
                    className="mt-3 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card"
                    onClick={() => void api.srs.addNote({ sentence: s.material.text })}
                  >
                    Add to cards
                  </button>
                </div>
              )}
              {s.material.breakdown && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Breakdown: <span className="text-foreground">{s.material.breakdown}</span>
                </div>
              )}
              <button
                className={cn(btn.primary, "mt-8")}
                onClick={() => {
                  void api.listening.reveal(s.id);
                  setStep(2);
                }}
              >
                Relisten →
              </button>
            </>
          )}
          {step === 2 && (
            <div className="text-center">
              <div className="flex justify-center gap-3">
                {relistenStages.map((r, i) => (
                  <AudioButton
                    key={r.label}
                    url={audioUrl(r.stage === "slow20")}
                    label={r.label}
                    disabled={i > 0 && !relistenDone[i - 1]}
                    onPlay={() => {
                      setRelistenDone((prev) => prev.map((v, k) => (k === i ? true : v)));
                      void api.listening.relisten(s.id, r.stage);
                    }}
                  />
                ))}
              </div>
              <p className="mt-6 text-sm text-muted-foreground">
                Once slow, then normal twice. Follow the text with your eyes.
              </p>
              <button
                className={cn(btn.primary, "mt-8")}
                disabled={!relistenDone.every(Boolean)}
                onClick={() => setStep(3)}
              >
                Answer the question →
              </button>
            </div>
          )}
          {step === 3 && (
            <>
              <p className="font-medium">{q.prompt}</p>
              <div className="mt-4 space-y-2">
                {q.options.map((opt, i) => (
                  <button
                    key={opt}
                    disabled={ans !== null}
                    onClick={() => {
                      setAns(i);
                      void api.listening
                        .check(s.id, i)
                        .then((r) => setCorrect(r.result?.correct ?? i === q.answer_index));
                    }}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left text-sm transition",
                      ans === null
                        ? "border-border hover:bg-secondary"
                        : i === q.answer_index
                          ? "border-primary bg-accent"
                          : ans === i
                            ? "border-destructive/50 bg-destructive/5"
                            : "border-border opacity-60",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {ans !== null && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {q.evidence && <span className="fr">“{q.evidence}” </span>}
                  {correct ? "Correct." : "Logged — no penalty. It comes back in review."}
                </p>
              )}
            </>
          )}
        </div>

        <DataView query={gate} skeletonLines={2}>
          {(g) =>
            g.unlocked ? (
              <a
                href="/listen"
                className="panel mt-6 flex items-center gap-5 p-5 transition hover:bg-secondary"
              >
                <Play className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Open real material →</span>
              </a>
            ) : (
              <div className="mt-6 flex items-center gap-5 rounded-xl border border-dashed border-border p-5">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    Real audio{" "}
                    <span className="font-normal text-muted-foreground">
                      · unlocks when all three are met
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                    <div>
                      {g.hours.value} / {g.hours.target}h
                      <Bar value={g.hours.value / g.hours.target} />
                    </div>
                    <div>
                      {g.understood_pct.value} / {g.understood_pct.target}% understood
                      <Bar value={g.understood_pct.value / g.understood_pct.target} />
                    </div>
                    <div>
                      {g.unseen_quiz_pct.value} / {g.unseen_quiz_pct.target}% unseen quiz
                      <Bar value={g.unseen_quiz_pct.value / g.unseen_quiz_pct.target} />
                    </div>
                  </div>
                </div>
              </div>
            )
          }
        </DataView>
      </div>
    </BlockShell>
  );
}
