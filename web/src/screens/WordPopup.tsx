import { QuestionMic } from "../components/QuestionMic";
import { MarkedExplanation } from "../components/MarkedExplanation";
import { useExplanationLanguage } from "../lib/explanationLanguage";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, GripHorizontal, Volume2, X } from "lucide-react";
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
  type WordForms,
} from "../api/lookup";
import { loadLibrary, setWordImportance } from "../api/review";
import { WordDeckStar } from "../components/WordDeckStar";
import { Phonetic } from "../components/Phonetic";
import type { StudySentence } from "../data/fixtures";
import { askQuestion } from "../api/learning";
import { WordNotes } from "./WordNotes";
import { ConjugationTable } from "./ConjugationTable";
import { findContextSpans, FrText } from "../components/FrText";
import { Input } from "../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover";
import { lookupKey, wordImportance, wordIsSaved } from "../lib/lookup";
import { announce, get, patchStudy, sayFrench, useApp } from "../state/store";
import { track } from "../lib/track";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Importance, Skeleton, Spinner, useAppWidth } from "../components/ui";
import { cn } from "cn";
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
  return <WordPanelContent key={JSON.stringify([props.sentence.fr, props.context, props.text, props.wordIndex, props.occurrence])} {...props} />;
}

function WordPanelContent({
  sentence,
  text,
  wordIndex,
  occurrence = 0,
  context,
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
  /** The text the word was picked in, when it is not the sentence itself (a build-up step). */
  context?: string;
  onClose: () => void;
  inSheet?: boolean;
  compact?: boolean;
}) {
  const [language] = useExplanationLanguage();
  const w = wordIndex !== undefined ? sentence.raw?.words?.[wordIndex] : undefined;
  // A long free selection is still spoken, but the server rejects it: show a hint instead of asking
  // /api/word-context or the dictionary. Analysis words always keep a lookup.
  // A word picked in a build-up step is explained in that step: "a" in "La loi a le droit" is not in "… n'a le droit …".
  const contextFr = context?.trim() && context.trim() !== sentence.fr.trim() ? context.trim() : sentence.fr;
  const translation_zh = contextFr === sentence.fr ? sentence.raw?.translation_zh ?? "" : "";
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
    const scroller = el?.closest(".word-card")?.parentElement;
    if (scroller) scroller.scrollTop = 0;
    el?.focus({ preventScroll: true });
  }, [shown, compact]);
  const saved = useApp(s => wordIsSaved(s.cards, shown));
  const importance = useApp(s => wordImportance(s.cards, shown));
  const liveCount = useLookupCount(shown);
  const storedCount = useApp(s => s.lookups[lookupKey(shown)]?.count ?? 0);
  const count = liveCount ?? storedCount;
  const drill = (word: string) => {
    if (lookupKey(word) === lookupKey(shown)) return;
    sayFrench(word);
    // Explanation links have no sentence offset: choose the occurrence nearest the current one.
    const sourceStart = findContextSpans(contextFr, contextWord)[contextOccurrence]?.[0] ?? 0;
    const spans = findContextSpans(contextFr, word);
    const nextOccurrence = spans.reduce((best, span, i) =>
      Math.abs(span[0] - sourceStart) < Math.abs(spans[best][0] - sourceStart) ? i : best, 0);
    setStack(prev => [...prev, { word, surface: word, occurrence: nextOccurrence }]);
    recordLookup(word, sentence).catch(() => undefined);
    track("word_tap", { nested: true });
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
  const contextKey = JSON.stringify([contextFr, contextWord, contextOccurrence, language, nested]);
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
    wordContext({ language, sentence: contextFr, word: contextWord, occurrence: contextOccurrence, translation_zh, hints: nested ? EMPTY_HINTS : hints }, abort.current.signal)
      .then((r) => {
        if (!alive() || request !== ctxRequest.current) return;
        setCtx(r.context);
        setCtxSt("ready");
      })
      .catch(() => {
        if (alive() && request === ctxRequest.current) setCtxSt("error");
      });
  }, [language, tooLong, contextFr, shown, contextWord, contextOccurrence, nested, translation_zh, hints]);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  const countedOpen = useRef("");
  useEffect(() => {
    setStack([]);
    const openKey = JSON.stringify([sentence.id, text, wordIndex]);
    if (!compact && countedOpen.current !== openKey) {
      countedOpen.current = openKey;
      track("word_tap", { nested: false });
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
              <div className="wp-meaning flex flex-col gap-1 rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2">
                <p className="wp-definition text-sm font-normal text-foreground" lang={language}>
                  {chineseMeaning && <span className="wp-gloss block text-base font-semibold">{chineseMeaning}</span>}
                  {contextNote && <MarkedExplanation text={contextNote} onWord={drill} />}
                </p>
                {meaning && !plain(contextNote.replace(/[⟦⟧]/g, "")).includes(plain(meaning)) && <p className="text-sm text-muted-foreground" lang="en">{meaning}</p>}
              </div>
            ) : ctxSt === "loading" || (contextResult && contextResult.key !== contextKey) ? (
              <><Spinner label="Finding the meaning…" /><Skeleton lines={1} /></>
            ) : meaning || (ctxSt !== "error" && dictionaryMeaning) ? (
              <div className="flex flex-col gap-2"><p className="wp-definition rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2 text-sm">{meaning || dictionaryMeaning}</p><p className="text-xs text-muted-foreground">{meaning ? "Sentence explanation unavailable" : "Dictionary meaning"}</p>{ctxSt === "error" && <Button type="button" variant="outline" onClick={loadCtx}>Retry</Button>}</div>
            ) : ctxSt === "error" ? (
              <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Couldn’t load the meaning in this sentence.</p><Button type="button" variant="outline" onClick={loadCtx}>Retry</Button></div>
            ) : (
              <p className="text-sm text-muted-foreground">No meaning for this sentence</p>
            )}

        </Module>

        {dictSt === "ready" && dict?.forms && <Module key={`forms-${shown}`} title="Forms" defaultOpen><FormsTable forms={dict.forms} /></Module>}
        {/* A participle has both tables; the gender forms stay open, the verb folds away. */}
        {dictSt === "ready" && dict?.conjugation && <Module key={`conjugation-${shown}`} title="Conjugation" defaultOpen={!dict.forms}><ConjugationTable conjugation={dict.conjugation} word={shown} /></Module>}

        <Module key={`dictionary-${sentence.id}-${shown}`} title="Dictionary" defaultOpen>
            {dictSt === "loading" && <Spinner label="Loading dictionary…" />}
            {dictSt === "error" && (
              <Alert variant="destructive"><AlertTitle>Dictionary request failed</AlertTitle><AlertDescription>{englishOnly(dictErr) || "Please try again."}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={loadDict}>Retry</Button></div></AlertDescription></Alert>
            )}
            {dictSt === "ready" && dict && <DictionaryResult result={dict} onWord={drill} />}
        </Module>
        {!compact && <><Module key={`origin-${shown}`} title="Word origin" quiet><Origin key={shown} word={shown} lemma={dict?.lemma || shown} onWord={drill} /></Module>
        <Module key={`ask-${shown}`} title="Ask AI" quiet><Ask key={shown} sentence={sentence} word={shown} /></Module>
        <Module key={`notes-${shown}`} title="Notes" quiet><WordNotes key={shown} word={shown} /></Module></>}
      </div>
      {compact && <WordNotes key={shown} word={shown} compact />}

      <footer className="wp-footer flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="wp-importance flex items-center gap-2 text-muted-foreground"><span className="text-xs">Importance</span>
            <Importance saved={saved} count={count ?? 0} value={saved ? importance : 0} onChange={saved ? (level) => void setWordImportance(shown, level) : undefined} lookups="muted" />
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
    {entries.some((e, i) => e.language !== "en" && !(primaryFrench && i === 0)) && <Module title="French definitions" inner quiet>{entries.filter((e, i) => e.language !== "en" && !(primaryFrench && i === 0)).map((entry, index) => <DictEntry key={index} entry={entry} onWord={onWord} />)}</Module>}
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
      <ol className="wp-senses list-decimal space-y-1 pl-5 text-sm marker:text-muted-foreground" lang={entry.language ?? "fr"}>
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

/** quiet: an optional extra (origin, Ask AI, notes) whose title steps back behind the word's meaning. */
const GENDER = { m: "Masculine", f: "Feminine", mf: "Both genders" } as const;

/** tout / tous / toute / toutes: the form used in this sentence is highlighted; tap a form to hear it. */
// One grid: a fixed label column and two equal columns; header text, words and dashes share one left edge (0.625rem).
// The form in this sentence gets a pill that hugs the word, not a box filling the cell.
function FormsTable({ forms }: { forms: WordForms }) {
  return <div className="flex flex-col gap-2">
    <p className="text-sm text-muted-foreground"><span lang="fr" className="font-serif text-foreground">{forms.lemma}</span> · {forms.kind}</p>
    <table className="wp-forms w-full table-fixed border-collapse">
      <caption className="sr-only">Forms of {forms.lemma}</caption>
      <colgroup><col className="w-20" /><col /><col /></colgroup>
      <thead><tr className="border-b"><td /><th scope="col" className="px-2.5 pb-1.5 text-left text-xs font-normal text-muted-foreground">Singular</th><th scope="col" className="px-2.5 pb-1.5 text-left text-xs font-normal text-muted-foreground">Plural</th></tr></thead>
      <tbody>{forms.rows.map(row => <tr key={row.gender} className="border-b last:border-b-0">
        <th scope="row" className="text-left align-middle text-xs font-normal text-muted-foreground">{GENDER[row.gender]}</th>
        {row.cells.map(cell => <td key={cell.number} className="align-middle" aria-current={cell.current || undefined}>
          <div className="flex flex-wrap items-center">
            {cell.forms.length ? cell.forms.map(form => <Button key={form} type="button" variant="ghost" lang="fr" title="Hear it" className="h-11 min-w-0 px-1 font-serif text-base font-normal" onClick={() => sayFrench(form)}>
              <span className={cn("truncate rounded-md px-1.5 py-0.5", cell.current && "wp-form-current bg-accent font-semibold text-accent-foreground")}>{form}</span>
            </Button>) : <span className="px-2.5 text-muted-foreground">—</span>}
            {cell.current && <span className="sr-only">(in this sentence)</span>}
          </div>
        </td>)}
      </tr>)}</tbody>
    </table>
    <p className="text-xs text-muted-foreground">Highlighted: the form in this sentence. Tap any form to hear it.</p>
  </div>;
}

function Module({ title, defaultOpen = false, inner = false, quiet = false, children }: { title: string; defaultOpen?: boolean; inner?: boolean; quiet?: boolean; children: ReactNode }) {
  return <section aria-label={title} className={inner ? "rounded-md bg-muted/50 px-3" : ""}>
    <Collapsible defaultOpen={defaultOpen}>
      {/* Section title outranks its content: same size as the body, heavier, full colour; the chevron stays quiet. */}
      <h3><CollapsibleTrigger className={cn("flex min-h-11 w-full items-center justify-between gap-2 text-sm", quiet ? "font-medium text-muted-foreground hover:text-foreground" : "font-semibold text-foreground")}>
        {title}<ChevronDown className="size-4 text-muted-foreground" aria-hidden />
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
export function Ask({ sentence, word }: { sentence: StudySentence; word: string }) {
  const [language] = useExplanationLanguage();
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const send = async () => { setBusy(true); setError(false); try { setAnswer((await askQuestion(sentence, question, [], undefined, { word, language })).answer); } catch { setError(true); } finally { setBusy(false); } };
  return <><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void send(); }}><Input className="min-w-0 flex-1" aria-label="Ask about this word" value={question} onChange={e => setQuestion(e.target.value)} /><QuestionMic sentence={sentence.fr} disabled={busy} onText={text => setQuestion(prev => [prev.trimEnd(), text].filter(Boolean).join(" "))} /><Button disabled={busy || !question.trim()} type="submit">Send</Button></form>{busy && <Spinner label="Asking…" />}{error && <Button variant="outline" onClick={() => void send()}>Retry</Button>}{answer && <p className="whitespace-pre-wrap text-sm">{answer}</p>}</>;
}

