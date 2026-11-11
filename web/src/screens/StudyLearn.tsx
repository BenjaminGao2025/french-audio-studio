import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Repeat, RotateCcw, History as HistoryIcon, PencilLine, Plus, Check } from "lucide-react";
import { ApiError } from "../api/client";
import { lookupWord } from "../api/lookup";
import { cardKey, saveNote, useSavedCards, type NoteTarget } from "../api/srs";
import { stepText, type ApiWord } from "../api/study";
import type { DerivedCard, StudySentence } from "../data/fixtures";
import { cx, fmtClock, plural } from "../lib/format";
import { estimate } from "../state/audio";
import {
  announce,
  get,
  go,
  patchStudy,
  retryPlayback,
  set,
  startPlayback,
  stopPlayback,
  updatePlayer,
  useApp,
} from "../state/store";
import { Banner, Button, Checkbox, ChoiceSelect, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, Popover, Progress, Skeleton, Spinner, useNarrow, WordDock } from "../components/ui";
import { Toggle } from "../components/ui/toggle";
import { FrText, stepSegments, type FrPick } from "../components/FrText";
import { WordPanel } from "./WordPopup";
import { Exercise } from "./Exercise";
import { ExplainPanel, GrammarSave, ShadowingPanel, SoundsPanel, StructurePanel, StudyNavigation, WordsPanel } from "./StudyTools";


interface Pick {
  text: string;
  el: HTMLElement;
  wordIndex?: number;
  occurrence: number;
}

