import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StepPart } from "../data/fixtures";
import { sayFrench } from "../state/store";

/*
 * Selectable French text. Words are <span role="button"> (never <button>), so the browser can
 * drag a native selection across them; the old read-selection.js behaviour is reproduced here:
 * a tap says one word, a drag says the words it covers snapped to whole words.
 */

export interface FrSegment {
  t: string;
  /** A clickable word or phrase chunk (an analysis segment, or a tokenised word). */
  w?: boolean;
  /** Index into the analysis word list, for real analyses. */
  wi?: number;
  /** Marks the part a build-up step just added. */
  added?: boolean;
  /** Highlights the review card's target word using --mark-bg. */
  mark?: boolean;
}

export interface FrPick {
  text: string;
  wordIndex?: number;
  /** Index of this text among its occurrences in the sentence (/api/word-context needs it). */
  occurrence: number;
  /** A real element: the desktop Popover only accepts an element as its anchor. */
  anchor: HTMLElement;
}

const WORD_RE = /([A-Za-zÀ-ÖØ-öø-ÿŒœ0-9]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*)/;

/** Tokenise raw French into word spans and the text between them, using the old read-selection regex. */
export function tokenizeFrench(text: string): FrSegment[] {
  const out: FrSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(WORD_RE.source, "g"))) {
    const i = m.index!;
    if (i > last) out.push({ t: text.slice(last, i) });
    out.push({ t: m[0], w: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out.length ? out : [{ t: text }];
}

/** Build-up steps keep their "added" highlight while every word stays selectable. */
export function stepSegments(parts: StepPart[]): FrSegment[] {
  const out: FrSegment[] = [];
  for (const p of parts) for (const seg of tokenizeFrench(p.t)) out.push({ ...seg, added: p.added });
  return out;
}

interface Built {
  segs: FrSegment[];
  full: string;
  posOf: number[];
}

function build(segments?: FrSegment[], text?: string): Built {
  // Analysis segments keep multi-word chunks ("est-ce que") together. With no analysis words
  // (segmentsFor returns one plain chunk), fall back to tokenising the raw text so words stay tappable.
  const segs =
    segments && segments.some((s) => s.w)
      ? segments
      : tokenizeFrench(segments ? segments.map((s) => s.t).join("") : (text ?? ""));
  const full = segs.map((s) => s.t).join("");
  const posOf: number[] = [];
  let at = 0;
  for (const s of segs) {
    posOf.push(at);
    at += s.t.length;
  }
  return { segs, full, posOf };
}

export function FrText({
  segments,
  text,
  onPick,
  className = "",
}: {
  segments?: FrSegment[];
  /** Raw French; tokenised with the old regex when no analysis segments are given. */
  text?: string;
  onPick: (p: FrPick) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const { segs, full, posOf } = useMemo(() => build(segments, text), [segments, text]);
  const lastFire = useRef<{ text: string; at: number } | null>(null);

  const occurrenceOf = useCallback(
    (value: string, pos: number): number => {
      const needle = value.toLocaleLowerCase("fr");
      const hay = full.toLocaleLowerCase("fr").slice(0, Math.max(0, pos));
      let n = 0;
      let i = 0;
      while ((i = hay.indexOf(needle, i)) !== -1) {
        n++;
        i += needle.length;
      }
      return n;
    },
    [full],
  );

  /** A deliberate word tap / keyboard activation always speaks and opens the card. */
  const emit = useCallback(
    (p: FrPick) => {
      // Record the marker so a trailing selectionchange for this same gesture/text is ignored.
      lastFire.current = { text: p.text, at: Date.now() };
      sayFrench(p.text);
      onPick(p);
    },
    [onPick],
  );

  /** A drag can notify twice (pointerup + debounced selectionchange); keep only the first.
   *  A selection right after a tap of the same text is likewise suppressed. */
  const emitSelection = useCallback(
    (p: FrPick) => {
      const last = lastFire.current;
      if (last && last.text === p.text && Date.now() - last.at < 1000) return;
      emit(p);
    },
    [emit],
  );

  /** A non-collapsed selection fully inside this element, snapped to whole words at the edges. */
  const readSelection = useCallback((): FrPick | null => {
    const root = rootRef.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const spans = Array.from(root.querySelectorAll<HTMLElement>(".fr-word"));
    const touched = spans.filter((sp) => range.intersectsNode(sp));
    if (!touched.length) return null;
    const value = touched.map((sp) => (sp.textContent ?? "").trim()).join(" ");
    if (!value) return null;
    const first = touched[0];
    const pos = Number(first.dataset.pos ?? 0);
    return { text: value, occurrence: occurrenceOf(value, pos), anchor: first };
  }, [occurrenceOf]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return; // touch is handled by selectionchange
      const p = readSelection();
      if (p) emitSelection(p);
    };
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const p = readSelection();
        if (p) emitSelection(p);
      }, 400);
    };
    root.addEventListener("pointerup", onPointerUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      root.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [readSelection, emitSelection]);

  const pickWord = (el: HTMLElement, seg: FrSegment, i: number) => {
    emit({ text: seg.t, wordIndex: seg.wi, occurrence: occurrenceOf(seg.t, posOf[i]), anchor: el });
  };

  return (
    <p ref={rootRef} className={`fr-text ${className}`} lang="fr">
      {segs.map((seg, i) =>
        seg.w ? (
          <span
            key={i}
            className={`fr-word${seg.added ? " fr-added" : ""}${seg.mark ? " fr-mark" : ""}`}
            data-word={seg.t}
            data-wi={seg.wi}
            data-pos={posOf[i]}
            tabIndex={0}
            role="button"
            onClick={(e) => {
              const el = e.currentTarget;
              e.stopPropagation();
              const sel = typeof window !== "undefined" ? window.getSelection() : null;
              if (sel && !sel.isCollapsed) return; // a drag just ended; the selection handler owns it
              pickWord(el, seg, i);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              pickWord(e.currentTarget, seg, i);
            }}
          >
            {seg.t}
          </span>
        ) : (
          <span key={i} className={`${seg.added ? "fr-added" : ""}${seg.mark ? " fr-mark" : ""}` || undefined}>
            {seg.t}
          </span>
        ),
      )}
    </p>
  );
}
