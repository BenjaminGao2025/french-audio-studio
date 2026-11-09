import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { ApiError } from "../api/client";
import { lookupWord, recordLookup, useLookupCount, type DictionaryEntry } from "../api/lookup";
import { loadFavorites, setFavorite } from "../api/review";
import type { StudySentence } from "../data/fixtures";
import { lookupKey } from "../lib/lookup";
import { announce, get, patchStudy, useApp } from "../state/store";
import { Banner, Button, Disclosure, Importance, Skeleton, Spinner } from "../components/ui";

/** Remembers that a word of this sentence was looked up, so Add to review can offer it as a Fill-in card. */
function pick(sentenceId: string, wordIndex: number) {
  const picked = get().study.picked;
  const list = picked[sentenceId] ?? [];
  if (!list.includes(wordIndex)) patchStudy({ picked: { ...picked, [sentenceId]: [...list, wordIndex] } });
}

/*
 * A word's meaning: "In this sentence" comes from the analysis itself (no request); the dictionary
 * entry is an AI lookup of the base form. Opening the panel counts one lookup on the server.
 */
export function WordPanel({
  sentence,
  wordIndex,
  entry,
  onGrammar,
  onClose,
  inSheet,
}: {
  sentence: StudySentence;
  wordIndex?: number;
  entry: string;
  onGrammar: () => void;
  onClose: () => void;
  inSheet?: boolean;
}) {
  const w = wordIndex !== undefined ? sentence.raw?.words?.[wordIndex] : undefined;
  const headword = w?.lemma || entry;
  const count = useLookupCount(entry);
  const [dict, setDict] = useState<DictionaryEntry | null>(null);
  const [st, setSt] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [counted, setCounted] = useState<boolean | null>(null);
  const fav = useApp((s) => Boolean(s.favorites[lookupKey(entry)]));
  useEffect(() => {
    loadFavorites().catch(() => undefined);
  }, []);

  const load = () => {
    setSt("loading");
    lookupWord(headword)
      .then((d) => {
        setDict(d);
        setSt("ready");
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "");
        setSt("error");
        announce("Dictionary request failed.", true);
      });
  };

  useEffect(() => {
    setDict(null);
    setCounted(null);
    load();
    if (wordIndex !== undefined) pick(sentence.id, wordIndex);
    recordLookup(entry)
      .then((r) => setCounted(r.incremented))
      .catch(() => setCounted(null));
  }, [entry, sentence.id, wordIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const main = w?.meaning || dict?.explanation_en || "";
  const ipa = w?.ipa || dict?.phonetic || "";
  const pos = w?.type || dict?.pos || "";
  const baseForm = w?.lemma && w.lemma.toLowerCase() !== entry.toLowerCase() ? w.lemma : "";

  return (
    <div className="stack gap-3" aria-busy={st === "loading"}>
      <div className="word-head" style={{ position: "sticky", top: inSheet ? 0 : -16, background: "var(--surface)", paddingTop: 2, zIndex: 1 }}>
        <div className="grow stack gap-1">
          <span className="t-support">
            French <span lang="fr" className="t-strong" style={{ color: "var(--text)" }}>{entry}</span>
            {ipa && <span> · /{ipa}/</span>}
          </span>
          {main ? (
            <span className="word-main" data-autofocus tabIndex={-1}>{main}</span>
          ) : (
            !inSheet && <span className="t-strong" data-autofocus tabIndex={-1}>Meaning</span>
          )}
        </div>
      </div>

      {count !== undefined && <Importance count={count} />}
      {counted === false && <p className="t-meta">Not counted again: you looked this up less than 5 seconds ago.</p>}

      {w && (
        <div className="stack gap-1">
          <span className="def-label">In this sentence</span>
          {w.meaning !== main && <p>{w.meaning}</p>}
          {w.meaning_zh && <p className="t-support" lang="zh">{w.meaning_zh}</p>}
          {(baseForm || pos) && (
            <p className="t-meta">
              {baseForm && <>Base form <span lang="fr">{baseForm}</span>{pos ? " · " : ""}</>}
              {pos}
            </p>
          )}
          {w.false_friend && <p className="t-meta">False friend: it doesn’t mean what the English look-alike means.</p>}
          {w.english_link && !w.false_friend && <p className="t-meta">Like English “{w.english_link}”.</p>}
        </div>
      )}

      {st === "loading" && (
        <>
          <Spinner label="Looking up the dictionary entry…" />
          <Skeleton lines={2} />
        </>
      )}
      {st === "error" && (
        <Banner tone="error" title="Dictionary request failed" live="assertive" actions={<Button kind="secondary" onClick={load}>Retry</Button>}>
          {error || "The dictionary didn’t respond."} {w ? "The meaning in this sentence is unaffected." : ""}
        </Banner>
      )}
      {st === "ready" && dict && (dict.explanation_en || dict.explanation_cn) && (
        <div className="stack gap-1">
          <span className="def-label">Dictionary meaning{dict.lemma && dict.lemma.toLowerCase() !== entry.toLowerCase() ? ` · ${dict.lemma}` : ""}</span>
          {dict.explanation_en && <p>{dict.explanation_en}</p>}
          {dict.explanation_cn && <p className="t-support" lang="zh">{dict.explanation_cn}</p>}
        </div>
      )}

      {w?.why && (
        <Disclosure summary="Why this form">
          <p className="t-support" style={{ color: "var(--text)" }}>{w.why}</p>
        </Disclosure>
      )}
      <p className="t-meta">Meanings are written by AI and can be wrong. Each lookup raises the word’s importance.</p>

      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <div className="row gap-2">
          <Button kind="tertiary" className="btn--sm-text" style={{ marginLeft: -12 }} onClick={onGrammar}>
            Grammar for this sentence
          </Button>
          <Button
            kind="tertiary"
            className="btn--sm-text"
            aria-pressed={fav}
            icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
            onClick={() => void setFavorite(entry, !fav)}
          >
            {fav ? "Favorited" : "Favorite"}
          </Button>
        </div>
        {!inSheet && <Button kind="tertiary" className="btn--sm-text" onClick={onClose}>Close</Button>}
      </div>
    </div>
  );
}
