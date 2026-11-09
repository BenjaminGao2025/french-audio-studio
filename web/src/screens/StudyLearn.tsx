import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Repeat, RotateCcw, History as HistoryIcon, PencilLine, Plus, Check } from "lucide-react";
import { ApiError } from "../api/client";
import { lookupWord } from "../api/lookup";
import { cardKey, saveNote, useSavedCards, type NoteTarget } from "../api/srs";
import { stepText, type ApiWord } from "../api/study";
import type { DerivedCard, StudySentence } from "../data/fixtures";
import { fmtClock, plural } from "../lib/format";
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
  type PlayerState,
} from "../state/store";
import { Banner, Button, Dialog, PageHead, Popover, Segmented, Skeleton, Spinner, Tabs, useNarrow } from "../components/ui";
import { WordPanel } from "./WordPopup";
import { Exercise } from "./Exercise";

export function StudyLearn() {
  const study = useApp((s) => s.study);
  const forcedSentence = useApp((s) => s.ss["SCR-STU-02"]);
  const forcedWord = useApp((s) => s.ss["word"]);
  const s = study.sentences[study.index];
  const total = study.sentences.length;
  const practising = study.tab === "recall" || study.tab === "dictation";
  const [word, setWord] = useState<{ entry: string; el: HTMLElement; seg: number; wi?: number } | null>(null);
  const [srcOpen, setSrcOpen] = useState(study.sourceOpen);
  const sentRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();

  useEffect(() => {
    const entry = forcedWord || (forcedSentence === "selected-word" ? "failli" : "");
    if (forcedSentence === "source") setSrcOpen(true);
    if (!entry) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-word="${entry}"]`);
      if (el) setWord({ entry, el, seg: -1 });
    });
  }, [forcedSentence, forcedWord]);

  if (!s) return null;
  const goSentence = (i: number) => {
    setWord(null);
    patchStudy({ index: i, step: 0 });
    announce(`Sentence ${i + 1} of ${total}.`);
    const p = get().player;
    if (p?.owner.kind === "study") stopPlayback();
  };

  return (
    <div className="page">
      <PageHead
        title="Study"
        eyebrow={`${study.analysis.source} · ${plural(total, "sentence")}`}
        actions={
          <>
            <Button kind="tertiary" className="btn--sm-text" icon={<HistoryIcon aria-hidden />} onClick={() => go("progress/history?tab=analyses")}>
              Analyses in History
            </Button>
            <Button kind="tertiary" className="btn--sm-text" icon={<Plus aria-hidden />} onClick={() => go("study/new")}>
              New text
            </Button>
          </>
        }
      />

      <div className="stack gap-5">
        {/* Source, collapsed after success. Hidden while practising so the target never shows. */}
        {!practising && (
          <div className="stack gap-2">
            <Button
              kind="tertiary"
              className="btn--sm-text"
              icon={<PencilLine aria-hidden />}
              aria-expanded={srcOpen}
              aria-controls="source-panel"
              onClick={() => setSrcOpen(!srcOpen)}
              style={{ alignSelf: "flex-start", marginLeft: -12 }}
            >
              {srcOpen ? "Hide source" : "Edit source"}
            </Button>
            {srcOpen && (
              <div id="source-panel" className="panel stack gap-3">
                <p className="t-support">Original text</p>
                <p lang="fr">{study.analysis.input}</p>
                <div className="btn-row">
                  <Button kind="secondary" onClick={() => go("study/new")}>Edit text and analyse again</Button>
                  <Button kind="tertiary" onClick={() => setSrcOpen(false)}>Cancel</Button>
                </div>
                <p className="t-meta">Cancelling keeps your place: sentence {study.index + 1} of {total}.</p>
              </div>
            )}
          </div>
        )}

        <section className="panel stack gap-4" aria-labelledby="current-sentence-heading">
          <div className="row row--between">
            <h2 id="current-sentence-heading" tabIndex={-1} className="t-label">
              {total > 1 ? `Sentence ${study.index + 1} of ${total}` : "Your sentence"}
            </h2>
            {total > 1 && (
              <div className="btn-row">
                <Button kind="secondary" iconOnly icon={<ChevronLeft aria-hidden />} aria-label="Previous sentence" disabledReason={study.index === 0 ? "This is the first sentence." : undefined} onClick={() => goSentence(study.index - 1)} />
                <Button kind="secondary" iconOnly icon={<ChevronRight aria-hidden />} aria-label="Next sentence" disabledReason={study.index === total - 1 ? "This is the last sentence." : undefined} onClick={() => goSentence(study.index + 1)} />
              </div>
            )}
          </div>

          {practising ? (
            <p className="t-support">The sentence is hidden while you practise. It appears after you check your answer or choose Show answer.</p>
          ) : (
            <div ref={sentRef} style={{ position: "relative" }}>
              <p className="sentence-fr" lang="fr">
                {s.segments.map((g, i) =>
                  g.w ? (
                    <button
                      key={i}
                      type="button"
                      className="word-btn"
                      data-word={g.t}
                      aria-expanded={word?.seg === i}
                      aria-haspopup="dialog"
                      onClick={(e) => setWord(word?.seg === i ? null : { entry: g.t, el: e.currentTarget, seg: i, wi: g.wi })}
                    >
                      {g.t}
                    </button>
                  ) : (
                    <span key={i}>{g.t}</span>
                  ),
                )}
              </p>
              <p className="t-body muted" style={{ marginTop: 8 }}>{s.en}</p>
              <p className="t-meta" style={{ marginTop: 4 }}>Select a word or phrase to see its meaning.</p>
              {word && !narrow && (
                <Popover anchor={word.el} container={sentRef.current} onClose={() => setWord(null)} label={`Meaning of ${word.entry}`}>
                  <WordPanel entry={word.entry} sentence={s} wordIndex={word.wi} onGrammar={() => { setWord(null); patchStudy({ tab: "grammar" }); }} onClose={() => setWord(null)} />
                </Popover>
              )}
            </div>
          )}

          <StudyPlayer practising={practising} />

          {!practising && (
            <div className="btn-row">
              <AddToReview sentence={s} />
            </div>
          )}
        </section>

        <div className="stack gap-4">
          <Tabs
            label="Sentence practice"
            idBase="learn"
            value={study.tab}
            onChange={(t) => {
              setWord(null);
              const p = get().player;
              if (p && (p.owner.kind === "exercise" || p.owner.kind === "study")) stopPlayback();
              patchStudy({ tab: t });
            }}
            tabs={[
              { value: "steps", label: "Steps" },
              { value: "grammar", label: "Grammar" },
              { value: "recall", label: "Recall" },
              { value: "dictation", label: "Dictation" },
            ]}
          />
          <div id="learn-panel" role="tabpanel" aria-labelledby={`learn-tab-${study.tab}`}>
            {study.tab === "steps" && <StepsPanel sentence={s} />}
            {study.tab === "grammar" && <GrammarPanel sentence={s} />}
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
                compact
              />
            )}
          </div>
        </div>
      </div>

      {word && narrow && (
        <Dialog sheet title={`Meaning of “${word.entry}”`} onClose={() => setWord(null)}>
          <WordPanel entry={word.entry} sentence={s} wordIndex={word.wi} onGrammar={() => { setWord(null); patchStudy({ tab: "grammar" }); }} onClose={() => setWord(null)} inSheet />
        </Dialog>
      )}
    </div>
  );
}

/* ---------------- SCR-AUD-01: one scoped main player ---------------- */
function StudyPlayer({ practising }: { practising: boolean }) {
  const study = useApp((s) => s.study);
  const p = useApp((s) => s.player);
  const [scope, setScope] = useState<NonNullable<PlayerState["scope"]>>("sentence");
  const mine = p && p.owner.kind === "study" ? p : null;

  if (practising) return null; // exercises use their own neutral "Practice audio" control

  const cur = study.sentences[study.index];
  const texts =
    scope === "all" ? study.sentences.map((x) => x.fr) : scope === "sentence" ? [cur.fr] : [stepText(cur.steps[study.step] ?? cur.steps[0])];
  const duration = texts.reduce((a, t) => a + Math.max(1, t.length / 13), 0);
  const scopeLabel = scope === "all" ? "All sentences" : scope === "sentence" ? `Sentence ${study.index + 1}` : `Step ${study.step + 1} of sentence ${study.index + 1}`;
  const start = () =>
    startPlayback({ kind: "study", label: `Study audio · ${scopeLabel}`, route: "study" }, duration, { scope, texts });

  const toggle = () => {
    if (!mine) return start();
    if (mine.status === "playing" || mine.status === "buffering") return updatePlayer({ status: "paused" });
    if (mine.status === "paused") return updatePlayer({ status: "playing" });
    if (mine.status === "ended") return updatePlayer({ status: "playing", position: 0 });
    if (mine.status === "error") return retryPlayback();
  };
  const statusText = !mine
    ? "Ready"
    : { loading: "Loading audio…", playing: "Playing", paused: "Paused", ended: "Ended", error: "Couldn’t play", buffering: "Buffering…" }[mine.status];
  const playing = mine?.status === "playing" || mine?.status === "buffering";

  return (
    <div className="player" role="group" aria-label="Sentence player">
      <Segmented
        label="Playback scope"
        value={scope}
        onChange={(v) => {
          setScope(v);
          if (mine) {
            stopPlayback();
            announce(`Scope changed to ${v === "all" ? "All sentences" : v === "sentence" ? "Current sentence" : "Current step"}. Previous playback stopped.`);
          }
        }}
        options={[
          { value: "all", label: "All sentences" },
          { value: "sentence", label: "Current sentence" },
          { value: "step", label: "Current step" },
        ]}
      />
      <div className="player-main">
        <Button
          kind="primary"
          className="play-btn"
          iconOnly
          busy={mine?.status === "loading"}
          aria-label={`${playing ? "Pause" : mine?.status === "error" ? "Retry" : "Play"} ${scopeLabel}`}
          icon={playing ? <Pause aria-hidden /> : mine?.status === "error" ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
          onClick={toggle}
        />
        <div className="grow stack gap-1" style={{ minWidth: 160 }}>
          <span className="t-strong">{scopeLabel}</span>
          <span className="t-support num" aria-live="off">
            {statusText} · {fmtClock(mine?.position ?? 0)} / {fmtClock(mine?.duration ?? duration)}
          </span>
          <div className="progress-track" aria-hidden>
            <div className="progress-fill" style={{ width: `${mine ? Math.min(100, (mine.position / mine.duration) * 100) : 0}%` }} />
          </div>
        </div>
        <label className="row gap-2">
          <span className="t-support">Speed</span>
          <select
            className="select"
            style={{ width: 92 }}
            value={mine?.speed ?? 1}
            onChange={(e) => (mine ? updatePlayer({ speed: Number(e.target.value) }) : set((st) => ({ settings: { ...st.settings, speed: Number(e.target.value) } })))}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((v) => (
              <option key={v} value={v}>{v}×</option>
            ))}
          </select>
        </label>
        <Button
          kind="tertiary"
          icon={<Repeat aria-hidden />}
          aria-pressed={mine?.repeat ?? false}
          onClick={() => (mine ? updatePlayer({ repeat: !mine.repeat }) : set((st) => ({ settings: { ...st.settings, repeat: !st.settings.repeat } })))}
        >
          Repeat {(mine?.repeat ?? false) ? "on" : "off"}
        </Button>
      </div>
      {mine?.status === "error" && (
        <Banner tone="error" title="Audio couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>
          The voice didn’t load. Your place in the sentence is kept.
        </Banner>
      )}
      <p className="row t-meta">
        <span>Canadian French voice</span>
      </p>
    </div>
  );
}

/* ---------------- SCR-STU-03 ---------------- */
function StepsPanel({ sentence }: { sentence: StudySentence }) {
  const step = useApp((s) => s.study.step);
  const n = sentence.steps.length;
  return (
    <div className="stack gap-3">
      <div className="row row--between">
        <p className="t-support">
          Build the sentence a piece at a time. Each step marks what is <mark className="added">new</mark>.
        </p>
        <p className="t-label num" aria-live="polite">Step {step + 1} of {n}</p>
      </div>
      <ol className="list" style={{ padding: "0 16px" }}>
        {sentence.steps.map((st, i) => (
          <li key={i} className="step-item" aria-current={i === step ? "step" : undefined}>
            <span className="step-num" aria-hidden>{i + 1}</span>
            <div className="stack gap-2">
              <p className="t-fr-lg" lang="fr" style={{ fontSize: 20, lineHeight: "30px" }}>
                <span className="sr-only">Step {i + 1}: </span>
                {st.parts.map((p, k) =>
                  p.added ? (
                    <mark key={k} className="added">
                      <span className="sr-only">new: </span>
                      {p.t}
                    </mark>
                  ) : (
                    <span key={k}>{p.t}</span>
                  ),
                )}
              </p>
              <p className="t-support">{st.en}</p>
              <p className="t-body">
                <span className="t-strong">{/[.!?…]$/.test(st.addedLabel) ? st.addedLabel : `${st.addedLabel}.`}</span>
                {st.how && ` ${st.how}`}
              </p>
              {i === step ? (
                <p className="t-meta">Current step · choose “Current step” in the player to hear only this part.</p>
              ) : (
                <Button kind="tertiary" className="btn--sm-text" style={{ alignSelf: "flex-start", marginLeft: -12 }} onClick={() => { patchStudy({ step: i }); announce(`Step ${i + 1} of ${n} selected.`); }}>
                  Practise step {i + 1}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="btn-row">
        <Button kind="secondary" disabledReason={step === 0 ? "This is the first step." : undefined} onClick={() => patchStudy({ step: step - 1 })}>Previous step</Button>
        <Button kind="secondary" disabledReason={step === n - 1 ? "This is the last step." : undefined} onClick={() => patchStudy({ step: step + 1 })}>Next step</Button>
      </div>
    </div>
  );
}

/* ---------------- SCR-GRA-01 ---------------- */
function GrammarPanel({ sentence }: { sentence: StudySentence }) {
  const forced = useApp((s) => s.ss["SCR-GRA-01"]);
  const index = useApp((s) => s.study.index);
  const step = useApp((s) => s.study.step);
  // The notes arrive with the analysis, so there is nothing to load.
  const state = forced && forced !== "auto" ? forced : sentence.grammar ? "content" : "none";
  const notes = sentence.grammar ?? [];
  return (
    <div className="stack gap-4" aria-busy={state === "loading"}>
      <p className="t-support">Grammar for this sentence. Your place is kept: sentence {index + 1}, step {step + 1}.</p>
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
        <Banner tone="error" title="Grammar notes didn’t load" live="assertive">
          Your place in the sentence is kept.
        </Banner>
      )}
      {state === "content" && (
        <ul className="list">
          {notes.map((g) => (
            <li key={g.title + g.body} className="stack gap-2" style={{ padding: 16 }}>
              <h3 className="t-strong">{g.title}</h3>
              {g.body && <p>{g.body}</p>}
              {g.example && (
                <p className="t-support">
                  <span className="t-strong" style={{ color: "var(--text)" }}>{g.example}</span>
                  {g.exampleEn && ` — ${g.exampleEn}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
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
        <p className="t-support">Save selected cards to your library. Saving does not use today’s new-card limit.</p>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sr-only">Cards from this sentence</legend>
          {options.map((c) => (
            <label key={c.key} className="check">
              <input
                type="checkbox"
                checked={saved.has(c.key) ? true : sel[c.key] !== false}
                disabled={saved.has(c.key) || phase === "saving"}
                onChange={(e) => setSel({ ...sel, [c.key]: e.target.checked })}
              />
              <span className="stack">
                <span>{c.label}</span>
                {saved.has(c.key) && <span className="t-meta">Already saved</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {!picked?.length && <p className="t-meta">Look up a word in the sentence to add a Fill-in card for it.</p>}
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
            <h3 className="t-strong">Add to review</h3>
            {body}
            <div className="btn-row btn-row--end">{footer}</div>
          </Popover>
        ))}
      {!open && phase === "choose" && !allSaved && <span className="sr-only">Not added yet</span>}
    </div>
  );
}
