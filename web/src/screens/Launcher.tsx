import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { queueSentences, savedSentences, type SavedSentence } from "../api/srs";
import { stepText } from "../api/study";
import type { PracticeItem } from "../data/fixtures";
import { plural } from "../lib/format";
import { announce, go, set, useApp } from "../state/store";
import { Banner, Button, DisabledReason, PageHead, Spinner } from "../components/ui";
import { Exercise } from "./Exercise";

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
    <div className="page">
      <PageHead
        back={<Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go("study")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Study</Button>}
        title={kind}
        desc={
          kind === "Recall"
            ? "See an English meaning and write the French sentence from memory."
            : "Listen to practice audio and type what you hear. An English hint is available if you need it."
        }
      />
      <div className="stack gap-5">
        <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-section" style={{ marginBottom: 8 }}>What do you want to practise?</legend>
          {(
            [
              ["last", "Last studied sentence", lastItems.length ? plural(lastItems.length, "sentence") : "None yet — study a text first"],
              ["queue", "Today’s review queue", queueItems.length ? `${plural(queueItems.length, "sentence")} from cards due today` : "No sentences due today"],
              ["choose", "Choose sentences", "Pick from your saved sentences"],
            ] as [Source, string, string][]
          ).map(([v, label, sub]) => (
            <label key={v} className="option">
              <input type="radio" name={`src-${kind}`} checked={src === v} onChange={() => setSrc(v)} />
              <span className="stack">
                <span className="t-strong">{label}</span>
                <span className="t-support">{sub}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {src === "choose" && (
          <fieldset className="list" style={{ border: 0, padding: "4px 16px", margin: 0 }}>
            <legend className="sr-only">Saved sentences</legend>
            {saved.phase === "ready" && !choosable.length && <p className="t-support" style={{ padding: "12px 0" }}>No saved sentences yet. Add a sentence to review from Study first.</p>}
            {choosable.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })} />
                <span>{c.label}</span>
              </label>
            ))}
            <p className="t-meta" style={{ paddingBottom: 12 }}>Sentences are listed by date and length so the French isn’t shown before you practise.</p>
          </fieldset>
        )}

        <div className="panel stack gap-2" aria-live="polite">
          <p className="t-strong">Source: {srcName} · {plural(items.length, "sentence")}</p>
          <p className="t-support">
            This practice doesn’t use your daily new-card limit and doesn’t change review scheduling. Attempts are saved to practice history, separate from your saved cards.
          </p>
        </div>

        {src !== "choose" && !items.length && effectivePhase === "idle" && (
          <Banner tone="neutral" title={src === "last" ? "Nothing studied yet" : "No review sentences today"} actions={<Button kind="secondary" onClick={() => go("study/new")}>Study a text</Button>}>
            {src === "last" ? "Analyse a French text in Study and it will appear here." : "Choose sentences instead, or come back when cards are due."}
          </Banner>
        )}
        {effectivePhase === "error" && (
          <Banner tone="error" title="Sentences didn’t load" live="assertive">Your choice is kept. Retry to load them again.</Banner>
        )}
        {effectivePhase === "loading" && <Spinner label="Preparing sentences…" />}
        <div className="stack gap-2">
          <div className="btn-row">
            <Button kind="primary" onClick={start} busy={effectivePhase === "loading"} disabledReason={emptyReason}>
              {effectivePhase === "error" ? "Retry" : `Start ${kind.toLowerCase()}`}
            </Button>
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
      <div className="page">
        <PageHead title="Practice" />
        <Banner tone="neutral" title="No practice in progress" actions={<Button kind="primary" onClick={() => go("study/recall")}>Choose a practice</Button>} />
      </div>
    );
  }
  const kind = sess?.kind ?? meta!.kind;
  return (
    <div className="page">
      <PageHead
        back={<Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go(kind === "Recall" ? "study/recall" : "study/dictation")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Change source</Button>}
        title={kind}
      />
      <div className="panel">
        <Exercise sessionKey={key} kind={kind} source={sess?.source ?? meta!.source} items={sess?.items ?? meta!.items} onDone={() => go("study")} />
      </div>
    </div>
  );
}