/** The player owns a list of texts; a button must restart fresh when it wants a different list. */
function sameTexts(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

/* Each study control owns a distinct playback label, so a button reflects only its own playback. */
const SENTENCE_LABEL = (n: number) => `Study audio · Sentence ${n}`;
const ALL_SENTENCES_LABEL = "Study audio · All sentences";
const STEP_LABEL = (n: number) => `Study audio · Step ${n}`;
const ALL_STEPS_LABEL = "Study audio · All steps";
const isLive = (status: string) => status === "playing" || status === "buffering" || status === "loading";

export function StudyLearn() {
  const study = useApp((s) => s.study);
  const forcedSentence = useApp((s) => s.ss["SCR-STU-02"]);
  const forcedWord = useApp((s) => s.ss["word"]);
  const s = study.sentences[study.index];
  const total = study.sentences.length;
  const practising = study.tab === "recall" || study.tab === "dictation";
  const [pick, setPick] = useState<Pick | null>(null);
  const [srcOpen, setSrcOpen] = useState(study.sourceOpen);
  const [moreOpen, setMoreOpen] = useState(study.sourceOpen);
  const sentRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();

  // Demo-state forcing: open the card for a word chosen through the Demo states navigator.
  useEffect(() => {
    const entry = forcedWord || (forcedSentence === "selected-word" ? "failli" : "");
    if (forcedSentence === "source") setSrcOpen(true);
    if (!entry) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-word="${entry}"]`);
      if (el) {
        setPick({
          text: entry,
          el,
          wordIndex: el.dataset.wi !== undefined ? Number(el.dataset.wi) : undefined,
          occurrence: 0,
        });
      }
    });
  }, [forcedSentence, forcedWord]);

  if (!s) return null;
  const onPick = (p: FrPick) => setPick({ text: p.text, el: p.anchor, wordIndex: p.wordIndex, occurrence: p.occurrence });
  const goSentence = (i: number) => {
    setPick(null);
    patchStudy({ index: i });
    announce(`Sentence ${i + 1} of ${total}.`);
    const p = get().player;
    if (p?.owner.kind === "study") stopPlayback();
  };

  const pager = total > 1 && (
    <div className="flex items-center gap-1">
      <Button kind="secondary" iconOnly icon={<ChevronLeft aria-hidden />} aria-label="Previous sentence" disabledReason={study.index === 0 ? "This is the first sentence." : undefined} onClick={() => goSentence(study.index - 1)} />
      <span className="min-w-14 text-center text-sm tabular-nums text-muted-foreground">{study.index + 1} of {total}</span>
      <Button kind="secondary" iconOnly icon={<ChevronRight aria-hidden />} aria-label="Next sentence" disabledReason={study.index === total - 1 ? "This is the last sentence." : undefined} onClick={() => goSentence(study.index + 1)} />
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 study-workspace">
      <h1 className="sr-only" tabIndex={-1} data-page-title>Study</h1>
      <div className={cx("grid items-start gap-6", pick && !narrow && "lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]")}>
      <div className="flex flex-col gap-4 min-w-0">
        {!!study.analysis.failedParts && <Banner tone="warning" title="Some text could not be analysed">{study.analysis.failedParts} parts failed. Your original text is kept. Open New text to retry the missing parts.</Banner>}
        {!practising && s.raw?.accent_fixed_from && <Banner tone="info" title="Accents corrected">Original: <span lang="fr">{s.raw.accent_fixed_from}</span>. The sentence below uses corrected French accents.</Banner>}
        {!practising && (
          <Collapsible open={moreOpen || srcOpen} onOpenChange={(open) => { setMoreOpen(open); if (!open) setSrcOpen(false); }} className="rounded-lg border px-4">
            <CollapsibleTrigger className="flex min-h-11 w-full items-center text-sm font-medium">More</CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button kind="tertiary" icon={<HistoryIcon aria-hidden />} onClick={() => go("progress/history?tab=analyses")}>Analyses in History</Button>
              <Button kind="tertiary" icon={<Plus aria-hidden />} onClick={() => go("study/new")}>New text</Button>
              <Button
                kind="tertiary"
                icon={<PencilLine aria-hidden />}
                aria-expanded={srcOpen}
                aria-controls="source-panel"
                onClick={() => setSrcOpen(!srcOpen)}
              >
                {srcOpen ? "Hide source" : "Edit source"}
              </Button>
            </div>
            {srcOpen && (
              <div id="source-panel" className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span>{study.analysis.source}</span><span>{plural(total, "sentence")}</span></p>
                <p lang="fr">{study.analysis.input}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button kind="secondary" onClick={() => go("study/new")}>Edit text and analyse again</Button>
                  <Button kind="tertiary" onClick={() => setSrcOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {practising && pager}

        {!practising && <section className="flex flex-col gap-3" aria-labelledby="current-sentence-heading">
          <h2 id="current-sentence-heading" tabIndex={-1} className="sr-only">
            {total > 1 ? `Sentence ${study.index + 1} of ${total}` : "Current sentence"}
          </h2>
          <div ref={sentRef} className="max-w-3xl">
            <FrText segments={s.segments} className="sentence-fr font-serif text-3xl leading-snug tracking-tight wrap-break-word" onPick={onPick} />
            <p className="max-w-prose text-muted-foreground">{s.en}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 min-[1100px]:flex-nowrap">
            {pager}
            <StudyPlayer practising={practising} />
            <AddToReview sentence={s} />
          </div>
        </section>}

        <div className="flex flex-col gap-4 border-t pt-4">
          <StudyNavigation value={study.tab} onChange={(tab) => {
            setPick(null);
            const p = get().player;
            if (p && (p.owner.kind === "exercise" || p.owner.kind === "study")) stopPlayback();
            patchStudy({ tab });
          }} />
          <div id="learn-panel" role="tabpanel" aria-labelledby={`learn-tab-${study.tab}`}>
            {study.tab === "steps" && <StepsPanel key={s.id} sentence={s} onPick={onPick} />}
            {study.tab === "grammar" && <GrammarPanel key={s.id} sentence={s} />}
            {study.tab === "words" && <WordsPanel sentence={s} onPick={onPick} />}
            {study.tab === "sounds" && <SoundsPanel sentence={s} onPick={onPick} />}
            {study.tab === "shadowing" && <ShadowingPanel key={s.id} id={`shadow:${s.id}`} text={s.fr} onPick={onPick} />}
            {study.tab === "explain" && <ExplainPanel key={s.id} sentence={s} />}
            {(study.tab === "recall" || study.tab === "dictation") && (
              <Exercise
                key={`${s.id}-${study.tab}`}
                sessionKey={`study:${s.id}:${study.tab}`}
                kind={study.tab === "recall" ? "Recall" : "Dictation"}
                source="Current sentence"
                items={[
                  {
                    id: s.id,
                    fr: s.fr,
                    en: s.en,
                    label: `Sentence ${study.index + 1}`,
                    steps: s.steps.map((st) => ({ fr: stepText(st), en: st.en })),
                  },
                ]}
                onDone={() => patchStudy({ tab: "steps" })}
                onPick={onPick}
                compact
              />
            )}
          </div>
        </div>
      </div>
      {pick && !narrow && (
        <WordDock label={`Meaning of ${pick.text}`} onClose={() => setPick(null)}>
          <WordPanel
            key={`${pick.text}-${pick.wordIndex ?? ""}`}
            sentence={s}
            text={pick.text}
            wordIndex={pick.wordIndex}
            occurrence={pick.occurrence}
            onGrammar={() => { setPick(null); patchStudy({ tab: "grammar" }); }}
            onClose={() => setPick(null)}
          />
        </WordDock>
      )}
      </div>
      {pick && narrow && (
        <Dialog sheet titleHidden title={`Meaning of “${pick.text}”`} onClose={() => setPick(null)}>
          <WordPanel
            key={`${pick.text}-${pick.wordIndex ?? ""}`}
            sentence={s}
            text={pick.text}
            wordIndex={pick.wordIndex}
            occurrence={pick.occurrence}
            onGrammar={() => { setPick(null); patchStudy({ tab: "grammar" }); }}
            onClose={() => setPick(null)}
            inSheet
          />
        </Dialog>
      )}
    </div>
  );
}

/* ---------------- SCR-AUD-01: the sentence player ---------------- */
function StudyPlayer({ practising }: { practising: boolean }) {
  const study = useApp((s) => s.study);
  const p = useApp((s) => s.player);
  const label = `Sentence ${study.index + 1}`;
  const sentenceLabel = SENTENCE_LABEL(study.index + 1);
  // Only this header's own playback drives its controls; a step / all-steps playback is separate.
  const mine = p && p.owner.kind === "study" && (p.owner.label === sentenceLabel || p.owner.label === ALL_SENTENCES_LABEL) ? p : null;

  if (practising) return null; // exercises use their own neutral "Practice audio" control

  const cur = study.sentences[study.index];
  const wanted = [cur.fr];
  const allTexts = study.sentences.map((x) => x.fr);
  const dur = (ts: string[]) => ts.reduce((a, t) => a + estimate(t), 0);
  const sameWanted = sameTexts(mine?.texts, wanted);
  const sameAll = sameTexts(mine?.texts, allTexts);

  const startSentence = () =>
    startPlayback({ kind: "study", label: sentenceLabel, route: "study" }, dur(wanted), { texts: wanted });
  const startAll = () =>
    startPlayback({ kind: "study", label: ALL_SENTENCES_LABEL, route: "study" }, dur(allTexts), { texts: allTexts });

  // If the player's texts differ from what this button wants, always start fresh instead of
  // resuming/restarting the OLD texts (the step-1 → step-2 bug).
  const toggle = () => {
    if (!mine || !sameWanted) return startSentence();
    if (mine.status === "playing" || mine.status === "buffering" || mine.status === "loading") return updatePlayer({ status: "paused" });
    if (mine.status === "paused") return updatePlayer({ status: "playing" });
    if (mine.status === "ended") return updatePlayer({ status: "playing", position: 0 });
    if (mine.status === "error") return retryPlayback();
  };
  const toggleAll = () => {
    if (!mine || !sameAll) return startAll();
    if (mine.status === "playing" || mine.status === "buffering" || mine.status === "loading") return updatePlayer({ status: "paused" });
    if (mine.status === "paused") return updatePlayer({ status: "playing" });
    if (mine.status === "ended") return updatePlayer({ status: "playing", position: 0 });
    if (mine.status === "error") return retryPlayback();
  };
  const statusText = !mine
    ? "Ready"
    : { loading: "Loading audio…", playing: "Playing", paused: "Paused", ended: "Ended", error: "Couldn’t play", buffering: "Buffering…" }[mine.status];
  // The big button pauses only when the player's texts are exactly this sentence.
  const sentenceStatus = mine?.owner.label === sentenceLabel ? mine.status : undefined;
  const allStatus = mine?.owner.label === ALL_SENTENCES_LABEL ? mine.status : undefined;
  const playing = sentenceStatus === "playing" || sentenceStatus === "buffering";
  const loading = sentenceStatus === "loading";
  const errored = sentenceStatus === "error";
  const allPlaying = allStatus === "playing" || allStatus === "buffering" || allStatus === "loading";

  const speed = String(mine?.speed ?? 1);
  const setSpeed = (v: string) => (mine ? updatePlayer({ speed: Number(v) }) : set((st) => ({ settings: { ...st.settings, speed: Number(v) } })));
  const repeatOn = mine?.repeat ?? false;
  const toggleRepeat = () => (mine ? updatePlayer({ repeat: !mine.repeat }) : set((st) => ({ settings: { ...st.settings, repeat: !st.settings.repeat } })));
  const pct = mine && mine.duration ? Math.min(100, (mine.position / mine.duration) * 100) : 0;
  return (
    <>
      <Button
        kind="secondary"
        iconOnly
        busy={loading}
        aria-label={`${playing ? "Pause" : errored ? "Retry" : "Play"} ${label}`}
        icon={playing ? <Pause aria-hidden /> : errored ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
        onClick={toggle}
      />
      <Progress value={pct} className="w-28 sm:w-40" aria-label={`${statusText}. ${fmtClock(mine?.position ?? 0)} of ${fmtClock(mine?.duration ?? dur(wanted))}`} />
      <span className="text-sm tabular-nums text-muted-foreground">{fmtClock(mine?.position ?? 0)} / {fmtClock(mine?.duration ?? dur(wanted))}</span>
      <ChoiceSelect
        ariaLabel="Speed"
        className="w-[5.5rem]"
        value={speed}
        onValueChange={setSpeed}
        options={[0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: String(v), label: `${v}×` }))}
      />
      <Toggle variant="outline" pressed={repeatOn} onPressedChange={toggleRepeat} aria-label={repeatOn ? "Repeat on" : "Repeat off"}>
        <Repeat aria-hidden /> Repeat
      </Toggle>
      <Button kind="secondary" icon={allPlaying ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={toggleAll}>
        {allPlaying ? "Pause all sentences" : "Play all sentences"}
      </Button>
      {mine?.status === "error" && (
        <div className="basis-full">
          <Banner tone="error" title="Audio couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>
            The voice didn’t load. Your place in the sentence is kept.
          </Banner>
        </div>
      )}
    </>
  );
}

/* ---------------- SCR-STU-03: every step, played directly ---------------- */
function StepsPanel({ sentence, onPick }: { sentence: StudySentence; onPick: (p: FrPick) => void }) {
  const player = useApp((s) => s.player);
  // The one live study playback, by its owner label: a step button shows Pause only for its own step.
  const liveLabel = player && player.owner.kind === "study" && isLive(player.status) ? player.owner.label : null;
  const allStepsPlaying = liveLabel === ALL_STEPS_LABEL;
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [recordStep, setRecordStep] = useState<number | null>(null);

  const playStep = (i: number) => {
    const texts = [stepText(sentence.steps[i])];
    const p = get().player;
    const mine = p && p.owner.kind === "study" ? p : null;
    if (mine && mine.owner.label === STEP_LABEL(i + 1) && sameTexts(mine.texts, texts)) {
      if (isLive(mine.status)) return updatePlayer({ status: "paused" });
      if (mine.status === "paused") return updatePlayer({ status: "playing" });
      if (mine.status === "ended") return updatePlayer({ status: "playing", position: 0 });
      if (mine.status === "error") return retryPlayback();
      return;
    }
    startPlayback({ kind: "study", label: STEP_LABEL(i + 1), route: "study" }, estimate(texts[0]), { texts });
  };
  const playAllSteps = () => {
    const texts = sentence.steps.map(stepText);
    const p = get().player;
    const mine = p && p.owner.kind === "study" ? p : null;
    if (mine && mine.owner.label === ALL_STEPS_LABEL) {
      if (isLive(mine.status)) return updatePlayer({ status: "paused" });
      if (mine.status === "paused") return updatePlayer({ status: "playing" });
      if (mine.status === "ended") return updatePlayer({ status: "playing", position: 0 });
      if (mine.status === "error") return retryPlayback();
      return;
    }
    startPlayback({ kind: "study", label: ALL_STEPS_LABEL, route: "study" }, texts.reduce((a, t) => a + estimate(t), 0), { texts });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="study-step-tools flex flex-wrap items-center gap-2">
        <Button kind={blind ? "primary" : "secondary"} aria-pressed={blind} onClick={() => { setBlind(!blind); setRevealed([]); }}>{blind ? "Show all words" : "Test me"}</Button>
        <Button kind="secondary" icon={allStepsPlaying ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={playAllSteps}>
          {allStepsPlaying ? "Pause all steps" : "Play all steps"}
        </Button>
        {blind && <Button kind="tertiary" onClick={() => setRevealed(revealed.length ? [] : sentence.steps.map((_, i) => i))}>{revealed.length ? "Hide again" : "Reveal all"}</Button>}
      </div>
      <ol className="divide-y overflow-hidden rounded-lg border" style={{ padding: "0 16px" }}>
        {sentence.steps.map((st, i) => {
          const isPlaying = liveLabel === STEP_LABEL(i + 1);
          return (
            <li
              key={i}
              className={cx("grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b py-3", isPlaying && "is-playing")}
              onClick={(e) => {
                const t = e.target as HTMLElement;
                if (t.closest(".fr-word, button, a, summary, input, label")) return;
                playStep(i);
              }}
            >
              <span className="grid size-8 place-items-center rounded-full border text-sm font-medium" aria-hidden>{i + 1}</span>
              <div className="flex flex-col gap-2">
                {blind && !revealed.includes(i) ? <p className="step-fr font-serif text-xl leading-snug wrap-break-word" lang="fr">{st.parts.map((part, j) => part.added || i === 0 ? <Button key={j} kind="secondary" className="h-9 border-dashed px-3" aria-label={`Reveal new words in step ${i + 1}`} onClick={(e) => { e.stopPropagation(); setRevealed([...revealed, i]); }}>…</Button> : <span key={j}>{part.t}</span>)}</p> : <FrText segments={stepSegments(st.parts)} className="step-fr font-serif text-xl leading-snug wrap-break-word" onPick={onPick} />}
                <p className="text-sm text-muted-foreground">{st.en}</p>
                {(!blind || revealed.includes(i)) && <p className="text-base">
                  <span className="font-medium">{/[.!?…]$/.test(st.addedLabel) ? st.addedLabel : `${st.addedLabel}.`}</span>
                  {st.how && ` ${st.how}`}
                </p>}
                <Button
                  kind="tertiary"
                  className="h-8 px-2 text-sm"
                  style={{ alignSelf: "flex-start", marginLeft: -12 }}
                  icon={isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
                  onClick={(e) => { e.stopPropagation(); playStep(i); }}
                >
                  {isPlaying ? `Pause step ${i + 1}` : `Play step ${i + 1}`}
                </Button>
                <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button kind="tertiary" aria-pressed={!!player?.repeat && liveLabel === STEP_LABEL(i + 1)} onClick={() => {
                    if (liveLabel === STEP_LABEL(i + 1) && player?.repeat) stopPlayback();
                    else startPlayback({ kind: "study", label: STEP_LABEL(i + 1), route: "study" }, estimate(stepText(st)), { texts: [stepText(st)], repeat: true });
                  }}>Repeat this step</Button>
                  <Button kind="secondary" aria-expanded={recordStep === i} onClick={() => setRecordStep(recordStep === i ? null : i)}>{recordStep === i ? "Close recorder" : "Say this step"}</Button>
                </div>
                {recordStep === i && <div onClick={(e) => e.stopPropagation()}><ShadowingPanel key={i} id={`shadow:${sentence.id}:step:${i}`} text={stepText(st)} compact onPick={onPick} /></div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- SCR-GRA-01 ---------------- */
function GrammarPanel({ sentence }: { sentence: StudySentence }) {
  const forced = useApp((s) => s.ss["SCR-GRA-01"]);
  const index = useApp((s) => s.study.index);
  const [retried, setRetried] = useState(false);
  // The notes arrive with the analysis, so Retry only re-reads what is already here.
  const state = retried ? (sentence.grammar ? "content" : "none") : forced && forced !== "auto" ? forced : sentence.grammar ? "content" : "none";
  const notes = sentence.grammar ?? [];
  return (
    <div className="flex flex-col gap-4" aria-busy={state === "loading"}>
      <StructurePanel sentence={sentence} />
      <p className="text-sm text-muted-foreground">Grammar for this sentence. Your place is kept: sentence {index + 1}.</p>
      {state === "loading" && (
        <>
          <Spinner label="Loading grammar notes…" />
          <Skeleton lines={4} />
        </>
      )}
      {state === "none" && (
        <Banner tone="neutral" title="No grammar explanation for this sentence">
          The words here follow patterns you’ve likely seen. Use the word meanings and Steps instead.
        </Banner>
      )}
      {state === "error" && (
        <Banner tone="error" title="Grammar notes didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setRetried(true)}>Retry</Button>}>
          Your place in the sentence is kept.
        </Banner>
      )}
      {state === "content" && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {notes.map((g) => (
            <li key={g.title + g.body} className="flex flex-col gap-2" style={{ padding: 16 }}>
              <h3 className="font-medium">{g.title}</h3>
              {g.body && <p>{g.body}</p>}
              <GrammarSave key={sentence.id + g.title} sentence={sentence} point={{ title: g.title, explanation: g.body, hook: g.example ?? "" }} />
              {g.example && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium" style={{ color: "var(--text)" }}>{g.example}</span>
                  {g.exampleEn && ` — ${g.exampleEn}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button kind="secondary" onClick={() => patchStudy({ tab: "steps" })}>Back to Steps</Button>
      </div>
    </div>
  );
}

/* ---------------- SCR-SAV-01 ---------------- */
interface SaveOption {
  key: string;
  kind: DerivedCard["kind"];
  label: string;
  word?: ApiWord;
  text?: string;
}

/** Listen and Speak cards for the sentence, plus a Fill-in card for each word looked up in it. */
function saveOptions(sentence: StudySentence, picked: number[]): SaveOption[] {
  const opts: SaveOption[] = [
    { key: cardKey("listen"), kind: "Listen", label: "Listen card · whole sentence" },
    { key: cardKey("speak"), kind: "Speak", label: "Speak card · whole sentence" },
  ];
  const seen = new Set<string>();
  for (const wi of picked) {
    const w = sentence.raw?.words?.[wi];
    if (!w) continue;
    const key = cardKey("cloze", w.fr);
    if (seen.has(key)) continue;
    seen.add(key);
    opts.push({ key, kind: "Fill-in", label: `Fill-in card · ${w.fr}`, word: w, text: w.fr });
  }
  return opts;
}

async function clozeTarget(w: ApiWord): Promise<NoteTarget> {
  // The dictionary entry is already cached from the lookup that made this word a choice.
  const dict = await lookupWord(w.lemma || w.fr).catch(() => null);
  const meta: Record<string, string> = {
    meaning_en: w.meaning,
    meaning_zh: w.meaning_zh,
    lemma: w.lemma,
    pos: w.type,
    ipa: w.ipa,
    ctx_en: w.meaning,
    ctx_zh: w.meaning_zh,
    dict_en: dict?.explanation_en ?? "",
    dict_zh: dict?.explanation_cn ?? "",
    snap: "1",
  };
  return { text: w.fr, mode: "cloze", meta: Object.fromEntries(Object.entries(meta).filter(([, v]) => v)) };
}

function AddToReview({ sentence }: { sentence: StudySentence }) {
  const saved = useSavedCards(sentence.fr);
  const picked = useApp((s) => s.study.picked[sentence.id]);
  const forced = useApp((s) => s.ss["SCR-SAV-01"]);
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"choose" | "saving" | "added" | "failed">("choose");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const options = saveOptions(sentence, picked ?? []);
  const available = options.filter((c) => !saved.has(c.key));
  // Only unticked cards are stored: everything not yet saved starts ticked, with no render in between.
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const allSaved = available.length === 0;
  const savedCount = options.length - available.length;

  useEffect(() => {
    setSel({});
    setPhase("choose");
  }, [sentence.id, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!forced) return;
    setOpen(true);
    if (forced === "saving" || forced === "failed") setPhase(forced);
    if (forced === "added") {
      setCount(3);
      setPhase("added");
    }
  }, [forced]);

  const chosen = available.filter((c) => sel[c.key] !== false);
  const save = async () => {
    setPhase("saving");
    setError("");
    announce("Saving cards…");
    try {
      const raw = sentence.raw;
      await saveNote({
        sentence: sentence.fr,
        translation_en: sentence.en,
        translation_zh: raw?.translation_zh ?? "",
        modes: chosen.filter((c) => c.kind !== "Fill-in").map((c) => (c.kind === "Listen" ? "listen" : "speak")),
        targets: await Promise.all(chosen.filter((c) => c.word).map((c) => clozeTarget(c.word!))),
        extra: raw?.grammar_points?.length ? { grammar: raw.grammar_points } : {},
      });
      setCount(chosen.length);
      setPhase("added");
      announce(`${plural(chosen.length, "card")} saved to your library.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "");
      setPhase("failed");
      announce("Couldn’t save. Nothing was added.", true);
    }
  };

  const label = allSaved ? `Already saved · ${plural(savedCount, "card")}` : savedCount ? `Add to review · ${savedCount} saved` : "Add to review";
  const body =
    phase === "added" ? (
      <Banner tone="success" title={`${plural(count, "card")} added to your library`} live="polite">
        They’ll appear in Review as new cards. Adding them didn’t use today’s new-card limit.
      </Banner>
    ) : allSaved ? (
      <Banner tone="neutral" title="Already saved">All {plural(options.length, "card")} from this sentence are already in your library. Nothing will be duplicated.</Banner>
    ) : (
      <>
        <p className="text-sm text-muted-foreground">Save selected cards to your library. Saving does not use today’s new-card limit.</p>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr-only">Cards from this sentence</legend>
          {options.map((c) => (
            <label key={c.key} className="flex items-start gap-3 py-2">
              <Checkbox
                checked={saved.has(c.key) ? true : sel[c.key] !== false}
                disabled={saved.has(c.key) || phase === "saving"}
                onCheckedChange={(v) => setSel({ ...sel, [c.key]: v === true })}
              />
              <span className="flex flex-col">
                <span>{c.label}</span>
                {saved.has(c.key) && <span className="text-xs leading-4 text-muted-foreground">Already saved</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {!picked?.length && <p className="text-xs leading-4 text-muted-foreground">Look up a word in the sentence to add a Fill-in card for it.</p>}
        {phase === "failed" && (
          <Banner tone="error" title="Couldn’t save" live="assertive">
            {error || "The server didn’t respond."} Nothing was added. Your selection is kept — try again.
          </Banner>
        )}
      </>
    );
  const footer =
    phase === "added" || allSaved ? (
      <>
        <Button kind="secondary" onClick={() => { setOpen(false); go("review/saved"); }}>View saved cards</Button>
        <Button kind="primary" onClick={() => setOpen(false)} data-autofocus>Done</Button>
      </>
    ) : (
      <Button kind="primary" busy={phase === "saving"} onClick={save} disabledReason={!chosen.length ? "Select at least one card." : undefined}>
        {phase === "failed" ? "Retry" : phase === "saving" ? "Saving…" : `Save ${plural(chosen.length, "card")}`}
      </Button>
    );

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <Button
        kind="secondary"
        icon={allSaved ? <Check aria-hidden /> : <Plus aria-hidden />}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {open &&
        (narrow ? (
          <Dialog sheet title="Add to review" onClose={() => setOpen(false)} footer={footer}>
            {body}
          </Dialog>
        ) : (
          <Popover anchor={wrap.current?.querySelector("button") ?? null} container={wrap.current} onClose={() => setOpen(false)} label="Add to review">
            <h3 className="font-medium">Add to review</h3>
            {body}
            <div className="flex flex-wrap items-center gap-2 justify-end">{footer}</div>
          </Popover>
        ))}
      {!open && phase === "choose" && !allSaved && <span className="sr-only">Not added yet</span>}
    </div>
  );
}