/** Desktop floats at the original selection; Radix handles collision, Escape and outside dismissal. */
export function WordOverlay({ label, anchor, onClose, children }: { label: string; anchor?: HTMLElement; onClose: () => void; children: ReactNode }) {
  const desktop = useAppWidth() >= 768;
  // Usage: how long a word card stays open (it stays mounted while the learner taps other words).
  useEffect(() => {
    const opened = Date.now();
    return () => track("word_card_close", { seconds: Math.round((Date.now() - opened) / 1000) });
  }, []);
  const focusWord = (event: Event) => { event.preventDefault(); requestAnimationFrame(() => document.querySelector<HTMLElement>(".word-card [data-autofocus]")?.focus()); };
  // A tap on French text picks a word itself; dismissing here first made a second tap on the same word close the card.
  const keepForWordTap = (event: Event) => { if (event.target instanceof Element && event.target.closest(".fr-text")) event.preventDefault(); };
  // The learner can drag the card off the sentence; the offset stays while they tap other words.
  // No transition: duration-100 would otherwise animate translate and lag behind the pointer.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Pin the current top-left when resizing, so Radix does not flip or cap vertical growth at the original word.
  const [size, setSize] = useState<Size | null>(savedSize);
  const [origin, setOrigin] = useState<Offset | null>(null);
  const resize = (next: Size | null, card?: HTMLElement) => {
    if (next && !origin && card) {
      const rect = card.getBoundingClientRect();
      setOrigin({ x: rect.left - offset.x, y: rect.top - offset.y });
    }
    if (!next) setOrigin(null);
    setSize(next);
  };
  if (desktop) return <Popover open onOpenChange={open => { if (!open) onClose(); }}><PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => origin ? new DOMRect(origin.x, origin.y, 0, 0) : (anchor?.closest(".sentence-fr") ?? anchor?.closest("[lang=fr]") ?? anchor)?.getBoundingClientRect() ?? new DOMRect(100, 100, 1, 1) } }} /><PopoverContent aria-label={label} align="start" side="bottom" sideOffset={origin ? 0 : 16} avoidCollisions={!origin} sticky="always" collisionPadding={16} onOpenAutoFocus={focusWord} onInteractOutside={keepForWordTap} style={{ translate: `${offset.x}px ${offset.y}px`, transitionProperty: "none", ...(size && { width: size.w, height: size.h, maxHeight: origin ? "calc(100dvh - 16px)" : "var(--radix-popover-content-available-height)" }) }} className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] gap-0 overflow-hidden p-0"><MoveHandle offset={offset} onMove={setOffset} /><div className="wp-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-1">{children}</div><div className="flex h-11 shrink-0 justify-end"><ResizeHandle onResize={resize} /></div></PopoverContent></Popover>;
  return <Drawer open modal={false} onOpenChange={open => { if (!open) onClose(); }}><DrawerContent className="max-h-[85vh] gap-4" onOpenAutoFocus={focusWord} onInteractOutside={keepForWordTap} aria-describedby={undefined}><DrawerHeader className="sr-only"><DrawerTitle>{label}</DrawerTitle></DrawerHeader><div className="overflow-y-auto p-4">{children}</div></DrawerContent></Drawer>;
}

