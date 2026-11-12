import { MarkedExplanation } from "../components/MarkedExplanation";
import { useExplanationLanguage } from "../lib/explanationLanguage";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Volume2, X } from "lucide-react";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { ApiError } from "../api/client";
import {
  etymology,
  lookupWord,
  recordLookup,
  useLookupCount,
  wordContext,
  type DictionaryEntry,
  type EtymologyResponse,
  type WordContextHints,
  type WordContextResult,
} from "../api/lookup";
import { loadLibrary } from "../api/review";
import { WordDeckStar } from "../components/WordDeckStar";
import { Phonetic } from "../components/Phonetic";
import type { StudySentence } from "../data/fixtures";
import { askQuestion } from "../api/learning";
import { WordNotes } from "./WordNotes";
import { findWordSpans, FrText } from "../components/FrText";
import { Input } from "../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover";
import { lookupKey, wordIsSaved } from "../lib/lookup";
import { announce, get, patchStudy, sayFrench, useApp } from "../state/store";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Importance, Skeleton, Spinner, useAppWidth } from "../components/ui";
import { Button } from "../components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../components/ui/drawer";

import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";


/** Server limits from word_context.py: a long free selection is spoken but not looked up. */
const WORD_MAX_CHARS = 40;
const MAX_CHUNK_SPACES = 4;

/** Remembers that a word of this sentence was looked up, so Add to review can offer it as a Fill-in card. */
function pick(sentenceId: string, wordIndex: number) {
  const picked = get().study.picked;
  const list = picked[sentenceId] ?? [];
  if (!list.includes(wordIndex)) patchStudy({ picked: { ...picked, [sentenceId]: [...list, wordIndex] } });
}

const wordChars = (s: string) =>
  s
    .toLocaleLowerCase("fr")
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

const plain = (value: string) => value.trim().toLocaleLowerCase("fr").replace(/\s+/g, " ");

