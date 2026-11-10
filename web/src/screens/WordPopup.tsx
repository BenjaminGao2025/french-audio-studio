import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronDown, Volume2, X } from "lucide-react";
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
import { cx } from "../lib/format";
import { lookupKey } from "../lib/lookup";
import { announce, get, patchStudy, sayFrench, useApp } from "../state/store";
import { Banner, Button, Importance, Pill, Skeleton, Spinner } from "../components/ui";
import { findWordSpans } from "../components/FrText";

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

/** The sentence with only the picked whole-word occurrence highlighted (never a substring of another word). */
function Highlight({ sentence, pick, occurrence = 0 }: { sentence: string; pick: string; occurrence?: number }) {
  const spans = findWordSpans(sentence, pick);
  const span = spans[Math.min(Math.max(occurrence, 0), Math.max(0, spans.length - 1))];
  if (!span) return <>{sentence}</>;
  const [start, end] = span;
  return (
    <>
      {sentence.slice(0, start)}
      <mark className="wp-mark">{sentence.slice(start, end)}</mark>
      {sentence.slice(end)}
    </>
  );
}

type LoadState = "idle" | "loading" | "ready" | "error";

const EMPTY_HINTS: WordContextHints = { meaning_zh: "", meaning_en: "", note_en: "", lemma: "", pos: "" };

