import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell, Chip, BlockControls } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { cn } from "@/lib/utils";
import { useArchiveCard, useMasteredCards, useReviewCard, useSrsQueue } from "@/api/hooks";
import { useT } from "@/i18n";
import { NEW_LIMIT_MAX, saveNewLimit, syncNewLimit } from "@/lib/new-limit";
import type { SrsCard } from "@/api";
import { DataView, EmptyState } from "@/components/fr/states";
import { AudioButton, BlockTimer } from "@/components/fr/widgets";
import { api } from "@/api";
import { fmtInterval } from "@/lib/format";

export const Route = createFileRoute("/cards")({
  validateSearch: (s: Record<string, unknown>) => ({
    block: typeof s["block"] === "string" ? s["block"] : undefined,
    modes: typeof s["modes"] === "string" ? s["modes"] : undefined,
    new_limit: typeof s["new_limit"] === "string" ? s["new_limit"] : undefined,
  }),
  head: () => meta("Cards", "Spaced-repetition review: listen, speak and cloze cards."),
  component: Cards,
});

const ratings = [
  { rating: 1 as const, label: "Again", key: "1" },
  { rating: 2 as const, label: "Hard", key: "2" },
  { rating: 3 as const, label: "Good", key: "3" },
  { rating: 4 as const, label: "Easy", key: "4" },
];

const UNDO_MS = 6000;

/** "New / day": any whole number 0-200, saved per account (shared with the legacy review page). */
function NewLimitField() {
  const t = useT();
  const qc = useQueryClient();
  const id = useId();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"" | "saved" | "local">("");

  useEffect(() => {
    let live = true;
    syncNewLimit().then((n) => live && setText(String(n)));
    return () => {
      live = false;
    };
  }, []);

  const commit = async () => {
    const res = await saveNewLimit(text);
    if (res.value === null) return;
    setText(String(res.value));
    setStatus(res.saved ? "saved" : "local");
    qc.invalidateQueries({ queryKey: ["srs-queue"] });
  };

  return (
    <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
      <label htmlFor={id}>{t("newPerDay")}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={NEW_LIMIT_MAX}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-20 rounded-lg border border-input bg-background px-3 py-1.5 text-center text-foreground outline-none focus:ring-2 focus:ring-ring"
      />
      {status && (
        <span role="status" className="text-xs">
          {status === "saved" ? t("newPerDaySaved") : t("newPerDayLocal")}
        </span>
      )}
    </div>
  );
}

