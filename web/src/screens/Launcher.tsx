import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { CHOOSABLE, LAST_STUDIED, QUEUE_PRACTICE, type PracticeItem } from "../data/fixtures";
import { plural } from "../lib/format";
import { announce, go, set, simulate, useApp } from "../state/store";
import { Banner, Button, DisabledReason, PageHead, Spinner } from "../components/ui";
import { Exercise } from "./Exercise";

type Source = "last" | "queue" | "choose";

export function Launcher({ kind }: { kind: "Recall" | "Dictation" }) {
  const forced = useApp((s) => s.ss["SCR-PRL-01"]);
  const studied = useApp((s) => s.study.sentences);
  const [src, setSrc] = useState<Source>("queue");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");
  const effectivePhase = forced === "loading" || forced === "error" ? forced : phase;

  const lastItems: PracticeItem[] =
    forced === "empty"
      ? []
      : studied.length
        ? studied.map((s, i) => ({ id: s.id, fr: s.fr, en: s.en, label: `Last studied · sentence ${i + 1}`, steps: s.steps.map((st) => ({ fr: st.parts.map((p) => p.t).join(""), en: st.en })) }))
        : LAST_STUDIED;
  const queueItems = forced === "empty" ? [] : QUEUE_PRACTICE;
  const chosen = CHOOSABLE.filter((c) => picked[c.id]);
  const items = src === "last" ? lastItems : src === "queue" ? queueItems : chosen;
  const srcName = src === "last" ? "Last studied sentence" : src === "queue" ? "Today’s review queue" : "Chosen sentences";

  const start = () => {
    setPhase("loading");
    announce(`Preparing ${kind}.`);
    simulate("queue", 700, true)
      .then(() => {
        const key = `run:${kind}:${src}:${Date.now()}`;
        set(() => ({ activeRun: key }));
        runItems.set(key, { kind, source: srcName, items });
        setPhase("idle");
        go("study/run");
      })
      .catch(() => {
        setPhase("error");
        announce(`${kind} couldn’t start.`, true);
      });
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
            {CHOOSABLE.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })} />
                <span>{c.label}</span>
              </label>
            ))}
            <p className="t-meta" style={{ paddingBottom: 12 }}>Sentences are listed by topic and length so the French isn’t shown before you practise.</p>
          </fieldset>
        )}

        <div className="panel stack gap-2" aria-live="polite">
          <p className="t-strong">Source: {srcName} · {plural(items.length, "sentence")}</p>
          <p className="t-support">
            This practice doesn’t use your daily new-card limit and doesn’t change review scheduling. Attempts are saved to practice history, separate from your saved cards.
          </p>
        </div>

        {src !== "choose" && !items.length && (
          <Banner tone="neutral" title={src === "last" ? "Nothing studied yet" : "No review sentences today"} actions={<Button kind="secondary" onClick={() => go("study/new")}>Study a text</Button>}>
            {src === "last" ? "Analyse a French text in Study and it will appear here." : "Choose sentences instead, or come back when cards are due."}
          </Banner>
        )}
        {effectivePhase === "error" && (
          <Banner tone="error" title={`${kind} couldn’t start`} live="assertive">The demo couldn’t load these sentences. Your choice is kept.</Banner>
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
