import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Mic, Volume2, MessageCircle, Layers, PenLine, Headphones, Map as MapIcon, Plus } from "lucide-react";
import type { StudySentence } from "../data/fixtures";
import { type AppState, go, sayFrench } from "../state/store";
import { cardKey, useSavedCards } from "../api/srs";
import { askQuestion, checkExplanation, saveAnswer, saveGrammar, transcribeExplanation, transcribeTake, type ExplanationFeedback, type TutorTurn } from "../api/learning";
import { evaluateShadowing } from "../lib/shadowing";
import { gradeFeedback } from "../lib/feedback";
import { FrText, type FrPick } from "../components/FrText";
import { Banner, Button, Tabs } from "../components/ui";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { StudyRecorder } from "../components/StudyRecorder";

type Tab = AppState["study"]["tab"];
const GROUPS = [
  { title: "Understand", tabs: [{ id: "words", label: "Words", icon: BookOpen }, { id: "grammar", label: "Grammar", icon: MapIcon }, { id: "sounds", label: "Sounds", icon: Volume2 }] },
  { title: "Listen & speak", tabs: [{ id: "steps", label: "Steps", icon: Layers }, { id: "shadowing", label: "Say it", icon: Mic }] },
  { title: "Check yourself", tabs: [{ id: "recall", label: "Recall", icon: PenLine }, { id: "dictation", label: "Dictation", icon: Headphones }, { id: "explain", label: "Explain it", icon: MessageCircle }] },
] as const;
export function StudyNavigation({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const tabs = GROUPS.flatMap((g) => [...g.tabs]);
  return (
    <Tabs
      label="Sentence practice"
      idBase="learn"
      value={value}
      tabs={tabs.map((t) => ({ value: t.id, label: t.label }))}
      onChange={onChange}
    />
  );
}

export function WordsPanel({ sentence, onPick }: { sentence: StudySentence; onPick: (p: FrPick) => void }) {
  const raw = sentence.raw;
  const words = raw?.words ?? [];
  const content = words.map((w, i) => ({ ...w, index: i })).filter((w) => !/^(article|pronoun|preposition|conjunction|determiner|pronom|préposition|déterminant)\b/i.test(w.type));
  const functionWords = words.map((w, i) => ({ ...w, index: i })).filter((w) => !content.some((c) => c.index === w.index));
  const list = (items: typeof content) => <div className="study-word-grid">{items.map((w) => <article key={w.index} className="study-word-item"><div className="row row--between"><FrText segments={[{ t: w.fr, w: true, wi: w.index }]} className="t-strong" onPick={onPick} /><span className="t-meta">{w.type}</span></div><p>{w.meaning}</p>{formatFriendlyPhonetic(w.ipa) && <p className="t-meta">{formatFriendlyPhonetic(w.ipa)}</p>}<details><summary>Usage & memory</summary><div className="stack gap-2">{w.lemma && w.lemma !== w.fr && <p className="t-meta">Base form: {w.lemma}</p>}{w.why && <p>{w.why}</p>}{w.english_link && <p>{w.english_link}</p>}{w.false_friend && <p className="t-meta">False friend: check the meaning carefully.</p>}</div></details><Button kind="tertiary" onClick={(e) => onPick({ text: w.fr, wordIndex: w.index, occurrence: 0, anchor: e.currentTarget })}>Meaning & save card</Button></article>)}</div>;
  return <section className="stack gap-4"><div><h3 className="t-section">Words in this sentence</h3></div>
    {!!raw?.alignment?.length && <div className="study-gloss" aria-label="Word by word">{raw.alignment.map((a, i) => <div key={i}><FrText text={a.fr} onPick={onPick} /><span className="t-support">{a.en}</span></div>)}</div>}
    {raw?.order_note && <p className="study-note">{raw.order_note}</p>}
    {words.length ? <>{list(content.length ? content : functionWords)}{!!content.length && !!functionWords.length && <details className="panel"><summary>Function words ({functionWords.length})</summary>{list(functionWords)}</details>}</> : <Banner tone="neutral" title="No saved word breakdown">Tap words in the sentence above to look them up. Reanalyse an older text to get a full word breakdown.</Banner>}
  </section>;
}

export function SoundsPanel({ sentence, onPick }: { sentence: StudySentence; onPick: (p: FrPick) => void }) {
  const tips = sentence.raw?.pronunciation_tips ?? [];
  return <section className="stack gap-4"><h3 className="t-section">Hear the details</h3><p className="t-support">Listen to the model, then try the same sounds in Say it.</p><Button kind="secondary" icon={<Volume2 aria-hidden />} onClick={() => sayFrench(sentence.fr)}>Listen to the sentence</Button>
    {tips.length ? <ul className="list">{tips.map((tip, i) => <li className="study-tip stack gap-2" key={i}><p>{tip}</p><div className="btn-row">{[...tip.matchAll(/[«“"`]([^»”"`]+)[»”"`]/g)].map((m, j) => <FrText key={j} text={m[1]} onPick={onPick} />)}</div></li>)}</ul> : <Banner tone="neutral" title="No saved pronunciation tips">You can still listen and practise this sentence. Reanalyse older text to request fresh pronunciation notes.</Banner>}
  </section>;
}

const shadowResults = new Map<string, string>();
export function ShadowingPanel({ text, id, compact = false, onPick }: { text: string; id: string; compact?: boolean; onPick?: (p: FrPick) => void }) {
  const [transcript, setTranscript] = useState(shadowResults.get(id) ?? "");
  const result = transcript ? evaluateShadowing(text, transcript) : null;
  return <section className="stack gap-3 study-shadow" aria-label={compact ? "Step shadowing" : "Sentence shadowing"}>
    {!compact && <h3 className="t-section">Listen, say it, compare</h3>}
    <Button kind="tertiary" icon={<Volume2 aria-hidden />} onClick={() => sayFrench(text)}>Listen to model</Button>
    <StudyRecorder key={id} id={id} label={compact ? "Say this step" : "Record this sentence"} onTake={async (blob, signal) => {
      const spoken = await transcribeTake(blob, "fr", text, signal);
      if (signal.aborted) return;
      shadowResults.set(id, spoken);
      setTranscript(spoken);
      gradeFeedback(evaluateShadowing(text, spoken).score >= 70);
    }} />
    {result && <div className="study-score stack gap-3" aria-live="polite"><div className="study-score-metrics"><strong>{result.score}<small>/100</small></strong><span>Similarity <b>{result.accuracy}%</b></span><span>Completeness <b>{result.completeness}%</b></span></div>
      <div className="study-score-words">{result.words.map((w, i) => <span key={i} className={`shadow-${w.status}`} title={`${w.status}: ${w.score}%`}>{onPick ? <FrText text={w.word} onPick={onPick} /> : w.word}<span className="sr-only"> {w.status}</span></span>)}</div>
      {!!result.extras.length && <p className="t-support">Extra words heard: <span lang="fr">{result.extras.join(" ")}</span></p>}
      <p className="t-support">Heard: <span lang="fr">{transcript}</span></p>
    </div>}
  </section>;
}

export function GrammarSave({ sentence, point }: { sentence: StudySentence; point: { title: string; explanation: string; hook: string } }) {
  const saved = useSavedCards(sentence.fr).has(cardKey("grammar", point.title));
  const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="stack gap-2"><Button kind="secondary" icon={saved || done ? <Check aria-hidden /> : <Plus aria-hidden />} busy={busy} disabled={saved || done} onClick={async () => {
    setBusy(true); setError(""); try { await saveGrammar(sentence, point); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t save. Try again."); } finally { setBusy(false); }
  }}>{saved || done ? "Grammar card saved" : "Make a practice card"}</Button>{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

export function StructurePanel({ sentence }: { sentence: StudySentence }) {
  const [selected, setSelected] = useState<number | null>(null);
  const spans = sentence.raw?.structure ?? [];
  const part = selected === null ? null : spans[selected];
  return <div className="stack gap-3">{!!spans.length && <><p className="t-label">How the sentence fits together</p><div className="study-structure">{spans.map((s, i) => <button key={i} className={`structure-${s.block}`} aria-pressed={selected === i} onClick={() => setSelected(selected === i ? null : i)}><span lang="fr">{s.text}</span><small>{s.block === "N" ? "Noun group" : s.block === "V" ? "Verb" : "Sentence building"}</small></button>)}</div>{part && <div className="study-note"><strong>{part.role}</strong><p>{part.detail}</p>{part.gid && <Button kind="tertiary" onClick={() => go(`study/grammar?point=${encodeURIComponent(part.gid!)}`)}>Explore this grammar point</Button>}</div>}</>}<Button kind="tertiary" icon={<MapIcon aria-hidden />} onClick={() => go("study/grammar")}>My grammar map</Button></div>;
}

interface ExplainState { explanation: string; variation: string; question: string; feedback?: ExplanationFeedback; history: TutorTurn[]; saved: number[] }
const explanations = new Map<string, ExplainState>();
export function ExplainPanel({ sentence }: { sentence: StudySentence }) {
  const [state, setState] = useState<ExplainState>(() => explanations.get(sentence.id) ?? { explanation: "", variation: "", question: "", history: [], saved: [] });
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const current = useRef(state); current.current = state;
  const update = (p: Partial<ExplainState>) => setState((s) => { const next = { ...s, ...p }; explanations.set(sentence.id, next); current.current = next; return next; });
  useEffect(() => () => ctl.current?.abort(), []);
  const request = async (kind: string, fn: (signal: AbortSignal) => Promise<void>) => {
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    setBusy(kind); setError(""); try { await fn(c.signal); } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Please try again."); } finally { if (!c.signal.aborted) setBusy(""); }
  };
  const check = () => request("explain", async (signal) => {
    const feedback = await checkExplanation(sentence, state.explanation, state.variation, signal);
    if (!signal.aborted) update({ feedback });
  });
  const ask = () => request("ask", async (signal) => {
    const question = state.question.trim();
    const { answer } = await askQuestion(sentence, question, state.history, signal);
    if (!signal.aborted) update({ history: [...state.history, { role: "learner", content: question }, { role: "tutor", content: answer }], question: "" });
  });
  const spoken = (field: "explanation" | "question") => async (blob: Blob, signal: AbortSignal) => {
    const text = await transcribeExplanation(blob, sentence, signal);
    if (!signal.aborted) update({ [field]: `${current.current[field]} ${text}`.trim().slice(0, field === "explanation" ? 2000 : 1000) });
  };
  const fb = state.feedback;
  return <div className="stack gap-5"><section className="panel stack gap-3"><h3 className="t-section">Explain it in your own words</h3><p className="t-support">What does the sentence mean, and why is it built this way? Use Chinese or English. The tutor helps you find gaps.</p>
    <label className="field-label" htmlFor="explain-draft">My explanation</label><textarea className="textarea" id="explain-draft" rows={4} maxLength={2000} value={state.explanation} disabled={!!busy} onChange={(e) => update({ explanation: e.target.value })} />
    <StudyRecorder id={`explain:${sentence.id}`} label="Speak my explanation (Chinese)" disabled={!!busy} onTake={spoken("explanation")} />
    <details><summary>Try a sentence of my own</summary><label className="sr-only" htmlFor="explain-variation">My own French sentence</label><textarea className="textarea" id="explain-variation" lang="fr" rows={2} maxLength={500} disabled={!!busy} value={state.variation} onChange={(e) => update({ variation: e.target.value })} name="explain-variation" autoComplete="off" placeholder="e.g. J’ai failli…" /></details>
    <Button kind="primary" disabled={!state.explanation.trim() || !!busy} busy={busy === "explain"} onClick={() => void check()}>Check my understanding</Button>
    {fb && <div className="study-feedback stack gap-3" aria-live="polite"><h4 className="t-strong">{fb.verdict === "solid" ? "You explained the key ideas" : fb.verdict === "partial" ? "A few gaps to work on" : "Let’s revisit the key ideas"}</h4>{!!fb.got_right.length && <div><p className="t-label">What you got right</p><ul>{fb.got_right.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}{!!fb.gaps.length && <div><p className="t-label">What to revisit</p><ul>{fb.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}{fb.variation && <p>{fb.variation.ok ? "Your sentence works." : `Try: ${fb.variation.corrected}`} {fb.variation.note}</p>}{fb.follow_up && <div className="study-note"><strong>Think about this</strong><p>{fb.follow_up}</p><Button kind="tertiary" onClick={() => { update({ history: [...state.history, { role: "tutor", content: fb.follow_up }] }); document.getElementById("tutor-question")?.focus(); }}>Answer below</Button></div>}</div>}
  </section><section className="panel stack gap-3"><h3 className="t-section">Ask about this sentence</h3><div className="study-conversation" aria-live="polite">{state.history.map((turn, i) => <article key={i} className={`study-turn study-turn--${turn.role}`}><p className="t-meta">{turn.role === "learner" ? "You" : "Tutor"}</p><p style={{ whiteSpace: "pre-wrap" }}>{turn.content}</p>{turn.role === "tutor" && i > 0 && state.history[i - 1]?.role === "learner" && <Button kind="tertiary" disabled={state.saved.includes(i) || !!busy} busy={busy === `save-${i}`} onClick={() => void request(`save-${i}`, async (signal) => { await saveAnswer(sentence, state.history[i - 1].content, turn.content); if (!signal.aborted) update({ saved: [...current.current.saved, i] }); })}>{state.saved.includes(i) ? "Practice card saved" : "Turn this answer into a practice card"}</Button>}</article>)}</div>
    <label className="field-label" htmlFor="tutor-question">My question or follow-up answer</label><textarea className="textarea" id="tutor-question" rows={2} maxLength={1000} value={state.question} disabled={!!busy} onChange={(e) => update({ question: e.target.value })} name="tutor-question" autoComplete="off" placeholder="e.g. Why is this word here…" />
    <StudyRecorder id={`ask:${sentence.id}`} label="Ask by speaking (Chinese)" disabled={!!busy} onTake={spoken("question")} /><Button kind="primary" disabled={!state.question.trim() || !!busy} busy={busy === "ask"} onClick={() => void ask()}>Ask tutor</Button>
  </section>{error && <Banner tone="error" title="Couldn’t finish" live="assertive">{error} Your draft is kept. Try again.</Banner>}</div>;
}
