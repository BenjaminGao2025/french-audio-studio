import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronDown, Volume2, X } from "lucide-react";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { ApiError } from "../api/client";
import {
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
import { cx } from "../lib/format";
import { lookupKey } from "../lib/lookup";
import { announce, get, patchStudy, sayFrench, useApp } from "../state/store";
import { Banner, Button, Importance, Skeleton, Spinner } from "../components/ui";


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
 * One card for the popover and the narrow sheet: word, speaker, bracket phonetics,
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
  onGrammar: () => void;
  onClose: () => void;
  inSheet?: boolean;
}) {
  const w = wordIndex !== undefined ? sentence.raw?.words?.[wordIndex] : undefined;
  // A long free selection is still spoken, but the server rejects it: show a hint instead of asking
  // /api/word-context or the dictionary. Analysis words always keep a lookup.
  const tooLong = w === undefined && (text.length > WORD_MAX_CHARS || (text.split(" ").length - 1) >= MAX_CHUNK_SPACES);
  const translation_zh = sentence.raw?.translation_zh ?? "";
  const hints = useMemo<WordContextHints>(
    () => (w ? { meaning_zh: w.meaning_zh, meaning_en: w.meaning, note_en: w.why, lemma: w.lemma, pos: w.type } : EMPTY_HINTS),
    [w],
  );
  const storedMeaning = usableMeaning(w?.meaning, text, sentence.en ?? "");

  const count = useLookupCount(text);
  const fav = useApp((s) => Boolean(s.favorites[lookupKey(text)]));

  const [nested, setNested] = useState<string | null>(null);
  const shown = nested ?? text;
  const [dict, setDict] = useState<DictionaryEntry | null>(null);
  const dictPhonetic = dict?.dictionary_source === "wiktionnaire" ? dict.phonetic.trim() : "";
  const ipa = formatFriendlyPhonetic(dictPhonetic || w?.ipa || "");
  const lemmas = [...new Set(dict?.entries?.map((entry) => entry.lemma))];
  const baseForm = lemmas.length === 1 && lemmas[0].toLowerCase() !== shown.toLowerCase() ? lemmas[0] : "";
  const [dictSt, setDictSt] = useState<LoadState>(tooLong ? "idle" : "loading");
  const [dictErr, setDictErr] = useState("");

  const [ctx, setCtx] = useState<WordContextResult | null>(null);
  const [ctxSt, setCtxSt] = useState<LoadState>(tooLong || storedMeaning ? "idle" : "loading");

  const [phrases, setPhrases] = useState<Phrase[]>([]);

  const [whyOpen, setWhyOpen] = useState(false);
  const abort = useRef(new AbortController());
  const alive = () => !abort.current.signal.aborted;

  useEffect(() => {
    // StrictMode's simulated unmount aborts the initial controller; recreate a live one on (each) mount.
    abort.current = new AbortController();
    loadFavorites().catch(() => undefined);
    return () => abort.current.abort();
  }, []);

  const loadDict = useCallback(() => {
    if (tooLong) return;
    setDictSt("loading");
    lookupWord(shown)
      .then((d) => {
        if (!alive()) return;
        setDict(d);
        setDictSt("ready");
      })
      .catch((e) => {
        if (!alive()) return;
        setDictErr(e instanceof ApiError ? e.message : "");
        setDictSt("error");
        announce("Dictionary request failed.", true);
      });
  }, [shown, tooLong]);

  const loadCtx = useCallback(() => {
    if (tooLong || storedMeaning) return;
    setCtx(null);
    setCtxSt("loading");
    wordContext({ sentence: sentence.fr, word: text, occurrence, translation_zh, hints }, abort.current.signal)
      .then((r) => {
        if (!alive()) return;
        setCtx(r.context);
        setCtxSt("ready");
      })
      .catch(() => {
        if (alive()) setCtxSt("error");
      });
  }, [tooLong, storedMeaning, sentence.fr, text, occurrence, translation_zh, hints]);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  useEffect(() => {
    setNested(null);
    setPhrases([]);
    recordLookup(text).catch(() => undefined);
    if (wordIndex !== undefined) pick(sentence.id, wordIndex);
    loadCtx();
    // Phrase context is cached per sentence for the page, so it is fetched without this card's
    // abort signal (closing a card must not forget the shared answer).
    phraseContext(sentence.fr, translation_zh).then((r) => {
      if (alive()) setPhrases(r.phrases ?? []);
    }).catch(() => undefined);
  }, [text, sentence.id, wordIndex, sentence.fr, translation_zh, loadCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  const useBaseForm = () => {
    sayFrench(baseForm);
    setNested(baseForm);
  };

  const overlapping = phrases.find((p) => phraseOverlaps(text, p.text));
  // Legacy analyses can contain Chinese notes; only English explanations belong in this card.
  const englishOnly = (value?: string) => value && !/\p{Script=Han}/u.test(value) ? value : "";
  const why = englishOnly(w?.why);
  const meaning = storedMeaning || usableMeaning(ctx?.meaning_en, text, sentence.en ?? "");
  const phraseMeaning = overlapping ? usableMeaning(overlapping.meaning_en, text, sentence.en ?? "") : "";
  const dictEntries = dict?.dictionary_source === "wiktionnaire" ? dict.entries ?? [] : [];

  return (
    <div className="word-card" aria-busy={dictSt === "loading" || ctxSt === "loading"}>
      <header className="wp-head">
        <div className="wp-title">
          <span className="wp-headword t-page" lang="fr" data-autofocus tabIndex={-1}>{shown}</span>
          <Button kind="tertiary" iconOnly aria-label={`Replay “${shown}”`} icon={<Volume2 aria-hidden />} onClick={() => sayFrench(shown)} />
          {ipa && <span className="wp-ipa t-support">{ipa}</span>}
          {!inSheet && <Button kind="tertiary" iconOnly className="wp-close" aria-label="Close word card" icon={<X aria-hidden />} onClick={onClose} />}
        </div>
        {baseForm && !nested && (
          <button type="button" className="text-link" onClick={useBaseForm}>Base form: <span lang="fr">{baseForm}</span></button>
        )}
        {nested && <Button kind="tertiary" icon={<ArrowLeft aria-hidden />} onClick={() => setNested(null)}>Back to {text}</Button>}
      </header>

      {!nested && (
        <section className="wp-meaning" aria-label="Meaning in this sentence">
          <h3 className="t-label">Meaning in this sentence <span className="wp-ai">AI</span></h3>
          {tooLong ? (
            <p className="t-support">Select a word or a short phrase to see its meaning.</p>
          ) : meaning ? (
            <p className="wp-definition t-section" lang="en">{meaning}</p>
          ) : ctxSt === "loading" ? (
            <><Spinner label="Finding the meaning…" /><Skeleton lines={1} /></>
          ) : ctxSt === "error" ? (
            <div className="stack gap-2"><p className="t-support">Couldn’t load the meaning in this sentence.</p><Button kind="secondary" onClick={loadCtx}>Retry</Button></div>
          ) : (
            <p className="t-support">No English meaning available for this sentence.</p>
          )}
          {phraseMeaning && (
            <p className="t-support">
              <span lang="fr" className="t-strong">{overlapping?.phrase || overlapping?.text}</span>
              {" · "}{phraseMeaning}
            </p>
          )}
        </section>
      )}

      {!tooLong && (
        <section className="wp-dict" aria-label="Dictionary">
          <h3 className="t-label">Dictionary</h3>
          {dictSt === "loading" && <Spinner label="Loading dictionary…" />}
          {dictSt === "error" && (
            <Banner tone="error" title="Dictionary request failed" actions={<Button kind="secondary" onClick={loadDict}>Retry</Button>}>
              {englishOnly(dictErr) || "Please try again."}
            </Banner>
          )}
          {dictSt === "ready" && (dictEntries.length ? (
            <>
              <p className="t-meta">Wiktionnaire · French definitions</p>
              {dictEntries.map((entry, index) => {
                const entryIpa = formatFriendlyPhonetic(entry.phonetic);
                const primary = entry.senses.slice(0, 4);
                const rest = entry.senses.slice(4);
                return (
                  <div className="wp-source-entry" key={`${entry.lemma}-${entry.pos}-${index}`}>
                    <p className="t-strong">
                      <span lang="fr">{entry.lemma}</span>
                      <span className="t-support"> · {entry.pos}{entryIpa ? ` · ${entryIpa}` : ""}</span>
                    </p>
                    <ol className="wp-senses" lang="fr">
                      {primary.map((sense, i) => <li key={i}>{sense}</li>)}
                    </ol>
                    {rest.length > 0 && (
                      <details>
                        <summary className="t-support">{rest.length} more senses</summary>
                        <ol className="wp-senses" start={primary.length + 1} lang="fr">
                          {rest.map((sense, i) => <li key={i}>{sense}</li>)}
                        </ol>
                      </details>
                    )}
                    <p className="t-meta">
                      <a href={entry.source_url} target="_blank" rel="noopener noreferrer">Source entry</a>
                      {" · "}
                      <a href={entry.history_url} target="_blank" rel="noopener noreferrer">Contributors</a>
                    </p>
                  </div>
                );
              })}
              <p className="wp-attribution t-meta">
                {dict?.attribution} <a href={dict?.license_url} target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>
                {dict?.changes && <span> {dict.changes}</span>}
              </p>
            </>
          ) : <p className="t-support">No dictionary entry found. The meaning in this sentence is shown above.</p>)}
        </section>
      )}

      {!nested && why && (
        <section className={cx("wp-collapsible", whyOpen && "wp-collapsible--open")}>
          <button type="button" className="wp-toggle" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
            <span>Usage notes</span><ChevronDown aria-hidden width={16} height={16} />
          </button>
          {whyOpen && (
            <div className="wp-collapsible-body">
              <p className="t-support" lang="en">{why}</p>
            </div>
          )}
        </section>
      )}

      <footer className="wp-footer">
        <div className="wp-actions">
          <Button kind="secondary" aria-pressed={fav} icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />} onClick={() => void setFavorite(text, !fav)}>
            {fav ? "Favorited" : "Favorite"}
          </Button>
          {count !== undefined && (
            <div className="wp-importance">
              <span className="t-label">Importance</span>
              <Importance count={count} lookups="muted" />
            </div>
          )}
        </div>
        {!nested && <button type="button" className="text-link" onClick={onGrammar}>Sentence grammar</button>}
      </footer>
    </div>
  );
}
