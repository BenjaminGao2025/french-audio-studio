import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Sparkles, WifiOff, Database } from "lucide-react";
import type { DictEntry } from "../data/fixtures";
import { lookupKey } from "../lib/lookup";
import { aiFor, announce, dictionaryFor, recordLookup, saveSnapshot, set, simulate, useApp } from "../state/store";
import { Banner, Button, Disclosure, Importance, Pill, Skeleton, Spinner } from "../components/ui";

type WState =
  | "loading"
  | "success"
  | "nomatch"
  | "error"
  | "ai-loading"
  | "ai-success"
  | "ai-error"
  | "offline-cached"
  | "offline-uncached";

export function WordPanel({
  entry,
  sentenceId,
  onGrammar,
  onClose,
  inSheet,
}: {
  entry: string;
  sentenceId: string;
  onGrammar: () => void;
  onClose: () => void;
  inSheet?: boolean;
}) {
  const key = lookupKey(entry);
  const offline = useApp((s) => s.offline);
  const snapshot = useApp((s) => s.snapshots[key]);
  const ctxSnap = useApp((s) => s.ctxSnapshots[`${key}|${sentenceId}`]);
  const count = useApp((s) => s.lookups[key]?.count ?? 0);
  const fav = useApp((s) => !!s.favorites[key]);
  const forced = useApp((s) => s.ss["SCR-WRD-01"] ?? s.ss["SCR-WRD-03"]);
  const [st, setSt] = useState<WState>("loading");
  const [counted, setCounted] = useState<boolean | null>(null);
  const [full, setFull] = useState(false);
  const counter = useRef<string | null>(null);
  const dict = dictionaryFor(entry);

  const load = () => {
    if (offline) {
      setSt(snapshot ? "offline-cached" : "offline-uncached");
      return;
    }
    setSt("loading");
    simulate("dictionary", 600, dict)
      .then((d) => {
        if (d) {
          saveSnapshot(d, sentenceId);
          setSt("success");
        } else setSt("nomatch");
      })
      .catch(() => {
        // A failed request never overwrites a valid saved snapshot.
        setSt("error");
        announce("Dictionary request failed.", true);
      });
  };
  const tryAI = () => {
    setSt("ai-loading");
    announce("Loading AI explanation.");
    simulate("ai", 900, true)
      .then(() => {
        setSt("ai-success");
        announce("AI explanation ready.");
      })
      .catch(() => {
        setSt("ai-error");
        announce("AI explanation failed.", true);
      });
  };

  useEffect(() => {
    if (counter.current !== entry) {
      counter.current = entry;
      setCounted(recordLookup(entry).counted);
    }
    setFull(false);
    if (forced && forced !== "auto") {
      setSt(forced as WState);
      return;
    }
    load();
  }, [entry, forced, offline]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown: DictEntry | undefined =
    st === "success" ? dict ?? snapshot : st === "offline-cached" || st === "error" ? snapshot : undefined;
  const contextText = shown ? shown.context[sentenceId] ?? ctxSnap : undefined;

  const favoriteBtn = (
    <Button
      kind="tertiary"
      className="btn--sm-text"
      aria-pressed={fav}
      icon={fav ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
      onClick={() => {
        set((s) => ({ favorites: { ...s.favorites, [key]: !fav } }));
        announce(fav ? "Removed from favorites. Lookup count and importance are unchanged." : "Added to favorites. Lookup count and importance are unchanged.");
      }}
    >
      {fav ? "Favorited" : "Favorite"}
    </Button>
  );

  return (
    <div className="stack gap-3" aria-busy={st === "loading" || st === "ai-loading"}>
      <div className="word-head" style={{ position: "sticky", top: inSheet ? 0 : -16, background: "var(--surface)", paddingTop: 2, zIndex: 1 }}>
        <div className="grow stack gap-1">
          <span className="t-support">
            French <span lang="fr" className="t-strong" style={{ color: "var(--text)" }}>{shown?.entry ?? entry}</span>
          </span>
          {shown && <span className="word-main" data-autofocus tabIndex={-1}>{shown.main}</span>}
          {!shown && !inSheet && <span className="t-strong" data-autofocus tabIndex={-1}>Meaning</span>}
        </div>
        {favoriteBtn}
      </div>

      <Importance count={count} />
      {counted !== null && (
        <p className="t-meta">{counted ? "This lookup was counted." : "Not counted: you looked this up less than 5 seconds after the last counted lookup."}</p>
      )}

      {st === "loading" && (
        <>
          <Spinner label="Looking up…" />
          <Skeleton lines={3} />
        </>
      )}

      {(st === "offline-cached" || st === "offline-uncached") && (
        <Banner tone={st === "offline-cached" ? "info" : "warning"} title={st === "offline-cached" ? "Saved definition available offline" : "This definition is not available offline"}>
          {st === "offline-cached"
            ? "You’re offline (simulated). This is the definition saved on this device. Audio and AI explanations need a connection."
            : "You’re offline (simulated) and this word hasn’t been saved on this device yet."}
        </Banner>
      )}

      {st === "error" && (
        <Banner
          tone="error"
          title="Dictionary request failed"
          live="assertive"
          actions={
            <>
              <Button kind="secondary" onClick={load}>Retry</Button>
              {!snapshot && <Button kind="tertiary" icon={<Sparkles aria-hidden />} onClick={tryAI}>Try AI explanation</Button>}
            </>
          }
        >
          {snapshot ? "Showing your saved definition below. It was not changed by this failure." : "No definition was saved, so nothing is lost."}
        </Banner>
      )}

      {shown && (
        <div className="stack gap-3">
          <div className="stack gap-1">
            <span className="def-label">Dictionary meaning</span>
            <p>{shown.dictionary}</p>
          </div>
          {contextText && (
            <div className="stack gap-1">
              <span className="def-label">In this sentence</span>
              <p>{contextText}</p>
            </div>
          )}
          {shown.meta && <p className="t-meta">{shown.meta}</p>}
          {shown.more && (
            <div className="stack gap-2">
              {full && (
                <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
                  {shown.more.map((m) => (
                    <li key={m} className="t-support" style={{ color: "var(--text)" }}>{m}</li>
                  ))}
                </ul>
              )}
              <Button kind="tertiary" className="btn--sm-text" style={{ alignSelf: "flex-start", marginLeft: -12 }} aria-expanded={full} onClick={() => setFull(!full)}>
                {full ? "Show less" : `Show full entry (${shown.more.length} more notes)`}
              </Button>
            </div>
          )}
          <div>
            {shown.why && (
              <Disclosure summary="Why this meaning">
                <p className="t-support" style={{ color: "var(--text)" }}>{shown.why}</p>
              </Disclosure>
            )}
            {shown.etymology && (
              <Disclosure summary="Etymology">
                <p className="t-support" style={{ color: "var(--text)" }}>{shown.etymology}</p>
              </Disclosure>
            )}
          </div>
          <p className="t-meta">Source: {shown.source}</p>
        </div>
      )}

      {st === "nomatch" && (
        <Banner tone="neutral" title={`No dictionary match for “${entry}”`} actions={<Button kind="secondary" icon={<Sparkles aria-hidden />} onClick={tryAI}>Try AI explanation</Button>}>
          This phrase isn’t in the demo dictionary. Nothing was saved as a definition.
        </Banner>
      )}
      {st === "ai-loading" && <Spinner label="Getting an AI explanation…" />}
      {st === "ai-success" && (
        <div className="stack gap-2">
          <span className="ai-label"><Sparkles aria-hidden width={12} height={12} /> AI explanation · Demo</span>
          <p>{aiFor(entry)}</p>
        </div>
      )}
      {st === "ai-error" && (
        <Banner tone="error" title="AI explanation failed" live="assertive" actions={<Button kind="secondary" onClick={tryAI}>Retry</Button>}>
          The demo AI service didn’t respond. Nothing was saved as a definition.
        </Banner>
      )}

      {(st === "offline-uncached" || st === "offline-cached") && (
        <div className="stack gap-2">
          {st === "offline-uncached" && (
            <Button kind="secondary" onClick={load} disabledReason={offline ? "Retry when you’re back online." : undefined}>
              Retry
            </Button>
          )}
          {offline && st === "offline-uncached" && <p className="t-meta">Retry when you’re back online.</p>}
        </div>
      )}
      {offline && (
        <p className="note"><Database aria-hidden /> Full offline dictionary package: Not available in this prototype.</p>
      )}
      {offline && <p className="note"><WifiOff aria-hidden /> Saved definitions don’t include offline audio, AI explanations or exams.</p>}

      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <Button kind="tertiary" className="btn--sm-text" style={{ marginLeft: -12 }} onClick={onGrammar}>
          Grammar for this sentence
        </Button>
        {!inSheet && <Button kind="tertiary" className="btn--sm-text" onClick={onClose}>Close</Button>}
      </div>
      {fav && <Pill tone="info">Favorite is a bookmark only — it doesn’t change importance</Pill>}
    </div>
  );
}