type Offset = { x: number; y: number };

/** Moves the card by (dx, dy) from offset, keeping it 8px inside the window. */
function moved(card: Element, offset: Offset, dx: number, dy: number, from: Offset = offset): Offset {
  const r = card.getBoundingClientRect();
  // r reflects the current offset; shift it back to where it was when the drag began.
  const left = r.left - (offset.x - from.x), top = r.top - (offset.y - from.y);
  const right = left + r.width, bottom = top + r.height;
  return {
    x: from.x + Math.min(Math.max(dx, 8 - left), window.innerWidth - 8 - right),
    y: from.y + Math.min(Math.max(dy, 8 - top), window.innerHeight - 8 - bottom),
  };
}

/** A grip at the top of the desktop word card: drag it, or focus it and use the arrow keys. */
function MoveHandle({ offset, onMove }: { offset: Offset; onMove: (offset: Offset) => void }) {
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);
  const card = (el: Element) => el.closest('[data-slot="popover-content"]') ?? el;
  const STEP = 24;
  const keys: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
  return <button
    type="button"
    aria-label="Move word card"
    title="Drag to move"
    className="wp-move flex h-6 shrink-0 cursor-grab touch-none select-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, from: offset };
    }}
    onPointerMove={e => {
      const d = drag.current;
      if (d) onMove(moved(card(e.currentTarget), offset, e.clientX - d.x, e.clientY - d.y, d.from));
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onKeyDown={e => {
      const step = keys[e.key];
      if (!step) return;
      e.preventDefault();
      onMove(moved(card(e.currentTarget), offset, step[0], step[1]));
    }}
  ><GripHorizontal className="size-4" aria-hidden /></button>;
}

type Size = { w: number; h: number };
const SIZE_KEY = "frenchStudio.wordCardSize";
const MIN_W = 320, MIN_H = 240, SIZE_STEP = 24;

function savedSize(): Size | null {
  try {
    const value = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null");
    return value && Number.isFinite(value.w) && Number.isFinite(value.h) ? { w: Math.max(MIN_W, value.w), h: Math.max(MIN_H, value.h) } : null;
  } catch { return null; }
}

function storeSize(size: Size | null) {
  try { if (size) localStorage.setItem(SIZE_KEY, JSON.stringify(size)); else localStorage.removeItem(SIZE_KEY); } catch { /* private mode: the size lasts for this card */ }
}

/** Both axes are limited by the visible window, independently of the original word anchor. */
function resized(card: HTMLElement, start: Size, dw: number, dh: number): Size {
  const r = card.getBoundingClientRect();
  const maxW = Math.max(MIN_W, window.innerWidth - 16 - r.left);
  const maxH = Math.max(1, window.innerHeight - 16 - r.top);
  return { w: Math.round(Math.min(Math.max(start.w + dw, MIN_W), maxW)), h: Math.round(Math.min(Math.max(start.h + dh, Math.min(MIN_H, maxH)), maxH)) };
}

/** Bottom-right corner of the desktop word card: drag to resize, arrow keys too; double-click returns to the default size. */
function ResizeHandle({ onResize }: { onResize: (size: Size | null, card?: HTMLElement) => void }) {
  const drag = useRef<{ x: number; y: number; start: Size; last: Size } | null>(null);
  const card = (el: Element) => (el.closest<HTMLElement>('[data-slot="popover-content"]') ?? el) as HTMLElement;
  const current = (el: HTMLElement): Size => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
  const keys: Record<string, [number, number]> = { ArrowLeft: [-SIZE_STEP, 0], ArrowRight: [SIZE_STEP, 0], ArrowUp: [0, -SIZE_STEP], ArrowDown: [0, SIZE_STEP] };
  return <button
    type="button"
    aria-label="Resize word card"
    title="Drag left/right and up/down to resize · double-click to reset"
    className="wp-resize flex size-11 cursor-nwse-resize touch-none select-none items-end justify-end p-1 text-muted-foreground hover:text-foreground"
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const start = current(card(e.currentTarget));
      drag.current = { x: e.clientX, y: e.clientY, start, last: start };
    }}
    onPointerMove={e => {
      const d = drag.current;
      if (!d) return;
      d.last = resized(card(e.currentTarget), d.start, e.clientX - d.x, e.clientY - d.y);
      onResize(d.last, card(e.currentTarget));
    }}
    onPointerUp={() => { if (drag.current) storeSize(drag.current.last); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onDoubleClick={() => { storeSize(null); onResize(null); }}
    onKeyDown={e => {
      const step = keys[e.key];
      if (!step) return;
      e.preventDefault();
      const el = card(e.currentTarget);
      const next = resized(el, current(el), step[0], step[1]);
      storeSize(next);
      onResize(next, el);
    }}
  ><svg viewBox="0 0 10 10" className="size-2.5" aria-hidden><path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></button>;
}
