import { useExplanationLanguage } from "../lib/explanationLanguage";
import { useEffect, useRef, useState } from "react";
import { Check, Volume2, Map as MapIcon, Plus, Loader2 } from "lucide-react";
import type { StudySentence } from "../data/fixtures";
import { type AppState, go, sayFrench } from "../state/store";
import { cardKey, useSavedCards } from "../api/srs";
import { askQuestion, checkExplanation, saveAnswer, saveGrammar, transcribeExplanation, transcribeTake, type ExplanationFeedback, type TutorTurn } from "../api/learning";
import { evaluateShadowing } from "../lib/shadowing";
import { gradeFeedback } from "../lib/feedback";
import { build, FrText, type FrPick } from "../components/FrText";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Textarea } from "../components/ui";
import { Toggle } from "../components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { StudyRecorder } from "../components/StudyRecorder";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "cn";

type Tab = AppState["study"]["tab"];
const GROUPS: { id: string; title: string; tabs: { id: Tab; label: string }[] }[] = [
  { id: "understand", title: "Understand", tabs: [{ id: "words", label: "Words" }, { id: "grammar", label: "Grammar" }, { id: "explain", label: "Explain it" }] },
  { id: "listen", title: "Listen & speak", tabs: [{ id: "steps", label: "Steps" }, { id: "sounds", label: "Sounds" }, { id: "shadowing", label: "Say it" }] },
  { id: "check", title: "Check yourself", tabs: [{ id: "recall", label: "Recall" }, { id: "dictation", label: "Dictation" }] },
];
export function StudyNavigation({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const memory = useRef<Partial<Record<string, Tab>>>({});
  const group = GROUPS.find((g) => g.tabs.some((t) => t.id === value)) ?? GROUPS[0];
  memory.current[group.id] = value;
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        className="w-full"
        aria-label="Tool group"
        value={group.id}
        onValueChange={(id) => {
          if (!id || id === group.id) return;
          onChange(memory.current[id] ?? GROUPS.find((g) => g.id === id)!.tabs[0].id);
        }}
      >
        {GROUPS.map((g) => (
          <ToggleGroupItem key={g.id} value={g.id} className="flex-1">
            {g.title}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {group.id !== "check" && <Tabs value={value} onValueChange={(next) => onChange(next as Tab)}><TabsList aria-label={group.title} className="h-auto max-w-full flex-wrap justify-start">{(group.tabs.map((t) => ({ value: t.id, label: t.label }))).map((t) => (<TabsTrigger key={t.value} id={`learn-tab-${t.value}`} value={t.value}>{t.label}</TabsTrigger>))}</TabsList></Tabs>}
    </div>
  );
}

export function StudyCheckTabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  return <Tabs value={value} onValueChange={(next) => onChange(next as Tab)}>
    <TabsList aria-label="Check yourself" className="h-8">
      {GROUPS[2].tabs.map(t => <TabsTrigger key={t.id} id={`learn-tab-${t.id}`} value={t.id} className="px-2 text-xs sm:text-sm">{t.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function WordsPanel({ sentence, onPick }: { sentence: StudySentence; onPick: (p: FrPick) => void }) {
  const raw = sentence.raw;
  const source = raw?.alignment?.length ? raw.alignment : build(sentence.segments.length ? sentence.segments : undefined, sentence.fr).segs.filter(s => s.w).map(s => ({
    fr: s.t,
    en: raw?.words.find(w => w.fr.toLocaleLowerCase("fr") === s.t.toLocaleLowerCase("fr"))?.meaning ?? "",
  }));
  const alignment = source.reduce<{fr: string; en: string}[]>((items, item) => {
    const previous = items.at(-1);
    if (previous && /^(?:l|d|j|n|m|t|s|c|qu|jusqu|lorsqu|puisqu)['’]$/i.test(previous.fr.trim())) {
      items[items.length - 1] = { fr: previous.fr.trim() + item.fr, en: `${previous.en} ${item.en}`.trim() };
    } else items.push(item);
    return items;
  }, []);
  return <section className="flex flex-col gap-4"><h3 className="text-lg font-semibold">Word by word</h3>
    <div className="flex flex-wrap gap-x-4 gap-y-3" aria-label="Word by word">{alignment.map((a, i) => <div key={i} className="flex flex-col items-start"><FrText text={a.fr} className="font-serif text-lg" onPick={onPick} /><span className="text-xs text-muted-foreground">{a.en}</span></div>)}</div>
    {raw?.order_note && <p className="text-sm text-muted-foreground">{raw.order_note}</p>}
  </section>;
}

export function SoundsPanel({ sentence, onPick }: { sentence: StudySentence; onPick: (p: FrPick) => void }) {
  const tips = sentence.raw?.pronunciation_tips ?? [];
  return <section className="flex flex-col gap-4"><h3 className="text-lg font-semibold text-balance">Hear the details</h3><Button type="button" variant="outline" onClick={() => sayFrench(sentence.fr)}>{<Volume2 aria-hidden />}Listen to the sentence</Button>
    {tips.length ? <ul className="divide-y overflow-hidden rounded-lg border">{tips.map((tip, i) => <li className="flex flex-col gap-2 border-b p-4 last:border-b-0 flex flex-col gap-2" key={i}><p>{tip}</p><div className="flex flex-wrap items-center gap-2">{[...tip.matchAll(/[«“"`]([^»”"`]+)[»”"`]/g)].map((m, j) => <FrText key={j} text={m[1]} onPick={onPick} />)}</div></li>)}</ul> : <Alert variant="default"><AlertTitle>No saved pronunciation tips</AlertTitle></Alert>}
  </section>;
}

const shadowResults = new Map<string, string>();
export function ShadowingPanel({ text, id, compact = false, onPick }: { text: string; id: string; compact?: boolean; onPick?: (p: FrPick) => void }) {
  const [transcript, setTranscript] = useState(shadowResults.get(id) ?? "");
  const result = transcript ? evaluateShadowing(text, transcript) : null;
  return <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label={compact ? "Step shadowing" : "Sentence shadowing"}>
    {!compact && <h3 className="text-lg font-semibold text-balance">Listen, say it, compare</h3>}
    <Button type="button" variant="ghost" onClick={() => sayFrench(text)}>{<Volume2 aria-hidden />}Listen to model</Button>
    <StudyRecorder key={id} id={id} label={compact ? "Say this step" : "Record this sentence"} onTake={async (blob, signal) => {
      const spoken = await transcribeTake(blob, "fr", text, signal);
      if (signal.aborted) return;
      shadowResults.set(id, spoken);
      setTranscript(spoken);
      gradeFeedback(evaluateShadowing(text, spoken).score >= 70);
    }} />
    {result && <div className="border-t pt-4 flex flex-col gap-3" aria-live="polite"><div className="flex flex-wrap items-center gap-6"><strong>{result.score}<small>/100</small></strong><span>Similarity <b>{result.accuracy}%</b></span><span>Completeness <b>{result.completeness}%</b></span></div>
      <div className="flex flex-wrap gap-1.5">{result.words.map((w, i) => <span key={i} className={`shadow-${w.status}`} title={`${w.status}: ${w.score}%`}>{onPick ? <FrText text={w.word} onPick={onPick} /> : w.word}<span className="sr-only"> {w.status}</span></span>)}</div>
      {!!result.extras.length && <p className="text-sm text-muted-foreground">Extra words heard: <span lang="fr">{result.extras.join(" ")}</span></p>}
      <p className="text-sm text-muted-foreground">Heard: <span lang="fr">{transcript}</span></p>
    </div>}
  </section>;
}

export function GrammarSave({ sentence, point }: { sentence: StudySentence; point: { title: string; explanation: string; hook: string } }) {
  const saved = useSavedCards(sentence.fr).has(cardKey("grammar", point.title));
  const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="flex flex-col gap-2"><Button type="button" variant="outline" aria-disabled={(!!(saved || done) || !!(busy)) || undefined} aria-busy={busy || undefined} className={cn((!!(saved || done) || !!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(saved || done) || !!(busy)) { event.preventDefault(); return; } (async () => {
    setBusy(true); setError(""); try { await saveGrammar(sentence, point); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t save. Try again."); } finally { setBusy(false); }
  })(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : (saved || done ? <Check aria-hidden /> : <Plus aria-hidden />)}{saved || done ? "Grammar card saved" : "Make a practice card"}</Button>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}</div>;
}

export function StructurePanel({ sentence }: { sentence: StudySentence }) {
  const [selected, setSelected] = useState<number | null>(null);
  const spans = sentence.raw?.structure ?? [];
  const part = selected === null ? null : spans[selected];
  return <div className="flex flex-col gap-3">{!!spans.length && <><p className="text-sm font-medium">How the sentence fits together</p><div className="flex flex-wrap gap-2">{spans.map((s, i) => <Toggle key={i} variant="outline" pressed={selected === i} onPressedChange={() => setSelected(selected === i ? null : i)} className="h-auto flex-col items-start gap-0.5 px-3 py-2"><span lang="fr">{s.text}</span><span className="text-xs text-muted-foreground">{s.block === "N" ? "Noun group" : s.block === "V" ? "Verb" : "Sentence building"}</span></Toggle>)}</div>{part && <div className="rounded-md border-l-2 border-primary bg-muted px-3 py-2"><strong>{part.role}</strong><p>{part.detail}</p>{part.gid && <Button type="button" variant="ghost" onClick={() => go(`study/grammar?point=${encodeURIComponent(part.gid!)}`)}>Explore this grammar point</Button>}</div>}</>}<Button type="button" variant="ghost" onClick={() => go("study/grammar")}>{<MapIcon aria-hidden />}My grammar map</Button></div>;
}

interface ExplainState { explanation: string; variation: string; question: string; feedback?: ExplanationFeedback; history: TutorTurn[]; saved: number[] }
const explanations = new Map<string, ExplainState>();
export function ExplainPanel({ sentence }: { sentence: StudySentence }) {
  const [language] = useExplanationLanguage();
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
    const { answer } = await askQuestion(sentence, question, state.history, signal, { language });
    if (!signal.aborted) update({ history: [...state.history, { role: "learner", content: question }, { role: "tutor", content: answer }], question: "" });
  });
  const spoken = (field: "explanation" | "question") => async (blob: Blob, signal: AbortSignal) => {
    const text = await transcribeExplanation(blob, sentence, signal);
    if (!signal.aborted) update({ [field]: `${current.current[field]} ${text}`.trim().slice(0, field === "explanation" ? 2000 : 1000) });
  };
  const fb = state.feedback;
  return <div className="flex flex-col gap-6"><section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><h3 className="text-lg font-semibold text-balance">Explain it in your own words</h3>
    <label className="text-sm font-medium" htmlFor="explain-draft">My explanation</label><Textarea id="explain-draft" rows={4} maxLength={2000} value={state.explanation} disabled={!!busy} onChange={(e) => update({ explanation: e.target.value })} />
    <StudyRecorder id={`explain:${sentence.id}`} label="Speak my explanation (Chinese)" disabled={!!busy} onTake={spoken("explanation")} />
    <Collapsible><CollapsibleTrigger className="flex min-h-11 items-center text-sm font-medium">Try a sentence of my own</CollapsibleTrigger><CollapsibleContent className="grid gap-2"><label className="sr-only" htmlFor="explain-variation">My own French sentence</label><Textarea id="explain-variation" lang="fr" rows={2} maxLength={500} disabled={!!busy} value={state.variation} onChange={(e) => update({ variation: e.target.value })} name="explain-variation" autoComplete="off" placeholder="e.g. J’ai failli…" /></CollapsibleContent></Collapsible>
    <Button type="button" variant="default" aria-disabled={(!!(!state.explanation.trim() || !!busy) || !!(busy === "explain")) || undefined} aria-busy={busy === "explain" || undefined} className={cn((!!(!state.explanation.trim() || !!busy) || !!(busy === "explain")) ? "opacity-50" : "")} onClick={(event) => { if (!!(!state.explanation.trim() || !!busy) || !!(busy === "explain")) { event.preventDefault(); return; } (() => void check())(); }}>{busy === "explain" ? <Loader2 className="animate-spin" aria-hidden /> : null}Check my understanding</Button>
    {fb && <div className="flex flex-col gap-3 rounded-lg bg-muted p-4 flex flex-col gap-3" aria-live="polite"><h4 className="font-medium">{fb.verdict === "solid" ? "You explained the key ideas" : fb.verdict === "partial" ? "A few gaps to work on" : "Let’s revisit the key ideas"}</h4>{!!fb.got_right.length && <div><p className="text-sm font-medium">What you got right</p><ul>{fb.got_right.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}{!!fb.gaps.length && <div><p className="text-sm font-medium">What to revisit</p><ul>{fb.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}{fb.variation && <p>{fb.variation.ok ? "Your sentence works." : `Try: ${fb.variation.corrected}`} {fb.variation.note}</p>}{fb.follow_up && <div className="rounded-md border-l-2 border-primary bg-muted px-3 py-2"><strong>Think about this</strong><p>{fb.follow_up}</p><Button type="button" variant="ghost" onClick={() => { update({ history: [...state.history, { role: "tutor", content: fb.follow_up }] }); document.getElementById("tutor-question")?.focus(); }}>Answer below</Button></div>}</div>}
  </section><section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><h3 className="text-lg font-semibold text-balance">Ask about this sentence</h3><div className="flex flex-col gap-3" aria-live="polite">{state.history.map((turn, i) => <article key={i} className={`rounded-lg border p-4 wrap-break-word study-turn--${turn.role}`}><p className="text-xs leading-4 text-muted-foreground">{turn.role === "learner" ? "You" : "Tutor"}</p><p style={{ whiteSpace: "pre-wrap" }}>{turn.content}</p>{turn.role === "tutor" && i > 0 && state.history[i - 1]?.role === "learner" && <Button type="button" variant="ghost" aria-disabled={(!!(state.saved.includes(i) || !!busy) || !!(busy === `save-${i}`)) || undefined} aria-busy={busy === `save-${i}` || undefined} className={cn((!!(state.saved.includes(i) || !!busy) || !!(busy === `save-${i}`)) ? "opacity-50" : "")} onClick={(event) => { if (!!(state.saved.includes(i) || !!busy) || !!(busy === `save-${i}`)) { event.preventDefault(); return; } (() => void request(`save-${i}`, async (signal) => { await saveAnswer(sentence, state.history[i - 1].content, turn.content); if (!signal.aborted) update({ saved: [...current.current.saved, i] }); }))(); }}>{busy === `save-${i}` ? <Loader2 className="animate-spin" aria-hidden /> : null}{state.saved.includes(i) ? "Practice card saved" : "Turn this answer into a practice card"}</Button>}</article>)}</div>
    <label className="text-sm font-medium" htmlFor="tutor-question">My question or follow-up answer</label><Textarea id="tutor-question" rows={2} maxLength={1000} value={state.question} disabled={!!busy} onChange={(e) => update({ question: e.target.value })} name="tutor-question" autoComplete="off" placeholder="e.g. Why is this word here…" />
    <StudyRecorder id={`ask:${sentence.id}`} label="Ask by speaking (Chinese)" disabled={!!busy} onTake={spoken("question")} /><Button type="button" variant="default" aria-disabled={(!!(!state.question.trim() || !!busy) || !!(busy === "ask")) || undefined} aria-busy={busy === "ask" || undefined} className={cn((!!(!state.question.trim() || !!busy) || !!(busy === "ask")) ? "opacity-50" : "")} onClick={(event) => { if (!!(!state.question.trim() || !!busy) || !!(busy === "ask")) { event.preventDefault(); return; } (() => void ask())(); }}>{busy === "ask" ? <Loader2 className="animate-spin" aria-hidden /> : null}Ask tutor</Button>
  </section>{error && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t finish</AlertTitle><AlertDescription>{error} Your draft is kept. Try again.</AlertDescription></Alert>}</div>;
}
