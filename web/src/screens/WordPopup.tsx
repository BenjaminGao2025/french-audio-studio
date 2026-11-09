import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronDown, Volume2 } from "lucide-react";
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
 * A word card in four levels: L1 headword/chips, L2 the meaning in this sentence and its context,
 * L3 the collapsed details (why, dictionary, roots), L4 the footer. Analysis words show their
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
  const [dictMore, setDictMore] = useState(false);

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
    setDictMore(false);
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
  const whyZh = ctx?.why_zh || w?.why || "";
  const dictText = dict && (dict.explanation_cn || dict.explanation_en) ? dict : null;

  return (
    <div className="word-card stack gap-3" aria-busy={dictSt === "loading" || ctxSt === "loading"}>
      {/* L1 — headword, replay, IPA and chips */}
      <div className="wp-head">
        <div className="row gap-2" style={{ alignItems: "baseline" }}>
          <span className="wp-headword" lang="fr" data-autofocus tabIndex={-1}>{shown}</span>
          <Button
            kind="tertiary"
            className="btn--sm-text wp-replay"
            iconOnly
            aria-label={`Replay “${shown}”`}
            icon={<Volume2 aria-hidden />}
            onClick={() => sayFrench(shown)}
          />
        </div>
        {ipa && <p className="wp-ipa">/{ipa}/</p>}
        <div className="wp-chips">
          {pos && <span className="wp-chip">{pos}</span>}
          {baseForm && !nested && (
            <button type="button" className="wp-chip wp-chip--action" onClick={useBaseForm}>
              base form: <span lang="fr">{baseForm}</span>
            </button>
          )}
          {falseFriend && <Pill tone="warning">False friend</Pill>}
        </div>
        {nested && (
          <Button kind="tertiary" className="btn--sm-text" icon={<ArrowLeft aria-hidden />} onClick={() => setNested(null)}>
            Back to {text}
          </Button>
        )}
      </div>

      {!nested && (
        <>
          {/* L2 — meaning in this sentence */}
          <section className="stack gap-1" aria-label="In this sentence">
            <span className="wp-label">In this sentence</span>
            {tooLong ? (
              <div className="wp-insentence">
                <p className="t-support">Pick a few words to see their meaning here.</p>
                {translation_zh && <p className="t-support" lang="zh">{translation_zh}</p>}
                {sentence.en && <p className="t-support">{sentence.en}</p>}
              </div>
            ) : isAnalysis ? (
              <div className="wp-insentence">
                <p className="wp-insentence-zh" lang="zh">{w!.meaning_zh || "—"}</p>
                <p className="wp-insentence-en">{w!.meaning}</p>
              </div>
            ) : ctxSt === "loading" ? (
              <div className="wp-insentence"><Spinner label="Explaining it here…" /><Skeleton lines={2} /></div>
            ) : ctxSt === "error" ? (
              <div className="wp-insentence">
                <p className="t-support">Couldn’t explain it here.</p>
                <Button kind="secondary" onClick={loadCtx}>Retry</Button>
              </div>
            ) : (
              <div className="wp-insentence">
                <p className="wp-insentence-zh" lang="zh">{ctx?.meaning_zh || "—"}</p>
                <p className="wp-insentence-en">{ctx?.meaning_en || ""}</p>
              </div>
            )}
          </section>

          {/* L2 — context */}
          <section className="stack gap-1" aria-label="Context">
            <span className="wp-label">Context</span>
            <p className="t-body" lang="fr"><Highlight sentence={sentence.fr} pick={text} occurrence={occurrence} /></p>
            {translation_zh && <p className="t-support" lang="zh">{translation_zh}</p>}
            <p className="t-support">{sentence.en}</p>
            {overlapping && (
              <div className="wp-phrase">
                <p className="row gap-2">
                  <span className="wp-chip">Fixed phrase</span>
                  <span className="t-strong" lang="fr">{overlapping.phrase || overlapping.text}</span>
                </p>
                <p className="t-support" lang="zh">{overlapping.meaning_zh} · {overlapping.meaning_en}</p>
                {overlapping.literal_zh && <p className="t-meta" lang="zh">{overlapping.literal_zh}</p>}
              </div>
            )}
          </section>

          {/* L3 — why this form (collapsed) */}
          {(whyZh || englishLink) && (
            <section className={cx("wp-collapsible", whyOpen && "wp-collapsible--open")}>
              <button type="button" className="wp-toggle" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
                <span className="wp-label">Why this form</span>
                <ChevronDown aria-hidden width={16} height={16} />
              </button>
              {whyOpen && (
                <div className="wp-collapsible-body">
                  {whyZh && <p className="t-support" lang="zh" style={{ color: "var(--text)" }}>{whyZh}</p>}
                  {englishLink && !falseFriend && <p className="t-meta">Like English “{englishLink}”.</p>}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* L3 — dictionary (clamped to three lines). Skipped for a long free selection. */}
      {!tooLong && (
        <section className="stack gap-1" aria-label="Dictionary">
          <span className="wp-label">Dictionary{dict?.lemma && dict.lemma.toLowerCase() !== shown.toLowerCase() ? ` · ${dict.lemma}` : ""}</span>
          {dictSt === "loading" && <><Spinner label="Looking up the dictionary entry…" /><Skeleton lines={2} /></>}
          {dictSt === "error" && (
            <Banner tone="error" title="Dictionary request failed" live="assertive" actions={<Button kind="secondary" onClick={loadDict}>Retry</Button>}>
              {dictErr || "The dictionary didn’t respond."}
            </Banner>
          )}
          {dictSt === "ready" && dictText && (
            <>
              <div className={cx("wp-dict", !dictMore && "wp-clamp")}>
                {dictText.explanation_cn && <span lang="zh">{dictText.explanation_cn}</span>}
                {dictText.explanation_cn && dictText.explanation_en && <span aria-hidden> · </span>}
                {dictText.explanation_en && <span>{dictText.explanation_en}</span>}
              </div>
              <Button kind="tertiary" className="btn--sm-text" aria-expanded={dictMore} onClick={() => setDictMore(!dictMore)}>
                {dictMore ? "Less" : "More"}
              </Button>
            </>
          )}
        </section>
      )}

      {!nested && !text.includes(" ") && !tooLong && (
        /* L3 — roots & origin (fetched only when expanded) */
        <section className={cx("wp-collapsible wp-ety", etyOpen && "wp-ety--open")} aria-label="Roots and origin">
          <button type="button" className="wp-toggle" aria-expanded={etyOpen} onClick={openEty}>
            <span className="wp-label">Roots &amp; origin · 词根词源</span>
            <ChevronDown aria-hidden width={16} height={16} />
          </button>
          {etyOpen && (
            <div className="wp-collapsible-body">
              {etySt === "loading" && <Spinner label="Looking up the roots…" />}
              {etySt === "error" && (
                <div className="stack gap-2">
                  <p className="t-support">Couldn’t load the roots.</p>
                  <Button kind="secondary" onClick={loadEty}>Retry</Button>
                </div>
              )}
              {etySt === "ready" && <p className="t-support" lang="zh" style={{ color: "var(--text)" }}>{ety}</p>}
            </div>
          )}
        </section>
      )}

      {/* L4 — footer */}
      <div className="wp-footer">
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {count !== undefined && <Importance count={count} />}
          <Button
            kind="tertiary"
            className="btn--sm-text"
            aria-pressed={fav}
            icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
            onClick={() => void setFavorite(text, !fav)}
          >
            {fav ? "Favorited" : "Favorite"}
          </Button>
          <Button kind="tertiary" className="btn--sm-text" onClick={onGrammar}>Grammar for this sentence</Button>
          {!inSheet && <Button kind="tertiary" className="btn--sm-text" onClick={onClose}>Close</Button>}
        </div>
        <p className="t-meta">Meanings are written by AI and can be wrong. Each lookup raises the word’s importance.</p>
      </div>
    </div>
  );
}
