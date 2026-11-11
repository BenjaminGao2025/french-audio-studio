import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bookmark, ChevronDown, Volume2, X } from "lucide-react";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { ApiError } from "../api/client";
import {
  etymology,
  lookupWord,
  phraseContext,
  recordLookup,
  useLookupCount,
  wordContext,
  type DictionaryEntry,
  type Phrase,
  type WordContextHints,
  type WordContextResult,
} from "../api/lookup";
import { loadFavorites, setFavorite } from "../api/review";
import type { StudySentence } from "../data/fixtures";
import { askQuestion } from "../api/learning";
import { WordNotes } from "./WordNotes";
import { FrText } from "../components/FrText";
import { Input } from "../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../components/ui/tooltip";
import { lookupKey } from "../lib/lookup";
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
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Does a fixed expression overlap the picked word or phrase? */
function phraseOverlaps(pick: string, phraseText: string): boolean {
  const a = wordChars(pick).filter((w) => w.length > 1);
  const b = wordChars(phraseText);
  if (a.some((w) => b.includes(w)) || b.some((w) => w.length > 1 && a.includes(w))) return true;
  const p = pick.toLocaleLowerCase("fr").trim();
  const q = phraseText.toLocaleLowerCase("fr").trim();
  return Boolean(p && q && (p.includes(q) || q.includes(p)));
}

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
export function WordPanel({
  sentence,
  text,
  wordIndex,
  occurrence = 0,
  onGrammar,
  onClose,
  inSheet,
}: {
  sentence: StudySentence;
  /** The clicked word or the free selection. */
  text: string;
  /** Present only for a word that came from the analysis word list. */
  wordIndex?: number;
  /** Index of this text among its occurrences in the sentence (for /api/word-context). */
  occurrence?: number;
  onGrammar?: () => void;
  onClose: () => void;
  inSheet?: boolean;
}) {
  const w = wordIndex !== undefined ? sentence.raw?.words?.[wordIndex] : undefined;
  // A long free selection is still spoken, but the server rejects it: show a hint instead of asking
  // /api/word-context or the dictionary. Analysis words always keep a lookup.
  const translation_zh = sentence.raw?.translation_zh ?? "";
  const hints = useMemo<WordContextHints>(
    () => (w ? { meaning_zh: w.meaning_zh, meaning_en: w.meaning, note_en: w.why, lemma: w.lemma, pos: w.type } : EMPTY_HINTS),
    [w],
  );
  const storedMeaning = usableMeaning(w?.meaning, text, sentence.en ?? "");

  const [stack, setStack] = useState<string[]>([]);
  const nested = stack.length > 0;
  const shown = stack.at(-1) ?? text;
  const tooLong = w === undefined && (shown.length > WORD_MAX_CHARS || (shown.split(" ").length - 1) >= MAX_CHUNK_SPACES);
  const headword = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headword.current;
    const scroller = el?.closest<HTMLElement>('[data-slot="popover-content"]') ?? el?.closest(".word-card")?.parentElement;
    if (scroller) scroller.scrollTop = 0;
    el?.focus({ preventScroll: true });
  }, [shown]);
  const count = useLookupCount(shown);
  const fav = useApp((s) => Boolean(s.favorites[lookupKey(shown)]));
  const drill = (word: string) => { if (lookupKey(word) !== lookupKey(shown)) { sayFrench(word); setStack(prev => [...prev, word]); recordLookup(word).catch(() => undefined); } };
  const french = (value: string, className = "text-sm") => <FrText text={value} className={className} onPick={p => drill(p.text)} />;
  const [dict, setDict] = useState<DictionaryEntry | null>(null);
  const dictPhonetic = dict?.dictionary_source === "wiktionnaire" ? dict.phonetic.trim() : "";
  const ipa = formatFriendlyPhonetic(dictPhonetic || (!nested ? w?.ipa : "") || "");
  const lemmas = [...new Set(dict?.entries?.map((entry) => entry.lemma))];
  const baseForm = lemmas.length === 1 && lemmas[0].toLowerCase() !== shown.toLowerCase() ? lemmas[0] : "";
  const [dictSt, setDictSt] = useState<LoadState>(tooLong ? "idle" : "loading");
  const [dictErr, setDictErr] = useState("");

  const [ctx, setCtx] = useState<WordContextResult | null>(null);
  const [ctxSt, setCtxSt] = useState<LoadState>(tooLong || storedMeaning ? "idle" : "loading");

  const [phrases, setPhrases] = useState<Phrase[]>([]);


  const abort = useRef(new AbortController());
  const alive = () => !abort.current.signal.aborted;

  useEffect(() => {
    // StrictMode's simulated unmount aborts the initial controller; recreate a live one on (each) mount.
    abort.current = new AbortController();
    loadFavorites().catch(() => undefined);
    return () => abort.current.abort();
  }, []);

  const dictRequest = useRef(0);
  const ctxRequest = useRef(0);
  const loadDict = useCallback(() => {
    const request = ++dictRequest.current;
    if (tooLong) return;
    setDictSt("loading");
    lookupWord(shown)
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
  }, [shown, tooLong]);

  const loadCtx = useCallback(() => {
    const request = ++ctxRequest.current;
    if (tooLong || (!nested && storedMeaning)) return;
    setCtx(null);
    setCtxSt("loading");
    wordContext({ sentence: sentence.fr, word: shown, occurrence: nested ? 0 : occurrence, translation_zh, hints: nested ? EMPTY_HINTS : hints }, abort.current.signal)
      .then((r) => {
        if (!alive() || request !== ctxRequest.current) return;
        setCtx(r.context);
        setCtxSt("ready");
      })
      .catch(() => {
        if (alive() && request === ctxRequest.current) setCtxSt("error");
      });
  }, [tooLong, storedMeaning, sentence.fr, shown, nested, occurrence, translation_zh, hints]);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  useEffect(() => {
    setStack([]);
    setPhrases([]);
    recordLookup(text).catch(() => undefined);
    if (wordIndex !== undefined) pick(sentence.id, wordIndex);
    // Phrase context is cached per sentence for the page, so it is fetched without this card's
    // abort signal (closing a card must not forget the shared answer).
    phraseContext(sentence.fr, translation_zh).then((r) => {
      if (alive()) setPhrases(r.phrases ?? []);
    }).catch(() => undefined);
  }, [text, sentence.id, wordIndex, sentence.fr, translation_zh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCtx(); }, [loadCtx]);

  const overlapping = phrases.find((p) => phraseOverlaps(text, p.text));
  // Legacy analyses can contain Chinese notes; only English explanations belong in this card.
  const englishOnly = (value?: string) => value && !/\p{Script=Han}/u.test(value) ? value : "";
  const why = englishOnly(w?.why);
  const meaning = (!nested && storedMeaning) || usableMeaning(ctx?.meaning_en, shown, sentence.en ?? "");
  const phraseMeaning = overlapping ? usableMeaning(overlapping.meaning_en, text, sentence.en ?? "") : "";

  return (
    <div className="word-card flex flex-col gap-4 wrap-break-word" aria-busy={dictSt === "loading" || ctxSt === "loading"}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <div ref={headword} className="wp-headword font-serif text-2xl" lang="fr" data-autofocus tabIndex={-1}>{french(shown, "text-2xl")}</div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Replay “${shown}”`} onClick={() => sayFrench(shown)}><Volume2 aria-hidden /></Button>
            {ipa && <span className="wp-ipa text-sm text-muted-foreground">{ipa}</span>}
          </div>
          {baseForm && !nested && (
            <p className="text-xs text-muted-foreground">
              Base form{" "}
              <French value={baseForm} onWord={drill} />
            </p>
          )}
          {nested && <><p className="text-xs text-muted-foreground">{[text, ...stack].join(" › ")}</p><Button type="button" variant="ghost" className="h-8 justify-start px-0" onClick={() => setStack(prev => prev.slice(0, -1))}><ArrowLeft aria-hidden />Back to {stack.length > 1 ? stack[stack.length - 2] : text}</Button></>}
          {wordChars(shown).length > 1 && <div className="flex flex-wrap gap-1" aria-label="Component words">{wordChars(shown).map((part, i) => <Button key={i} variant="ghost" size="sm" onClick={() => drill(part)}>{part}</Button>)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-pressed={fav} aria-label={fav ? "Saved" : "Save word"} onClick={() => void setFavorite(shown, !fav)}>
            <Bookmark aria-hidden className={fav ? "fill-current" : undefined} />
          </Button></TooltipTrigger><TooltipContent>{fav ? "Saved" : "Save word"}</TooltipContent></Tooltip></TooltipProvider>
          <Button type="button" variant="ghost" size="icon" aria-label={inSheet ? "Close" : "Close word card"} className={inSheet ? undefined : "wp-close"} onClick={onClose}><X aria-hidden /></Button>
        </div>
      </header>

      <Module title="In this sentence" defaultOpen>
          {tooLong ? (
            <p className="text-sm text-muted-foreground">Select a word or a short phrase</p>
          ) : meaning ? (
            <p className="wp-definition text-base" lang="en">{meaning}</p>
          ) : ctxSt === "loading" ? (
            <><Spinner label="Finding the meaning…" /><Skeleton lines={1} /></>
          ) : ctxSt === "error" ? (
            <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Couldn’t load the meaning in this sentence.</p><Button type="button" variant="outline" onClick={loadCtx}>Retry</Button></div>
          ) : (
            <p className="text-sm text-muted-foreground">No meaning for this sentence</p>
          )}
          {!nested && phraseMeaning && plain(overlapping?.text ?? "") !== plain(text) && phraseMeaning !== meaning && (
            <p className="text-sm text-muted-foreground">
              <French value={overlapping?.phrase || overlapping?.text || ""} onWord={drill} />
              {" "}
              {phraseMeaning}
            </p>
          )}
          {!nested && why && <p className="text-sm text-muted-foreground"><French value={why} onWord={drill} language="en" /></p>}
      </Module>

      <Module title="Dictionary" defaultOpen>
          {dictSt === "loading" && <Spinner label="Loading dictionary…" />}
          {dictSt === "error" && (
            <Alert variant="destructive"><AlertTitle>Dictionary request failed</AlertTitle><AlertDescription>{englishOnly(dictErr) || "Please try again."}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={loadDict}>Retry</Button></div></AlertDescription></Alert>
          )}
          {dictSt === "ready" && dict && <DictionaryResult result={dict} onWord={drill} />}
      </Module>
      <Module key={`origin-${shown}`} title="Word origin"><Origin key={shown} word={shown} lemma={dict?.lemma || shown} /></Module>
      <Module key={`ask-${shown}`} title="Ask AI"><Ask key={shown} sentence={sentence} word={shown} /></Module>
      <Module key={`notes-${shown}`} title="Notes"><WordNotes key={shown} word={shown} /></Module>

      <footer className="wp-footer flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        {count !== undefined && (
          <div className="wp-importance flex items-center gap-2 text-muted-foreground"><span className="text-xs">Importance</span>
            <Importance count={count} lookups="muted" />
          </div>
        )}
        {!nested && onGrammar && <Button type="button" variant="ghost" className="h-8 px-2 text-sm" onClick={onGrammar}>See grammar in this sentence</Button>}
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
  return <>
    {result.match_type === "related" && <p className="text-sm text-muted-foreground">Related: <French value={result.related || ""} onWord={onWord} /></p>}
    {entries.filter(e => e.language === "en").map((entry, index) => <DictEntry key={index} entry={entry} onWord={onWord} />)}
    {entries.some(e => e.language !== "en") && <Module title="French definitions">{entries.filter(e => e.language !== "en").map((entry, index) => <DictEntry key={index} entry={entry} onWord={onWord} />)}</Module>}
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
        <span className="text-muted-foreground"> {entry.pos}{entryIpa ? ` ${entryIpa}` : ""}</span>
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
  return <span lang={language}>{value.split(/([\p{L}\p{N}’'-]+)/u).map((part, i) => /\p{L}/u.test(part) ? <Button key={i} variant="link" className="inline h-auto whitespace-normal p-0 font-inherit text-inherit" onClick={() => onWord(part)}>{part}</Button> : part)}</span>;
}

function Module({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return <section aria-label={title} className="rounded-xl border px-3"><Collapsible defaultOpen={defaultOpen}><CollapsibleTrigger className="flex min-h-10 w-full items-center justify-between text-sm font-medium"><h3>{title}</h3><ChevronDown className="size-4" aria-hidden /></CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-2 pb-3">{children}</CollapsibleContent></Collapsible></section>;
}
function Origin({ word, lemma }: { word: string; lemma: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const load = useCallback(() => { setError(false); etymology(word, lemma).then(r => setValue(r.text)).catch(() => setError(true)); }, [word, lemma]);
  useEffect(load, [load]);
  return error ? <Button variant="outline" onClick={load}>Retry</Button> : value ? <p className="text-sm">{value}</p> : <Spinner label="Loading word origin…" />;
}
function Ask({ sentence, word }: { sentence: StudySentence; word: string }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const send = async () => { setBusy(true); setError(false); try { setAnswer((await askQuestion(sentence, `About “${word}”: ${question}`, [])).answer); } catch { setError(true); } finally { setBusy(false); } };
  return <><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void send(); }}><Input aria-label="Ask about this word" value={question} onChange={e => setQuestion(e.target.value)} /><Button disabled={busy || !question.trim()} type="submit">Send</Button></form>{busy && <Spinner label="Asking…" />}{error && <Button variant="outline" onClick={() => void send()}>Retry</Button>}{answer && <p className="whitespace-pre-wrap text-sm">{answer}</p>}</>;
}

/** Desktop floats at the original selection; Radix handles collision, Escape and outside dismissal. */
export function WordOverlay({ label, anchor, onClose, children }: { label: string; anchor?: HTMLElement; onClose: () => void; children: ReactNode }) {
  const desktop = useAppWidth() >= 768;
  const focusWord = (event: Event) => { event.preventDefault(); requestAnimationFrame(() => document.querySelector<HTMLElement>(".word-card [data-autofocus]")?.focus()); };
  if (desktop) return <Popover open onOpenChange={open => { if (!open) onClose(); }}><PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => anchor?.getBoundingClientRect() ?? new DOMRect(100, 100, 1, 1) } }} /><PopoverContent aria-label={label} align="start" side="bottom" sideOffset={8} collisionPadding={16} onOpenAutoFocus={focusWord} className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-y-auto p-4">{children}</PopoverContent></Popover>;
  return <Drawer open modal={false} onOpenChange={open => { if (!open) onClose(); }}><DrawerContent className="max-h-[85vh] gap-4" onOpenAutoFocus={focusWord} aria-describedby={undefined}><DrawerHeader className="sr-only"><DrawerTitle>{label}</DrawerTitle></DrawerHeader><div className="overflow-y-auto p-4">{children}</div></DrawerContent></Drawer>;
}
