import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { BlockShell, Bar, Chip } from "@/components/fr/kit";
import { btn, errorMessage, meta } from "@/components/fr/kit-utils";
import { api, type ListeningSession } from "@/api";
import { useActiveSeconds } from "@/api/use-active-seconds";
import { useListeningGate } from "@/api/hooks";
import { DataView, ErrorState, Skeleton } from "@/components/fr/states";
import { AudioButton } from "@/components/fr/widgets";
import { FrenchWords } from "@/components/fr/words";

export const Route = createFileRoute("/listening")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () => meta("Listening 3-step", "Listen, reveal, relisten and check understanding."),
  component: Listening,
});

function Listening() {
  const { block } = Route.useSearch();
  const [source, setSource] = useState("auto");
  const [round, setRound] = useState(0);
  const session = useQuery({
    queryKey: ["listening-session", block, source, round],
    queryFn: () => api.listening.createSession(block, source),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const gate = useListeningGate();
  const [updated, setUpdated] = useState<ListeningSession | null>(null);
  const [step, setStep] = useState(0);
  const [blindPlays, setBlindPlays] = useState(0);
  const [relistens, setRelistens] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const timer = useActiveSeconds(blindPlays > 0 && !busy && !updated?.result);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const s = updated ?? session.data;
  const next = () => {
    setUpdated(null);
    setStep(0);
    setBlindPlays(0);
    setRelistens(0);
    setSaved([]);
    timer.reset();
    setRound((v) => v + 1);
  };

  return (
    <BlockShell
      kicker="Listening · Phase A"
      title="Listening 3-step"
      progress={s?.result ? 1 : step / 4}
      blockId={block}
      finishDisabled={!s?.result}
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <label className="flex items-center gap-3 text-sm">
          Material pool
          <select
            className="rounded border bg-background p-2"
            value={source}
            disabled={busy}
            onChange={(e) => {
              setSource(e.target.value);
              next();
            }}
          >
            <option value="auto">Learned material</option>
            <option value="srs">Saved sentences</option>
            <option value="journal">My journal</option>
            <option value="story">Known-word story</option>
          </select>
        </label>
        {session.isPending ? (
          <Skeleton lines={6} />
        ) : session.isError ? (
          <>
            <ErrorState error={session.error} retry={session.refetch} />
            <p className="text-sm text-muted-foreground">
              Save a learned sentence in Cards or prepare a Journal to fill this pool.
            </p>
          </>
        ) : (
          s && (
            <>
              <div className="flex flex-wrap gap-2">
                {["Blind listen", "Reveal", "Relisten", "Check"].map((x, i) => (
                  <Chip key={x} tone={i === step ? "accent" : "muted"}>
                    {i + 1}. {x}
                  </Chip>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Speed ladder: {s.rate ?? 1}× · blind listen at normal speed
              </p>
              <div className="panel space-y-5 p-7">
                {step === 0 && (
                  <div className="space-y-5 text-center">
                    <AudioButton
                      url={s.audio_url_normal}
                      label="Blind listen"
                      onPlay={() => {
                        if (!blindPlays) timer.reset();
                        setBlindPlays((v) => v + 1);
                      }}
                    />
                    <p className="text-sm">Listen, then assess your understanding.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {(["Not yet", "Half", "Understood"] as const).map((label, i) => (
                        <button
                          key={label}
                          className={btn.ghost}
                          disabled={!blindPlays || busy}
                          onClick={() =>
                            void run(async () => {
                              await api.listening.blind(
                                s.id,
                                i as 0 | 1 | 2,
                                Math.min(blindPlays, 20),
                              );
                              setUpdated(await api.listening.reveal(s.id));
                              setStep(1);
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <>
                    <FrenchWords
                      text={s.material.text}
                      glosses={s.material.words.map((w) => ({
                        word: w.w,
                        ipa: w.ipa,
                        en: w.en,
                        note: w.note,
                      }))}
                      className="fr text-2xl leading-relaxed"
                    />
                    <p className="whitespace-pre-line text-sm">
                      {s.material.breakdown ||
                        "Offline sentence breakdown: translations and grammar require the AI gateway."}
                    </p>
                    {s.analysis?.sentences.map((sentence, i) => (
                      <div key={i} className="rounded bg-secondary p-4">
                        <FrenchWords text={sentence.text} glosses={sentence.words} className="fr" />
                        <p>{sentence.translation_en}</p>
                        {sentence.build_up.map((line, j) => (
                          <FrenchWords
                            key={j}
                            text={line}
                            glosses={sentence.words}
                            className="fr text-sm"
                          />
                        ))}
                        {sentence.grammar_points.map((g) => (
                          <p key={g.title} className="text-sm">
                            {g.title}: {g.explanation}
                          </p>
                        ))}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {s.material.words.map((w, i) => (
                        <button
                          key={i}
                          className={btn.ghost}
                          disabled={busy || saved.includes(w.w)}
                          title={`${w.en} ${w.note ?? ""}`}
                          onClick={() =>
                            void run(async () => {
                              await api.listening.addWord(s.id, s.material.text, w.w, w.en);
                              setSaved((v) => [...v, w.w]);
                            })
                          }
                        >
                          {w.w} {w.en && `· ${w.en}`} {saved.includes(w.w) ? "✓" : "+ card"}
                        </button>
                      ))}
                    </div>
                    <button className={btn.primary} onClick={() => setStep(2)}>
                      Relisten →
                    </button>
                  </>
                )}
                {step === 2 && (
                  <>
                    <p className="fr text-xl">{s.material.text}</p>
                    <div className="flex flex-wrap gap-3">
                      {["Slow ×1", "Normal ×1", "Normal ×2"].map((label, i) => (
                        <AudioButton
                          key={label}
                          url={i === 0 ? s.audio_url_slow : s.audio_url_normal}
                          label={relistens > i ? `${label} ✓` : label}
                          disabled={busy || relistens !== i}
                          onPlay={() =>
                            void run(async () => {
                              setUpdated(
                                await api.listening.relisten(
                                  s.id,
                                  i === 0 ? "slow20" : "normal",
                                  i,
                                ),
                              );
                              setRelistens((v) => v + 1);
                            })
                          }
                        />
                      ))}
                    </div>
                    <button
                      className={btn.primary}
                      disabled={relistens < 3}
                      onClick={() => setStep(3)}
                    >
                      Check understanding →
                    </button>
                  </>
                )}
                {step === 3 && (
                  <>
                    <p>{s.material.question.prompt}</p>
                    <div className="space-y-2">
                      {s.material.question.options.map((option, i) => (
                        <button
                          key={i}
                          className={`${btn.ghost} block w-full text-left`}
                          disabled={busy || !!s.result}
                          onClick={() =>
                            void run(async () => {
                              setUpdated(
                                await api.listening.check(s.id, i, Math.min(240, timer.read())),
                              );
                              void gate.refetch();
                            })
                          }
                        >
                          {option}
                          {s.result && s.material.question.answer_index === i ? " ✓" : ""}
                        </button>
                      ))}
                    </div>
                    {s.result && (
                      <>
                        <p>{s.result.correct ? "Correct." : "Keep practising — no penalty."}</p>
                        <p className="text-sm">{s.material.question.explanation}</p>
                        <blockquote className="fr text-sm">
                          {s.material.question.evidence}
                        </blockquote>
                        <button className={btn.primary} onClick={next}>
                          Next item →
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DataView query={gate} skeletonLines={2}>
          {(g) => (
            <div className="panel space-y-3 p-5">
              <p className="flex items-center gap-2">
                <Lock size={16} /> Real audio · all conditions required (200–300h transition)
              </p>
              <div className="grid grid-cols-3 gap-4 text-xs">
                {[g.hours, g.understood_pct, g.unseen_quiz_pct].map((v, i) => (
                  <div key={i}>
                    {["Active hours", "Last 10 normal-speed understood %", "Unseen CO quiz %"][i]}
                    <p>
                      {v.value} / {v.target}
                    </p>
                    <Bar value={v.value / v.target} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Unseen CO validation quizzes arrive in a later phase. Practice answers do not unlock
                real audio.
              </p>
            </div>
          )}
        </DataView>
      </div>
    </BlockShell>
  );
}