/** Mastered cards: out of the queue but kept, with a way back. */
function MasteredList({ onRestore }: { onRestore: (card: SrsCard) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const list = useMasteredCards(open);
  return (
    <section className="mt-10 border-t border-border pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={btn.ghost}
      >
        {t("masteredList")}
        {list.data ? ` (${list.data.length})` : ""}
      </button>
      {open && list.data && (
        <ul className="mt-3 divide-y divide-border">
          {list.data.length === 0 && (
            <li className="py-3 text-sm text-muted-foreground">{t("masteredEmpty")}</li>
          )}
          {list.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <span className="fr min-w-0 truncate">
                {c.mode === "cloze" && c.answer ? c.answer : c.sentence}
              </span>
              <button
                type="button"
                onClick={() => onRestore(c)}
                className={cn(btn.ghost, "shrink-0")}
              >
                {t("restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Cards() {
  const { modes, new_limit, block } = Route.useSearch();
  const queue = useSrsQueue(modes, new_limit ? Number(new_limit) : undefined);
  const review = useReviewCard();
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [shownAt, setShownAt] = useState(() => Date.now());
  const t = useT();
  const archive = useArchiveCard();
  const [undoId, setUndoId] = useState<string | null>(null);

  const card = queue.data?.cards[0];
  const due = queue.data?.counts;

  const rate = (rating: 1 | 2 | 3 | 4) => {
    if (!card || review.isPending) return;
    review.mutate(
      { id: card.id, rating, durationMs: Date.now() - shownAt, answer: answer || undefined },
      {
        onSettled: () => {
          setFlipped(false);
          setAnswer("");
          setShownAt(Date.now());
        },
      },
    );
  };

  const master = () => {
    if (!card || archive.isPending) return;
    const id = card.id;
    archive.mutate(
      { id, archived: true },
      {
        onSuccess: () => {
          setFlipped(false);
          setAnswer("");
          setShownAt(Date.now());
          setUndoId(id);
        },
      },
    );
  };
  const restore = (id: string) => {
    setUndoId((cur) => (cur === id ? null : cur));
    archive.mutate({ id, archived: false });
  };

  useEffect(() => {
    if (!undoId) return;
    const timer = window.setTimeout(() => setUndoId(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || review.isPending) return;
      if (e.key === " " && !flipped) {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const clozePrompt = useMemo(
    () => (card?.mode === "cloze" ? card.sentence.replace(/___.*___|___/, "______") : null),
    [card],
  );

  return (
    <AppShell>
      {block && (
        <header className="flex flex-wrap justify-end gap-2 border-b border-border px-4 py-5">
          <BlockTimer lane="review" active={true} />
          <BlockControls blockId={block} />
        </header>
      )}
      <div className="mx-auto max-w-xl px-4 py-10 md:px-10">
        <div className="flex items-baseline justify-between">
          <h1 className="fr text-3xl">Review</h1>
          {due && (
            <span className="text-sm text-muted-foreground">
              {due.total} due · {due.learning} learning · {due.new} new
            </span>
          )}
        </div>
        <NewLimitField />
        <DataView
          query={queue}
          isEmpty={(d) => d.cards.length === 0}
          empty={
            <EmptyState
              title="C'est fini !"
              hint="Nothing due right now. New cards arrive with tomorrow's plan."
            />
          }
        >
          {() =>
            card ? (
              <div className="mt-6">
                <div className="panel p-8 text-center">
                  <div className="flex items-center justify-between">
                    <Chip tone="accent">{card.mode}</Chip>
                    <button
                      type="button"
                      onClick={master}
                      disabled={archive.isPending}
                      title={t("masteredTitle")}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-secondary disabled:opacity-40"
                    >
                      ✓ {t("mastered")}
                    </button>
                  </div>
                  <p className="fr mt-6 text-2xl leading-relaxed">
                    {card.mode === "cloze" ? clozePrompt : card.sentence}
                  </p>
                  {(card.mode === "listen" || card.mode === "speak") && (
                    <div className="mt-4 flex justify-center">
                      <AudioButton url={api.speech.ttsUrl(card.sentence)} label="Listen" />
                    </div>
                  )}
                  {card.mode === "cloze" && !flipped && (
                    <input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Type the missing word…"
                      className="fr mt-4 w-64 rounded-lg border border-input bg-background px-4 py-2 text-center text-lg outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {flipped ? (
                    <div className="mt-6 border-t border-border pt-6">
                      {card.answer && <p className="fr mb-2 text-xl font-medium">{card.answer}</p>}
                      <p className="text-muted-foreground">{card.translation_en}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{card.translation_zh}</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => setFlipped(true)}
                      className="mt-6 text-sm text-muted-foreground underline underline-offset-4"
                    >
                      Show answer (space)
                    </button>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {ratings.map((r) => (
                    <button
                      key={r.rating}
                      disabled={!flipped || review.isPending}
                      onClick={() => rate(r.rating)}
                      className={cn(
                        "rounded-xl border border-border bg-card px-2 py-3 text-sm transition hover:bg-secondary disabled:opacity-40",
                      )}
                    >
                      <span className="font-medium">{r.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {fmtInterval(card.intervals[String(r.rating) as "1" | "2" | "3" | "4"])} ·{" "}
                        {r.key}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Keyboard: space to flip, 1–4 to rate.
                </p>
              </div>
            ) : null
          }
        </DataView>
        <MasteredList onRestore={(c) => restore(c.id)} />
      </div>
      {undoId && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-foreground px-5 py-3 text-sm text-background shadow-lg md:bottom-8"
        >
          <span>{t("masteredToast")}</span>
          <button
            type="button"
            onClick={() => restore(undoId)}
            className="font-medium underline underline-offset-4"
          >
            {t("undo")}
          </button>
        </div>
      )}
    </AppShell>
  );
}
