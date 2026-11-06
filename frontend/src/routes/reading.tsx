import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BlockShell, Chip } from "@/components/fr/kit";
import { btn, errorMessage, meta } from "@/components/fr/kit-utils";
import { api, type Passage } from "@/api";
import { useActiveSeconds } from "@/api/use-active-seconds";
import { Skeleton } from "@/components/fr/states";
import { FrenchWords } from "@/components/fr/words";

export const Route = createFileRoute("/reading")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta("Intensive reading", "Read, break down sentences, save words and check understanding."),
  component: Reading,
});

function Reading() {
  const { block } = Route.useSearch();
  const [passage, setPassage] = useState<Passage | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("notice");
  const [level, setLevel] = useState("A2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const timer = useActiveSeconds(!!passage && !passage.result && !busy);
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
  const create = (importText: boolean) =>
    void run(async () => {
      const p = await api.reading.create(
        importText ? { text: text.trim() } : { generate: { text_type: kind, level } },
      );
      setPassage(p);
      setAnswers(p.questions.map(() => -1));
      timer.reset();
    });
  const cur = passage?.analysis.sentences[selected];

  return (
    <BlockShell
      kicker="Intensive reading · Phase A"
      title={passage?.title ?? "Reading"}
      progress={passage?.result ? 1 : passage ? 0.5 : 0}
      blockId={block}
      finishDisabled={!passage?.result}
    >
      {error && (
        <p role="alert" className="mb-4 text-destructive">
          {error}
        </p>
      )}
      {!passage ? (
        <div className="panel mx-auto max-w-2xl space-y-4 p-7">
          <p>Choose a short A1–A2 text, then study each sentence and answer the questions.</p>
          <div className="flex gap-3">
            <select
              aria-label="Text type"
              className="rounded border bg-background p-2"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {["notice", "email", "ad", "article"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select
              aria-label="Level"
              className="rounded border bg-background p-2"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option>A1</option>
              <option>A2</option>
            </select>
            <button className={btn.primary} disabled={busy} onClick={() => create(false)}>
              Generate passage
            </button>
          </div>
          <textarea
            aria-label="Your French text"
            className="fr h-40 w-full rounded border bg-background p-4"
            placeholder="Or paste your journal or another French text…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className={btn.ghost}
            disabled={busy || text.trim().length < 20 || text.length > 5000}
            onClick={() => create(true)}
          >
            Read this text
          </button>
          {busy && <Skeleton lines={4} />}
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {passage.level} · {passage.text_type} · {passage.source}
            {passage.source === "fixture" ? " · offline practice text" : ""}
          </p>
          {!cur ? (
            <p>No sentence breakdown is available. Try another passage.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="panel space-y-2 p-6">
                {passage.analysis.sentences.map((s, i) => (
                  <button
                    key={i}
                    className={`fr block w-full rounded p-3 text-left text-xl ${i === selected ? "bg-accent" : "hover:bg-secondary"}`}
                    onClick={() => setSelected(i)}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
              <div className="panel space-y-4 p-6">
                <FrenchWords
                  text={cur.text}
                  glosses={cur.words}
                  className="fr text-xl"
                  sentenceControls
                />
                <p>
                  {cur.translation_en ||
                    "Offline breakdown: translations and grammar need the AI gateway."}
                </p>
                {cur.build_up.map((line, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="fr">{i + 1}.</span>
                    <FrenchWords text={line} glosses={cur.words} className="fr" />
                  </div>
                ))}
                {cur.grammar_points.map((g) => (
                  <p key={g.title} className="text-sm">
                    <b>{g.title}</b> — {g.explanation}
                  </p>
                ))}
                <p className="text-sm font-medium">Vocabulary → cloze cards</p>
                {cur.words.map((w, i) => (
                  <button
                    key={i}
                    className={`${btn.ghost} mr-2 mb-2`}
                    disabled={busy || saved.includes(`${selected}:${w.word}`)}
                    onClick={() =>
                      void run(async () => {
                        await api.reading.addWord(passage.id, cur.text, w.word, w.en);
                        setSaved((v) => [...v, `${selected}:${w.word}`]);
                      })
                    }
                  >
                    {w.word} · {w.en} {saved.includes(`${selected}:${w.word}`) ? "✓" : "+"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mx-auto mt-6 max-w-2xl space-y-4">
            {passage.questions.map((q, i) => (
              <div key={i} className="panel space-y-3 p-5">
                <Chip>{q.kind}</Chip>
                <p>{q.q}</p>
                {q.options.map((option, j) => (
                  <button
                    key={j}
                    disabled={busy || !!passage.result}
                    className={`${btn.ghost} block w-full text-left ${answers[i] === j ? "bg-accent" : ""}`}
                    onClick={() => setAnswers((v) => v.map((a, k) => (k === i ? j : a)))}
                  >
                    {option}
                    {passage.result && q.answer_index === j ? " ✓" : ""}
                  </button>
                ))}
                {passage.result && (
                  <>
                    <p className="text-sm">{q.explanation}</p>
                    <blockquote className="fr text-sm text-muted-foreground">
                      {q.evidence}
                    </blockquote>
                  </>
                )}
              </div>
            ))}
            {passage.result ? (
              <>
                <p>
                  {passage.result.correct} / {passage.questions.length} correct · attempt saved
                </p>
                <button
                  className={btn.primary}
                  onClick={() => {
                    setPassage(null);
                    setSaved([]);
                    setSelected(0);
                  }}
                >
                  Read another passage
                </button>
              </>
            ) : (
              <button
                className={btn.primary}
                disabled={busy || answers.some((a) => a < 0)}
                onClick={() =>
                  void run(async () => {
                    setPassage(
                      await api.reading.done(passage.id, Math.min(1200, timer.read()), answers),
                    );
                  })
                }
              >
                Submit answers & mark read
              </button>
            )}
          </div>
        </>
      )}
    </BlockShell>
  );
}
