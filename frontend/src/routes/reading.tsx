import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BlockShell, Chip, useBlockFlow } from "@/components/fr/kit";
import { btn, errorMessage, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { api } from "@/api";
import { DataView } from "@/components/fr/states";
import { ErrorState, Skeleton } from "@/components/fr/states";

export const Route = createFileRoute("/reading")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
  }),
  head: () =>
    meta(
      "Intensive reading",
      "Read a French passage sentence by sentence with grammar breakdowns and questions.",
    ),
  component: Reading,
});

function EntryPanel({ onPassage }: { onPassage: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = (body: { text?: string; generate?: { text_type: string; level: string } }) => {
    setBusy(true);
    setError(null);
    api.reading
      .create(body)
      .then((p) => onPassage(p.id))
      .catch((e: unknown) => setError(errorMessage(e, "Failed")))
      .finally(() => setBusy(false));
  };
  return (
    <div className="panel mx-auto max-w-2xl p-8">
      <h2 className="text-lg font-semibold">Start a reading</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Paste a text in the study page for the sentence-by-sentence breakdown (grammar, words,
        simple English). Your reading time is counted there; come back here and press Finish when
        you are done.
      </p>
      <a href="/study" className={`${btn.primary} mt-4`}>
        Open the sentence breakdown
      </a>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a French text (notice, email, ad, news…)…"
        className="fr mt-4 h-40 w-full resize-none rounded-lg border border-input bg-background p-4 text-lg outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={btn.primary}
          disabled={busy || text.trim().length < 20}
          onClick={() => create({ text: text.trim() })}
        >
          Read this text
        </button>
        <button
          className={btn.ghost}
          disabled={busy}
          onClick={() => create({ generate: { text_type: "notice", level: "A2" } })}
        >
          Generate · notice · A2
        </button>
        <button
          className={btn.ghost}
          disabled={busy}
          onClick={() => create({ generate: { text_type: "email", level: "B1" } })}
        >
          Generate · email · B1
        </button>
      </div>
    </div>
  );
}

function Reading() {
  const { block } = Route.useSearch();
  const flow = useBlockFlow(block);
  const [passageId, setPassageId] = useState<string | null>(null);
  const passage = useQuery({
    queryKey: ["passage", passageId],
    queryFn: () => api.reading.get(passageId ?? ""),
    enabled: !!passageId,
  });
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [startedAt] = useState(() => Date.now());
  const [markedRead, setMarkedRead] = useState(false);

  if (!passageId) {
    return (
      <BlockShell
        kicker="Intensive reading"
        title="Reading"
        progress={0}
        blockId={block}
        lane="reading"
      >
        <EntryPanel onPassage={setPassageId} />
      </BlockShell>
    );
  }
  if (passage.isPending)
    return (
      <BlockShell
        kicker="Intensive reading"
        title="Loading…"
        progress={0}
        blockId={block}
        lane="reading"
      >
        <Skeleton lines={6} />
      </BlockShell>
    );
  if (passage.isError)
    return (
      <BlockShell
        kicker="Intensive reading"
        title="Reading"
        progress={0}
        blockId={block}
        lane="reading"
      >
        <ErrorState error={passage.error} retry={passage.refetch} />
      </BlockShell>
    );

  const p = passage.data;
  if (!p) return null;
  const sentences = p.analysis.sentences;
  const cur = sentences[Math.min(i, sentences.length - 1)];
  if (!cur) return null;
  const total = sentences.length + p.questions.length;
  const doneCount = Math.min(i + 1, sentences.length) + open.size;
  const progress = Math.min(1, doneCount / total);

  const toggle = (k: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <BlockShell
      kicker={`Intensive reading · ${p.level}`}
      title={p.title}
      progress={progress}
      blockId={block}
      lane="reading"
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr_0.9fr]">
        <div className="panel space-y-1 p-6">
          {sentences.map((s, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              className={cn(
                "fr block w-full rounded-lg px-3 py-2 text-left text-xl leading-relaxed transition",
                k === i ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
              )}
            >
              {s.text}
            </button>
          ))}
          <button
            className={cn(btn.ghost, "mt-4 w-full")}
            disabled={markedRead}
            onClick={() => {
              setMarkedRead(true);
              void api.reading
                .done(p.id, Math.round((Date.now() - startedAt) / 1000))
                .then(() => flow.finish())
                .catch(() => setMarkedRead(false));
            }}
          >
            {markedRead ? "Marked as read ✓" : "Mark as read"}
          </button>
        </div>
        <div className="panel p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Grammar</div>
          {cur.grammar_points.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {cur.grammar_points.map((g) => (
                <li key={g.title}>
                  <b className="font-medium">{g.title}</b> — {g.explanation}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No grammar notes for this sentence.
            </p>
          )}
          {cur.build_up.length > 0 && (
            <>
              <div className="mt-6 text-xs uppercase tracking-wider text-muted-foreground">
                Build it up
              </div>
              <ol className="mt-3 space-y-2">
                {cur.build_up.map((l, k) => (
                  <li key={l} className="fr text-lg" style={{ paddingLeft: k * 12 }}>
                    <span className="ipa mr-2">{k + 1}</span>
                    {l}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <div className="space-y-4">
          <div className="panel p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Vocabulary</div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {cur.words.map((w) => (
                <li key={w.word} className="flex items-center justify-between gap-2">
                  <span className="fr text-base">{w.word}</span>
                  <span className="text-muted-foreground">{w.en}</span>
                  <button
                    className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                    onClick={() =>
                      void api.srs.addNote({
                        sentence: cur.text,
                        translation_en: cur.translation_en,
                      })
                    }
                  >
                    Add
                  </button>
                </li>
              ))}
              {cur.words.length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
          <button
            className={btn.ghost}
            onClick={() => setOpen(new Set(p.questions.map((_, k) => k)))}
          >
            Show all answers
          </button>
          {p.questions.map((x, k) => (
            <button key={k} onClick={() => toggle(k)} className="panel block w-full p-5 text-left">
              <Chip>{x.kind.replace("_", " ")}</Chip>
              <p className="mt-2 text-sm font-medium">{x.q}</p>
              {open.has(k) ? (
                <p className="mt-2 text-sm">
                  {x.a}{" "}
                  {x.evidence && (
                    <span className="fr block text-muted-foreground">{x.evidence}</span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Tap to see answer</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </BlockShell>
  );
}
