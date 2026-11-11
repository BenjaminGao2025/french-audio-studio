import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { queueSentences, savedSentences, type SavedSentence } from "../api/srs";
import { stepText } from "../api/study";
import type { PracticeItem } from "../data/fixtures";
import { plural } from "../lib/format";
import { announce, go, set, useApp } from "../state/store";
import { Checkbox, Crumbs, DisabledReason, PageHead, RadioGroup, RadioGroupItem, Spinner, pageFrame } from "../components/ui";
import { Exercise } from "./Exercise";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { cn } from "cn";

type Source = "last" | "queue" | "choose";

const words = (fr: string) => fr.split(/\s+/).filter(Boolean).length;
const savedOn = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });

/** A saved sentence has no build-up steps, so step-by-step practice is the whole sentence. */
const toItem = (s: SavedSentence, label: string): PracticeItem => ({ id: s.noteId, fr: s.fr, en: s.en, label, steps: [{ fr: s.fr, en: s.en }] });

function useSentences(load: () => Promise<SavedSentence[]>) {
  const [state, setState] = useState<{ phase: "loading" | "ready" | "error"; list: SavedSentence[] }>({ phase: "loading", list: [] });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, phase: "loading" }));
    load()
      .then((list) => live && setState({ phase: "ready", list }))
      .catch(() => live && setState({ phase: "error", list: [] }));
    return () => {
      live = false;
    };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setN(n + 1) };
}