/** A gloss that only repeats the word, the whole sentence, or an error is not a meaning. */
function usableMeaning(value: string | undefined, surface: string, sentenceEn: string): string {
  const text = value && !/\p{Script=Han}/u.test(value) ? value.trim() : "";
  if (!text) return "";
  const meaning = plain(text);
  if (meaning === plain(surface)) return "";
  if (sentenceEn && meaning === plain(sentenceEn)) return "";
  if (/\b(?:error|unable to|could not|couldn't|try again)\b|无法|请稍后再试/i.test(text)) return "";
  return text;
}

type LoadState = "idle" | "loading" | "ready" | "error";

const EMPTY_HINTS: WordContextHints = { meaning_zh: "", meaning_en: "", note_en: "", lemma: "", pos: "" };

/*
 * One card for the desktop popover and mobile drawer: word, speaker, bracket phonetics,
 * the meaning of this word in this sentence, then the dictionary. No example sentence.
 */
export function WordPanel(props: Parameters<typeof WordPanelContent>[0]) {
  return <WordPanelContent key={JSON.stringify([props.sentence.fr, props.text, props.wordIndex, props.occurrence])} {...props} />;
}

function WordPanelContent({
  sentence,
  text,
  wordIndex,
  occurrence = 0,
  onClose,
  inSheet,
  compact = false,
}: {
  sentence: StudySentence;
  /** The clicked word or the free selection. */
  text: string;
  /** Present only for a word that came from the analysis word list. */
  wordIndex?: number;
  /** Index of this text among its occurrences in the sentence (for /api/word-context). */
  occurrence?: number;
  onClose: () => void;
  inSheet?: boolean;
  compact?: boolean;
}) {
  const [language] = useExplanationLanguage();
  const w = wordIndex !== undefined ? sentence.raw?.words?.[wordIndex] : undefined;
  // A long free selection is still spoken, but the server rejects it: show a hint instead of asking
  // /api/word-context or the dictionary. Analysis words always keep a lookup.
  const translation_zh = sentence.raw?.translation_zh ?? "";
  const hints = useMemo<WordContextHints>(
    () => (w ? { meaning_zh: w.meaning_zh, meaning_en: w.meaning, note_en: w.why, lemma: w.lemma, pos: w.type } : EMPTY_HINTS),
    [w],
  );
  const storedMeaning = usableMeaning(w?.meaning, text, sentence.en ?? "");

  const [stack, setStack] = useState<{ word: string; surface: string; occurrence: number }[]>([]);
  const nested = stack.length > 0;
  const shown = stack.at(-1)?.word ?? text;
  const contextWord = stack.at(-1)?.surface ?? text;
  const contextOccurrence = stack.at(-1)?.occurrence ?? occurrence;
  const tooLong = w === undefined && (shown.length > WORD_MAX_CHARS || (shown.split(" ").length - 1) >= MAX_CHUNK_SPACES);
  const headword = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compact) return;
    const el = headword.current;
    const scroller = el?.closest<HTMLElement>('[data-slot="popover-content"]') ?? el?.closest(".word-card")?.parentElement;
    if (scroller) scroller.scrollTop = 0;
    el?.focus({ preventScroll: true });
  }, [shown, compact]);
  const saved = useApp(s => wordIsSaved(s.cards, shown));
  const liveCount = useLookupCount(shown);
  const storedCount = useApp(s => s.lookups[lookupKey(shown)]?.count ?? 0);
  const count = liveCount ?? storedCount;
  const drill = (word: string) => {
    if (lookupKey(word) === lookupKey(shown)) return;
    sayFrench(word);
    // Explanation links have no sentence offset: choose the occurrence nearest the current one.
    const sourceStart = findWordSpans(sentence.fr, contextWord)[contextOccurrence]?.[0] ?? 0;
    const spans = findWordSpans(sentence.fr, word);
    const nextOccurrence = spans.reduce((best, span, i) =>
      Math.abs(span[0] - sourceStart) < Math.abs(spans[best][0] - sourceStart) ? i : best, 0);
    setStack(prev => [...prev, { word, surface: word, occurrence: nextOccurrence }]);
    recordLookup(word, sentence).catch(() => undefined);
  };
  const french = (value: string, className = "text-sm") => <FrText text={value} className={className} onPick={p => drill(p.text)} />;
  const [dict, setDict] = useState<DictionaryEntry | null>(null);
  const dictPhonetic = dict?.dictionary_source === "wiktionnaire" ? dict.phonetic.trim() : "";
  const ipa = formatFriendlyPhonetic(dictPhonetic || (!nested ? w?.ipa : "") || "");
  const lemmas = [...new Set(dict?.entries?.map((entry) => entry.lemma))];
  const baseForm = lemmas.length === 1 && lemmas[0].toLowerCase() !== shown.toLowerCase() ? lemmas[0] : "";
  const [dictSt, setDictSt] = useState<LoadState>(tooLong ? "idle" : "loading");
  const [dictErr, setDictErr] = useState("");

  const [contextResult, setContextResult] = useState<{ key: string; value: WordContextResult } | null>(null);
  const contextKey = JSON.stringify([sentence.fr, contextWord, contextOccurrence, language, nested]);
  const ctx = contextResult?.key === contextKey ? contextResult.value : null;
  const setCtx = (value: WordContextResult | null) => setContextResult(value ? { key: contextKey, value } : null);
  const [ctxSt, setCtxSt] = useState<LoadState>(tooLong ? "idle" : "loading");

  const abort = useRef(new AbortController());
  const alive = () => !abort.current.signal.aborted;

  useEffect(() => {
    // StrictMode's simulated unmount aborts the initial controller; recreate a live one on (each) mount.
    abort.current = new AbortController();
    loadLibrary().catch(() => undefined);
    return () => abort.current.abort();
  }, []);

  const dictRequest = useRef(0);
  const ctxRequest = useRef(0);
  const loadDict = useCallback(() => {
    const request = ++dictRequest.current;
    if (tooLong) return;
    setDict(null);
    setDictSt("loading");
    lookupWord(shown, nested ? "" : hints.pos)
      .then((d) => {
        if (!alive() || request !== dictRequest.current) return;
        setDict(d);
        setDictSt("ready");
      })
      .catch((e) => {
        if (!alive() || request !== dictRequest.current) return;
        setDictErr(e instanceof ApiError ? e.message : "");
        setDictSt("error");
        announce("Dictionary request failed.", true);
      });
  }, [shown, tooLong, nested, hints.pos]);

  const loadCtx = useCallback(() => {
    const request = ++ctxRequest.current;
    setCtx(null);
    if (tooLong) { setCtxSt("idle"); return; }
    setCtxSt("loading");
    wordContext({ language, sentence: sentence.fr, word: contextWord, occurrence: contextOccurrence, translation_zh, hints: nested ? EMPTY_HINTS : hints }, abort.current.signal)
      .then((r) => {
        if (!alive() || request !== ctxRequest.current) return;
        setCtx(r.context);
        setCtxSt("ready");
      })
      .catch(() => {
        if (alive() && request === ctxRequest.current) setCtxSt("error");
      });
  }, [language, tooLong, sentence.fr, shown, contextWord, contextOccurrence, nested, translation_zh, hints]);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  const countedOpen = useRef("");
  useEffect(() => {
    setStack([]);
    const openKey = JSON.stringify([sentence.id, text, wordIndex]);
    if (!compact && countedOpen.current !== openKey) {
      countedOpen.current = openKey;
      recordLookup(text, sentence).catch(() => undefined);
    }
    if (!compact && wordIndex !== undefined) pick(sentence.id, wordIndex);

  }, [text, sentence.id, wordIndex, sentence.fr, translation_zh, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCtx(); }, [loadCtx]);

  // Context follows the global preference; dictionary entries stay English.
  const englishOnly = (value?: string) => value && !/\p{Script=Han}/u.test(value) ? value : "";
  const contextNote = (language === "en" ? ctx?.why_en?.trim() : ctx?.why_zh?.trim()) || "";
  const chineseMeaning = language === "zh" ? ctx?.meaning_zh?.trim() || "" : "";
  const meaning = usableMeaning(ctx?.meaning_en, shown, sentence.en ?? "") || (!nested ? storedMeaning : "");
  const dictionaryMeaning = dictSt === "ready" ? (dict?.entries ?? []).filter(e => e.language === "en").flatMap(e => e.senses).map(s => usableMeaning(s, shown, sentence.en ?? "")).find(Boolean) : "";

  return (
    <div className="word-card flex flex-col gap-4 wrap-break-word" aria-busy={dictSt === "loading" || ctxSt === "loading"}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <div ref={headword} className="wp-headword font-serif text-2xl" lang="fr" data-autofocus={compact ? undefined : true} tabIndex={-1}>{french(shown, "text-2xl")}</div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Replay “${shown}”`} onClick={() => sayFrench(shown)}><Volume2 aria-hidden /></Button>
            <Phonetic word={shown} ipa={ipa} className="wp-ipa" />
          </div>
          {baseForm && !nested && (
            <p className="text-xs text-muted-foreground">
              Base form{" "}
              <French value={baseForm} onWord={drill} />
            </p>
          )}
          {nested && <><p className="text-xs text-muted-foreground">{[text, ...stack.map(item => item.word)].join(" › ")}</p><Button type="button" variant="ghost" className="h-8 justify-start px-0" onClick={() => setStack(prev => prev.slice(0, -1))}><ArrowLeft aria-hidden />Back to {stack.length > 1 ? stack[stack.length - 2].word : text}</Button></>}
          {wordChars(shown).length > 1 && <div className="flex flex-wrap gap-1" aria-label="Component words">{wordChars(shown).map((part, i) => <Button key={i} variant="ghost" size="sm" onClick={() => drill(part)}>{part}</Button>)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WordDeckStar key={shown} word={shown} sentence={sentence} details={!nested && w ? w : { meaning, ipa, lemma: dict?.lemma || shown, type: dict?.pos || "" }} />
          {!compact && <Button type="button" variant="ghost" size="icon" aria-label={inSheet ? "Close" : "Close word card"} className={inSheet ? undefined : "wp-close"} onClick={onClose}><X aria-hidden /></Button>}
        </div>
      </header>

      <div className="divide-y border-y">
        <Module key={`context-${sentence.id}-${shown}`} title="In this sentence" defaultOpen>
            {tooLong ? (
              <p className="text-sm text-muted-foreground">Select a word or a short phrase</p>
            ) : contextNote || chineseMeaning ? (
              <>
                <p className="wp-definition text-sm font-normal text-foreground" lang={language}><MarkedExplanation text={[chineseMeaning, contextNote].filter(Boolean).join(language === "zh" ? "。 " : " ").replace(/。。/g, "。")} onWord={drill} /></p>
                {meaning && !plain(contextNote.replace(/[⟦⟧]/g, "")).includes(plain(meaning)) && <p className="text-sm text-muted-foreground" lang="en">{meaning}</p>}
              </>
            ) : ctxSt === "loading" || (contextResult && contextResult.key !== contextKey) ? (
              <><Spinner label="Finding the meaning…" /><Skeleton lines={1} /></>
            ) : meaning || dictionaryMeaning ? (
              <div className="flex flex-col gap-2"><p className="wp-definition text-sm">{meaning || dictionaryMeaning}</p><p className="text-xs text-muted-foreground">{meaning ? "Sentence explanation unavailable" : "Dictionary meaning"}</p>{ctxSt === "error" && <Button type="button" variant="outline" onClick={loadCtx}>Retry</Button>}</div>
            ) : ctxSt === "error" ? (
              <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Couldn’t load the meaning in this sentence.</p><Button type="button" variant="outline" onClick={loadCtx}>Retry</Button></div>
            ) : (
              <p className="text-sm text-muted-foreground">No meaning for this sentence</p>
            )}

        </Module>

        <Module key={`dictionary-${sentence.id}-${shown}`} title="Dictionary" defaultOpen>
            {dictSt === "loading" && <Spinner label="Loading dictionary…" />}
            {dictSt === "error" && (
              <Alert variant="destructive"><AlertTitle>Dictionary request failed</AlertTitle><AlertDescription>{englishOnly(dictErr) || "Please try again."}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={loadDict}>Retry</Button></div></AlertDescription></Alert>
            )}
            {dictSt === "ready" && dict && <DictionaryResult result={dict} onWord={drill} />}
        </Module>
        {!compact && <><Module key={`origin-${shown}`} title="Word origin"><Origin key={shown} word={shown} lemma={dict?.lemma || shown} onWord={drill} /></Module>
        <Module key={`ask-${shown}`} title="Ask AI"><Ask key={shown} sentence={sentence} word={shown} /></Module>
        <Module key={`notes-${shown}`} title="Notes"><WordNotes key={shown} word={shown} /></Module></>}
      </div>
      {compact && <WordNotes key={shown} word={shown} compact />}

      <footer className="wp-footer flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="wp-importance flex items-center gap-2 text-muted-foreground"><span className="text-xs">Importance</span>
            <Importance saved={saved} count={count ?? 0} lookups="muted" />
        </div>
      </footer>
    </div>
  );
}

function DictionaryResult({ result, onWord }: { result: DictionaryEntry; onWord: (word: string) => void }) {
  if (result.match_type === "components") {
    return <>{result.components?.map((part) => (
      <div key={part.token} className="flex flex-col gap-2">
        <French value={part.token} onWord={onWord} />
        <DictionaryResult result={part} onWord={onWord} />
      </div>
    ))}</>;
  }
  const entries = result.entries ?? [];
  if (!entries.length) return <p className="text-sm text-muted-foreground">“{result.token}” is not in the dictionary.</p>;
  const primaryFrench = entries[0].language !== "en" && entries.some(e => e.language === "en");
  return <>
    {result.elision && <p className="text-sm" aria-label="Elision breakdown"><span lang="fr">{result.elision.prefix} = {result.elision.expansion}</span> ({result.elision.note}) + <French value={result.elision.remainder} onWord={onWord} /></p>}
    {result.match_type === "related" && <p className="text-sm text-muted-foreground">Related: <French value={result.related || ""} onWord={onWord} /></p>}
    {primaryFrench && <DictEntry entry={entries[0]} onWord={onWord} />}
    {entries.filter(e => e.language === "en").map((entry, index) => <DictEntry key={index} entry={entry} onWord={onWord} />)}
    {entries.some((e, i) => e.language !== "en" && !(primaryFrench && i === 0)) && <Module title="French definitions" inner>{entries.filter((e, i) => e.language !== "en" && !(primaryFrench && i === 0)).map((entry, index) => <DictEntry key={index} entry={entry} onWord={onWord} />)}</Module>}
    <p className="wp-attribution text-xs text-muted-foreground" title={[result.attribution, result.changes].filter(Boolean).join(" ")}>
      <a href={entries[0].source_url} target="_blank" rel="noopener noreferrer">Source: Wiktionary (CC BY-SA)</a>
    </p>
  </>;
}

function DictEntry({ entry, onWord }: { entry: NonNullable<DictionaryEntry["entries"]>[number]; onWord: (word: string) => void }) {
  const [open, setOpen] = useState(false);
  const entryIpa = formatFriendlyPhonetic(entry.phonetic);
  const primary = entry.senses.slice(0, 2);
  const rest = entry.senses.slice(2);
  const shown = open ? entry.senses : primary;
  return (
    <div className="wp-source-entry flex flex-col gap-1">
      <p className="text-sm">
        <French value={entry.lemma} onWord={onWord} />
        <span className="text-muted-foreground"> {(entry.gender === "m" || entry.gender === "masculine") ? "masculine " : (entry.gender === "f" || entry.gender === "feminine") ? "feminine " : ""}{entry.pos} </span><Phonetic word={entry.lemma} ipa={entryIpa} />
      </p>
      <ol className="wp-senses list-decimal space-y-1 pl-5 text-sm" lang={entry.language ?? "fr"}>
        {shown.map((sense, i) => <li key={i}>{entry.language === "en" ? sense : <French value={sense} onWord={onWord} />}</li>)}
      </ol>
      {rest.length > 0 && !open && (
        <Button type="button" variant="ghost" className="h-8 self-start px-2 text-sm" onClick={() => setOpen(true)}>
          Show {rest.length} more
        </Button>
      )}
    </div>
  );
}

function French({ value, onWord, language = "fr" }: { value: string; onWord: (word: string) => void; language?: string }) {
  return <span lang={language}>{value.split(/([\p{L}\p{N}’'-]+)/u).map((part, i) => /\p{L}/u.test(part) ? <Button key={i} variant="link" className="inline h-auto whitespace-normal p-0 font-normal text-inherit" onClick={() => onWord(part)}>{part}</Button> : part)}</span>;
}

function Module({ title, defaultOpen = false, inner = false, children }: { title: string; defaultOpen?: boolean; inner?: boolean; children: ReactNode }) {
  return <section aria-label={title} className={inner ? "rounded-md bg-muted/50 px-3" : ""}>
    <Collapsible defaultOpen={defaultOpen}>
      <h3><CollapsibleTrigger className="flex min-h-10 w-full items-center justify-between gap-2 text-xs font-medium tracking-wide text-muted-foreground">
        {title}<ChevronDown className="size-4" aria-hidden />
      </CollapsibleTrigger></h3>
      <CollapsibleContent className="flex flex-col gap-3 pb-3 text-sm font-normal text-foreground">{children}</CollapsibleContent>
    </Collapsible>
  </section>;
}
function Origin({ word, lemma, onWord }: { word: string; lemma: string; onWord: (word: string) => void }) {
  const [value, setValue] = useState<EtymologyResponse | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => { setError(false); etymology(word, lemma).then(setValue).catch(() => setError(true)); }, [word, lemma]);
  useEffect(load, [load]);
  if (error) return <div className="grid gap-2"><p className="text-sm text-muted-foreground" lang="zh">暂无法获取词源，请重试。</p><Button variant="outline" onClick={load}>Retry</Button></div>;
  if (!value) return <Spinner label="Loading word origin…" />;
  const structured = value.construction?.length || value.source?.length || value.sense_history_zh || value.memory_zh;
  return structured ? <dl className="grid gap-3 text-sm" lang="zh">
    {Boolean(value.construction?.length) && <div className="grid gap-1"><dt className="text-xs font-medium tracking-wide text-muted-foreground">构成</dt><dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">{value.construction!.map((p, i) => <span key={i}>{i > 0 && <span className="mr-2 text-muted-foreground">+</span>}<Button variant="link" className="h-auto p-0 font-serif text-base" lang="fr" onClick={() => onWord(p.form)}>{p.form}</Button>{p.gloss_zh && <span className="ml-1">（{p.gloss_zh}）</span>}</span>)}</dd></div>}
    {Boolean(value.source?.length) && <div className="grid gap-1"><dt className="text-xs font-medium tracking-wide text-muted-foreground">来源</dt><dd>{value.source!.map((p, i) => <p key={i}>{p.lang} <span className="font-serif" lang="und">{p.form}{p.from_form ? ` ← ${p.from_form}` : ""}</span></p>)}</dd></div>}
    {value.sense_history_zh && <div className="grid gap-1"><dt className="text-xs font-medium tracking-wide text-muted-foreground">词义演变</dt><dd>{value.sense_history_zh}</dd></div>}
    {value.memory_zh && <div className="grid gap-1"><dt className="text-xs font-medium tracking-wide text-muted-foreground">记忆提示</dt><dd>{value.memory_zh}</dd></div>}
  </dl> : <p className="whitespace-pre-line text-sm" lang="zh">{value.text}</p>;
}
function Ask({ sentence, word }: { sentence: StudySentence; word: string }) {
  const [language] = useExplanationLanguage();
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const send = async () => { setBusy(true); setError(false); try { setAnswer((await askQuestion(sentence, question, [], undefined, { word, language })).answer); } catch { setError(true); } finally { setBusy(false); } };
  return <><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void send(); }}><Input aria-label="Ask about this word" value={question} onChange={e => setQuestion(e.target.value)} /><Button disabled={busy || !question.trim()} type="submit">Send</Button></form>{busy && <Spinner label="Asking…" />}{error && <Button variant="outline" onClick={() => void send()}>Retry</Button>}{answer && <p className="whitespace-pre-wrap text-sm">{answer}</p>}</>;
}

/** Desktop floats at the original selection; Radix handles collision, Escape and outside dismissal. */
export function WordOverlay({ label, anchor, onClose, children }: { label: string; anchor?: HTMLElement; onClose: () => void; children: ReactNode }) {
  const desktop = useAppWidth() >= 768;
  const focusWord = (event: Event) => { event.preventDefault(); requestAnimationFrame(() => document.querySelector<HTMLElement>(".word-card [data-autofocus]")?.focus()); };
  if (desktop) return <Popover open onOpenChange={open => { if (!open) onClose(); }}><PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => (anchor?.closest(".sentence-fr") ?? anchor?.closest("[lang=fr]") ?? anchor)?.getBoundingClientRect() ?? new DOMRect(100, 100, 1, 1) } }} /><PopoverContent aria-label={label} align="start" side="bottom" sideOffset={16} avoidCollisions sticky="always" collisionPadding={16} onOpenAutoFocus={focusWord} className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-y-auto p-4">{children}</PopoverContent></Popover>;
  return <Drawer open modal={false} onOpenChange={open => { if (!open) onClose(); }}><DrawerContent className="max-h-[85vh] gap-4" onOpenAutoFocus={focusWord} aria-describedby={undefined}><DrawerHeader className="sr-only"><DrawerTitle>{label}</DrawerTitle></DrawerHeader><div className="overflow-y-auto p-4">{children}</div></DrawerContent></Drawer>;
}