/*
 * English word meaning and a French example first, with secondary details collapsed.
 * The surrounding popover/sheet owns scrolling. Analysis words show their
 * fields instantly; a free selection or a word with no analysis asks /api/word-context.
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
  const isAnalysis = w !== undefined;
  // A long free selection is still spoken, but the server rejects it: show a hint instead of asking
  // /api/word-context or the dictionary. Analysis words always keep their stored meaning.
  const tooLong = !isAnalysis && (text.length > WORD_MAX_CHARS || (text.split(" ").length - 1) >= MAX_CHUNK_SPACES);
  const translation_zh = sentence.raw?.translation_zh ?? "";
  const hints = useMemo<WordContextHints>(
    () => (w ? { meaning_zh: w.meaning_zh, meaning_en: w.meaning, note_en: w.why, lemma: w.lemma, pos: w.type } : EMPTY_HINTS),
    [w],
  );

  const count = useLookupCount(text);
  const fav = useApp((s) => Boolean(s.favorites[lookupKey(text)]));

  const [nested, setNested] = useState<string | null>(null);
  const shown = nested ?? text;
  const ipa = w?.ipa || "";
  const pos = w?.type || "";
  const baseForm = w?.lemma && w.lemma.toLowerCase() !== text.toLowerCase() ? w.lemma : "";
  const falseFriend = w?.false_friend;
  const englishLink = w?.english_link;
  const lemmaForEty = baseForm || text;

  const [dict, setDict] = useState<DictionaryEntry | null>(null);
  const [dictSt, setDictSt] = useState<LoadState>(tooLong ? "idle" : "loading");
  const [dictErr, setDictErr] = useState("");
  const [dictOpen, setDictOpen] = useState(false);

  const [ctx, setCtx] = useState<WordContextResult | null>(null);
  const [ctxSt, setCtxSt] = useState<LoadState>(isAnalysis || tooLong ? "idle" : "loading");

  const [phrases, setPhrases] = useState<Phrase[]>([]);

  const [whyOpen, setWhyOpen] = useState(false);
  const [etyOpen, setEtyOpen] = useState(false);
  const [ety, setEty] = useState("");
  const [etySt, setEtySt] = useState<LoadState>("idle");

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
    if (isAnalysis || tooLong) return;
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
  }, [isAnalysis, tooLong, sentence.fr, text, occurrence, translation_zh, hints]);

  const loadEty = useCallback(() => {
    setEtySt("loading");
    etymology(shown, lemmaForEty, abort.current.signal)
      .then((r) => {
        if (!alive()) return;
        setEty(r.text);
        setEtySt("ready");
      })
      .catch(() => {
        if (alive()) setEtySt("error");
      });
  }, [shown, lemmaForEty]);

  useEffect(() => {
    loadDict();
  }, [loadDict]);

  useEffect(() => {
    setNested(null);
    setDictOpen(false);
    setPhrases([]);
    setEty("");
    setEtySt("idle");
    setEtyOpen(false);
    recordLookup(text).catch(() => undefined);
    if (wordIndex !== undefined) pick(sentence.id, wordIndex);
    loadCtx();
    // Phrase context is cached per sentence for the page, so it is fetched without this card's
    // abort signal (closing a card must not forget the shared answer).
    phraseContext(sentence.fr, translation_zh).then((r) => {
      if (alive()) setPhrases(r.phrases ?? []);
    }).catch(() => undefined);
  }, [text, sentence.id, wordIndex, sentence.fr, translation_zh, loadCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEty = () => {
    const next = !etyOpen;
    setEtyOpen(next);
    if (next && etySt === "idle") loadEty();
  };

  const useBaseForm = () => {
    sayFrench(baseForm);
    setNested(baseForm);
  };

  const overlapping = phrases.find((p) => phraseOverlaps(text, p.text));
  // Legacy analyses can contain Chinese notes; only English explanations belong in this card.
  const englishOnly = (value?: string) => value && !/\p{Script=Han}/u.test(value) ? value : "";
  const why = englishOnly(w?.why);
  const meaning = englishOnly(w?.meaning) || englishOnly(ctx?.meaning_en);
  const dictionary = englishOnly(dict?.explanation_en);

  return (
    <div className="word-card" aria-busy={dictSt === "loading" || ctxSt === "loading"}>
      <header className="wp-head">
        <div className="row row--between row--top">
          <div className="grow">
            <div className="row gap-2">
              <span className="wp-headword" lang="fr" data-autofocus tabIndex={-1}>{shown}</span>
              <Button kind="tertiary" iconOnly aria-label={`Replay “${shown}”`} icon={<Volume2 aria-hidden />} onClick={() => sayFrench(shown)} />
            </div>
            {(ipa || pos) && <p className="wp-meta">{[ipa && `/${ipa}/`, pos].filter(Boolean).join(" · ")}</p>}
          </div>
          {!inSheet && <Button kind="tertiary" iconOnly aria-label="Close word card" icon={<X aria-hidden />} onClick={onClose} />}
        </div>
        {baseForm && !nested && (
          <button type="button" className="wp-base" onClick={useBaseForm}>Base form: <span lang="fr">{baseForm}</span></button>
        )}
        {falseFriend && <Pill tone="warning">False friend</Pill>}
        {nested && <Button kind="tertiary" className="btn--sm-text" icon={<ArrowLeft aria-hidden />} onClick={() => setNested(null)}>Back to {text}</Button>}
      </header>

      {!nested && (
        <>
          <section className="wp-meaning" aria-label="Meaning in this sentence">
            <h3 className="wp-label">Meaning in this sentence</h3>
            {tooLong ? (
              <p className="t-support">Select a word or a short phrase to see its meaning.</p>
            ) : meaning ? (
              <p className="wp-definition" lang="en">{meaning}</p>
            ) : ctxSt === "loading" ? (
              <><Spinner label="Finding the meaning…" /><Skeleton lines={1} /></>
            ) : ctxSt === "error" ? (
              <div className="stack gap-2"><p className="t-support">Couldn’t load the meaning in this sentence.</p><Button kind="secondary" onClick={loadCtx}>Retry</Button></div>
            ) : (
              <p className="t-support">No English meaning available for this sentence.</p>
            )}
          </section>

          <section className="wp-context" aria-label="Example sentence">
            <h3 className="wp-label">Example sentence</h3>
            <p className="wp-example" lang="fr"><Highlight sentence={sentence.fr} pick={text} occurrence={occurrence} /></p>
            {englishOnly(sentence.en) && <p className="t-support" lang="en">{sentence.en}</p>}
            {overlapping && englishOnly(overlapping.meaning_en) && (
              <div className="wp-phrase">
                <p className="t-meta">Fixed expression</p>
                <p className="t-strong" lang="fr">{overlapping.phrase || overlapping.text}</p>
                <p className="t-support" lang="en">{overlapping.meaning_en}</p>
              </div>
            )}
          </section>
        </>
      )}

      {!tooLong && (
        <div className="wp-details">
          <section className={cx("wp-collapsible", dictOpen && "wp-collapsible--open")} aria-label="Dictionary">
            <button type="button" className="wp-toggle" aria-expanded={dictOpen} onClick={() => setDictOpen(!dictOpen)}>
              <span>Dictionary</span><ChevronDown aria-hidden width={16} height={16} />
            </button>
            {dictOpen && <div className="wp-collapsible-body">
              {dictSt === "loading" && <Spinner label="Loading dictionary…" />}
              {dictSt === "error" && <Banner tone="error" title="Dictionary request failed" actions={<Button kind="secondary" onClick={loadDict}>Retry</Button>}>{englishOnly(dictErr) || "Please try again."}</Banner>}
              {dictSt === "ready" && <>
                {dict?.lemma && dict.lemma.toLowerCase() !== shown.toLowerCase() && <p className="wp-meta" lang="fr">{dict.lemma}</p>}
                <p className="t-support" lang="en">{dictionary || "No English dictionary entry available."}</p>
              </>}
            </div>}
          </section>

          {!nested && (why || englishOnly(englishLink)) && (
            <section className={cx("wp-collapsible", whyOpen && "wp-collapsible--open")}>
              <button type="button" className="wp-toggle" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
                <span>Usage notes</span><ChevronDown aria-hidden width={16} height={16} />
              </button>
              {whyOpen && <div className="wp-collapsible-body">
                {why && <p className="t-support" lang="en">{why}</p>}
                {englishOnly(englishLink) && !falseFriend && <p className="t-support" lang="en">Like English “{englishLink}”.</p>}
              </div>}
            </section>
          )}

          {!nested && !text.includes(" ") && (
            <section className={cx("wp-collapsible wp-ety", etyOpen && "wp-collapsible--open")} aria-label="Roots and origin">
              <button type="button" className="wp-toggle" aria-expanded={etyOpen} onClick={openEty}>
                <span>Roots &amp; origin</span><ChevronDown aria-hidden width={16} height={16} />
              </button>
              {etyOpen && <div className="wp-collapsible-body">
                {etySt === "loading" && <Spinner label="Looking up the roots…" />}
                {etySt === "error" && <div className="stack gap-2"><p className="t-support">Couldn’t load the roots.</p><Button kind="secondary" onClick={loadEty}>Retry</Button></div>}
                {etySt === "ready" && <p className="t-support" lang="en">{englishOnly(ety) || "No English origin note available."}</p>}
              </div>}
            </section>
          )}
        </div>
      )}

      <footer className="wp-footer">
        <div className="row row--between">
          <Button kind="tertiary" className="btn--sm-text" aria-pressed={fav} icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />} onClick={() => void setFavorite(text, !fav)}>{fav ? "Favorited" : "Favorite"}</Button>
          {count !== undefined && <Importance count={count} />}
        </div>
        {!nested && <Button kind="tertiary" className="btn--sm-text" onClick={onGrammar}>Sentence grammar</Button>}
      </footer>
    </div>
  );
}