export function Launcher({ kind }: { kind: "Recall" | "Dictation" }) {
  const forced = useApp((s) => s.ss["SCR-PRL-01"]);
  const studied = useApp((s) => s.study.sentences);
  const [src, setSrc] = useState<Source>(studied.length ? "last" : "queue");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const queue = useSentences(queueSentences);
  const saved = useSentences(savedSentences);
  const loadingSrc = src === "queue" ? queue : src === "choose" ? saved : null;
  const effectivePhase = forced === "loading" || forced === "error" ? forced : loadingSrc?.phase === "ready" || !loadingSrc ? "idle" : loadingSrc.phase;

  const lastItems: PracticeItem[] =
    forced === "empty"
      ? []
      : studied.map((s, i) => ({ id: s.id, fr: s.fr, en: s.en, label: `Last studied · sentence ${i + 1}`, steps: s.steps.map((st) => ({ fr: stepText(st), en: st.en })) }));
  const queueItems = forced === "empty" ? [] : queue.list.map((s, i) => toItem(s, `Due today · sentence ${i + 1} · ${plural(words(s.fr), "word")}`));
  const choosable = saved.list.map((s) => toItem(s, `Saved ${savedOn(s.createdAt)} · ${plural(words(s.fr), "word")}`));
  const chosen = choosable.filter((c) => picked[c.id]);
  const items = src === "last" ? lastItems : src === "queue" ? queueItems : chosen;
  const srcName = src === "last" ? "Last studied sentence" : src === "queue" ? "Today’s review queue" : "Chosen sentences";

  const start = () => {
    if (effectivePhase === "error") return loadingSrc?.retry();
    const key = `run:${kind}:${src}:${Date.now()}`;
    runItems.set(key, { kind, source: srcName, items });
    set(() => ({ activeRun: key }));
    announce(`Starting ${kind}.`);
    go("study/run");
  };
  const emptyReason = !items.length
    ? src === "choose"
      ? "Choose at least one sentence."
      : src === "last"
        ? "There’s no last studied sentence yet."
        : "Today’s review queue has no sentences."
    : undefined;

  return (
    <div className={pageFrame()}>
      <PageHead
        back={<Crumbs items={[{ label: "Study", onClick: () => go("study") }, { label: kind }]} />}
        title={kind}
      />
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-medium">Source</legend>
          <RadioGroup value={src} onValueChange={(v) => setSrc(v as Source)} className="gap-3">
          {(
            [
              ["last", "Last studied sentence", lastItems.length ? plural(lastItems.length, "sentence") : "None yet"],
              ["queue", "Today’s review queue", queueItems.length ? plural(queueItems.length, "sentence") : "None due"],
              ["choose", "Choose sentences", "Saved sentences"],
            ] as [Source, string, string][]
          ).map(([v, label, sub]) => (
            <label key={v} className="flex items-start gap-3">
              <RadioGroupItem value={v} className="mt-1" />
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{sub}</span>
              </span>
            </label>
          ))}
          </RadioGroup>
        </fieldset>

        {src === "choose" && (
          <fieldset className="divide-y overflow-hidden rounded-lg border" style={{ border: 0, padding: "4px 16px", margin: 0 }}>
            <legend className="sr-only">Saved sentences</legend>
            {saved.phase === "ready" && !choosable.length && <p className="text-sm font-medium" style={{ padding: "12px 0" }}>No saved sentences yet</p>}
            {choosable.map((c) => (
              <label key={c.id} className="flex items-start gap-3 py-2">
                <Checkbox checked={!!picked[c.id]} onCheckedChange={(v) => setPicked({ ...picked, [c.id]: v === true })} />
                <span>{c.label}</span>
              </label>
            ))}

          </fieldset>
        )}

        <div className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2" aria-live="polite">
          <p className="font-medium">Source: {srcName} · {plural(items.length, "sentence")}</p>
        </div>

        {src !== "choose" && !items.length && effectivePhase === "idle" && (
          <Alert variant="default"><AlertTitle>{src === "last" ? "Nothing studied yet" : "No review sentences today"}</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/new")}>Study a text</Button></div></AlertDescription></Alert>
        )}
        {effectivePhase === "error" && (
          <Alert variant="destructive" role="alert"><AlertTitle>Sentences didn’t load</AlertTitle><AlertDescription>Your choice is kept. Retry to load them again.</AlertDescription></Alert>
        )}
        {effectivePhase === "loading" && <Spinner label="Preparing sentences…" />}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default" aria-disabled={(!!(effectivePhase === "loading") || !!(emptyReason)) || undefined} aria-busy={effectivePhase === "loading" || undefined} className={cn((!!(effectivePhase === "loading") || !!(emptyReason)) ? "opacity-50" : "")} onClick={(event) => { if (!!(effectivePhase === "loading") || !!(emptyReason)) { event.preventDefault(); return; } (start)(); }}>{effectivePhase === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : null}{effectivePhase === "error" ? "Retry" : `Start ${kind.toLowerCase()}`}{(emptyReason) ? <span className="sr-only">{emptyReason}</span> : null}</Button>
          </div>
          {emptyReason && <DisabledReason>{emptyReason}</DisabledReason>}
        </div>
      </div>
    </div>
  );
}

/** Items for independent runs, keyed by session key (kept outside the store; the session copies them). */
export const runItems = new Map<string, { kind: "Recall" | "Dictation"; source: string; items: PracticeItem[] }>();

export function RunScreen() {
  const key = useApp((s) => s.activeRun);
  const sess = useApp((s) => (key ? s.exercises[key] : undefined));
  const meta = key ? runItems.get(key) : undefined;
  if (!key || (!sess && !meta)) {
    return (
      <div className={pageFrame()}>
        <PageHead title="Practice" />
        <Alert variant="default"><AlertTitle>No practice in progress</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="default" onClick={() => go("study/recall")}>Choose a practice</Button></div></AlertDescription></Alert>
      </div>
    );
  }
  const kind = sess?.kind ?? meta!.kind;
  return (
    <div className={pageFrame()}>
      <h1 className="sr-only" tabIndex={-1} data-page-title>{kind}</h1>
      <Crumbs items={[{ label: kind, onClick: () => go(kind === "Recall" ? "study/recall" : "study/dictation") }, { label: "Session" }]} />
      <Exercise sessionKey={key} kind={kind} source={sess?.source ?? meta!.source} items={sess?.items ?? meta!.items} onDone={() => go("study")} />
    </div>
  );
}
