import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { StepPart } from "../data/fixtures";
import { sayFrench } from "../state/store";

/*
 * Selectable French text. Words are plain <span>s (never focusable, never buttons), so Chrome can
 * start a native drag-selection on them. The root <p> is the single tab stop: arrow keys move an
 * active word, Enter/Space speak it and open the card. A mouse tap still speaks the word; a drag
 * speaks the covered words snapped to whole words, keeping the original punctuation.
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

/**
 * Split every segment the analysis did NOT flag as a word into individual words, so even words the
 * analysis left out stay tappable. Analysis chunks ("est-ce que") are kept whole; only they carry wi.
 * The added/mark flags are carried onto every piece derived from a flagged segment, and posOf is
 * recomputed from the resulting pieces so word positions stay exact.
 */
export function build(segments?: FrSegment[], text?: string): Built {
  const base = segments ?? tokenizeFrench(text ?? "");
  const segs: FrSegment[] = [];
  for (const s of base) {
    if (s.w) {
      segs.push(s);
    } else {
      for (const piece of tokenizeFrench(s.t)) segs.push({ ...piece, added: s.added, mark: s.mark });
    }
  }
  const full = segs.map((s) => s.t).join("");
  const posOf: number[] = [];
  let at = 0;
  for (const s of segs) {
    posOf.push(at);
    at += s.t.length;
  }
  return { segs, full, posOf };
}

/** Whole-word occurrences of `word` in `text`, mirroring the server's word_spans (case-insensitive). */
export function findWordSpans(text: string, word: string): [number, number][] {
  const fold = (s: string) => s.replace(/[’ʼ]/g, "'").toLocaleLowerCase("fr");
  const want = fold(word.trim().replace(/\s+/g, " "));
  const have = fold(text);
  if (!want) return [];
  const isWordChar = (ch: string) => /[\p{L}\p{N}_\p{M}]/u.test(ch);
  const isApostrophe = (ch: string) => ch === "'" || ch === "’" || ch === "ʼ";
  const spans: [number, number][] = [];
  let at = have.indexOf(want);
  while (at !== -1) {
    const end = at + want.length;
    const before = at > 0 ? text[at - 1] : "";
    const after = end < text.length ? text[end] : "";
    if (!(before && (isWordChar(before) || isApostrophe(before))) && !(after && isWordChar(after))) {
      spans.push([at, end]);
    }
    at = have.indexOf(want, at + 1);
  }
  return spans;
}

/** The exact substring of the sentence covered by the first and last touched word spans. */
export function selectionText(full: string, first: { pos: number; text: string }, last: { pos: number; text: string }): string {
  return full.slice(first.pos, last.pos + last.text.length).trim();
}

interface SelectionRead extends FrPick {
  startPos: number;
  endPos: number;
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
  const baseId = useId();
  const spanId = (i: number) => `${baseId}-w${i}`;
  const wordIdx = useMemo(() => segs.map((s, i) => (s.w ? i : -1)).filter((i) => i >= 0), [segs]);
  const [active, setActive] = useState(-1); // position within wordIdx
  // Keep the latest onPick without re-running the document listeners on every render.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  /** The last mouse gesture barely moved: it is a click on a word, not a drag-selection. */
  const lastWasClick = useRef(false);

  const occurrenceOf = useCallback(
    (value: string, pos: number): number => {
      const spans = findWordSpans(full, value);
      const idx = spans.findIndex(([start]) => start === pos);
      if (idx >= 0) return idx;
      return spans.filter(([start]) => start < pos).length;
    },
    [full],
  );

  /** A deliberate word tap / keyboard activation always speaks and opens the card. */
  const emit = useCallback((p: FrPick) => {
    sayFrench(p.text);
    onPickRef.current(p);
  }, []);

  /** Dedupe by the selection's start/end word positions, never by time. */
  const fireSelection = useCallback(
    (p: SelectionRead) => {
      const last = lastSelection.current;
      if (last && last.start === p.startPos && last.end === p.endPos) return;
      lastSelection.current = { start: p.startPos, end: p.endPos };
      emit(p);
    },
    [emit],
  );

  /** A non-collapsed selection snapped to the whole words of THIS FrText it intersects. */
  const readSelection = useCallback((drag?: { start: number; end: number }): SelectionRead | null => {
    const root = rootRef.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    // intersectsNode also covers a range that runs past this root (a release outside the text).
    const spans = Array.from(root.querySelectorAll<HTMLElement>(".fr-word"));
    let touched = spans.filter((sp) => range.intersectsNode(sp));
    if (!touched.length) return null;
    // When a mouse drag leaves this paragraph, retain the words it crossed before leaving.
    // DOM positions work across wrapped lines and in either drag direction.
    if (drag && (!root.contains(range.startContainer) || !root.contains(range.endContainer))) {
      const start = Math.min(drag.start, drag.end);
      const end = Math.max(drag.start, drag.end);
      touched = touched.filter((sp) => Number(sp.dataset.pos) >= start && Number(sp.dataset.pos) <= end);
      if (!touched.length) return null;
    }
    const first = touched[0];
    const last = touched[touched.length - 1];
    const startPos = Number(first.dataset.pos ?? 0);
    const endPos = Number(last.dataset.pos ?? 0) + (last.textContent ?? "").length;
    const value = selectionText(full, { pos: startPos, text: first.textContent ?? "" }, { pos: Number(last.dataset.pos ?? 0), text: last.textContent ?? "" });
    if (!value) return null;
    return { text: value, occurrence: occurrenceOf(value, startPos), anchor: first, startPos, endPos };
  }, [full, occurrenceOf]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let primaryDown = false; // primary mouse button held
    let touchActive = false; // a touch/pen gesture is driving selectionchange
    let drag: { start: number; end: number } | undefined;
    let downAt: { x: number; y: number } | undefined;
    const wordAt = (e: PointerEvent) => {
      const word = e.target instanceof Element ? e.target.closest<HTMLElement>(".fr-word") : null;
      return word && root.contains(word) ? Number(word.dataset.pos) : undefined;
    };

    const attempt = (extent?: { start: number; end: number }) => {
      const p = readSelection(extent);
      if (p) {
        fireSelection(p);
      } else {
        // The selection was cleared/collapsed (e.g. a new gesture started): forget the last range so
        // a fresh drag over the same words fires again, while a kept selection never re-fires.
        const sel = typeof window !== "undefined" ? window.getSelection() : null;
        if (!sel || sel.isCollapsed) lastSelection.current = null;
      }
    };
    // A plain Event (jsdom tests) has no pointerType/button; treat it as the primary mouse button.
    const isPrimaryMouse = (e: PointerEvent) =>
      (!e.pointerType || e.pointerType === "mouse") && (e.button === undefined || e.button === 0);

    const onDown = (e: PointerEvent) => {
      if (isPrimaryMouse(e)) {
        primaryDown = true;
        touchActive = false;
        downAt = { x: e.clientX, y: e.clientY };
        const pos = wordAt(e);
        drag = pos === undefined ? undefined : { start: pos, end: pos };
        // Drop any debounced selectionchange left over from a previous gesture; it must not fire
        // mid-drag (that is the "pause half-way speaks a partial selection" bug).
        if (timer) { clearTimeout(timer); timer = undefined; }
        // A new mouse gesture starts a fresh selection: even dragging over the same words fires
        // again. A selection merely kept in place (no new pointerdown) keeps its dedup marker.
        lastSelection.current = null;
      } else if (e.pointerType === "touch" || e.pointerType === "pen") {
        touchActive = true;
        drag = undefined;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!primaryDown || !drag) return;
      const pos = wordAt(e);
      if (pos !== undefined) drag.end = pos;
    };
    const onUp = (e: PointerEvent) => {
      if (!isPrimaryMouse(e)) return; // touch/pen keep the debounced selectionchange path
      primaryDown = false;
      if (timer) { clearTimeout(timer); timer = undefined; }
      // Chrome keeps an old selection until after a click inside it, so a click must not be read
      // as a selection; the word's onClick handles it.
      const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : Infinity;
      lastWasClick.current = moved < 4;
      if (!lastWasClick.current) attempt(drag); // finish the drag on the document-level release, wherever it lands
      drag = undefined;
      downAt = undefined;
    };
    const onSelectionChange = () => {
      if (primaryDown) return; // a native mouse drag is in progress; wait for the release
      if (!touchActive) return; // mouse gestures fire on pointerup; only touch debounces
      if (timer) clearTimeout(timer);
      timer = setTimeout(attempt, 400);
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [readSelection, fireSelection]);

  const activeSeg = active >= 0 && active < wordIdx.length ? wordIdx[active] : -1;

  const pickWord = (i: number) => {
    const seg = segs[i];
    const el = document.getElementById(spanId(i)) ?? rootRef.current;
    if (!el) return;
    emit({ text: seg.t, wordIndex: seg.wi, occurrence: occurrenceOf(seg.t, posOf[i]), anchor: el });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLParagraphElement>) => {
    const n = wordIdx.length;
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive((prev) => {
        if (e.key === "Home") return 0;
        if (e.key === "End") return n - 1;
        if (e.key === "ArrowRight") return prev < 0 ? 0 : Math.min(n - 1, prev + 1);
        return prev < 0 ? n - 1 : Math.max(0, prev - 1);
      });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active < 0) { setActive(0); return; }
      pickWord(wordIdx[active]);
    }
  };

  return (
    <p
      ref={rootRef}
      className={`fr-text ${className}`}
      lang="fr"
      tabIndex={0}
      aria-label="French text. Use arrow keys to choose a word, Enter to hear it"
      aria-activedescendant={activeSeg >= 0 ? spanId(activeSeg) : undefined}
      onFocus={() => setActive(0)}
      onKeyDown={onKeyDown}
    >
      {segs.map((seg, i) =>
        seg.w ? (
          <span
            key={i}
            id={spanId(i)}
            className={`fr-word${seg.added ? " fr-added" : ""}${seg.mark ? " fr-mark" : ""}${i === activeSeg ? " is-active" : ""}`}
            data-word={seg.t}
            data-wi={seg.wi}
            data-pos={posOf[i]}
            onClick={(e) => {
              if (e.detail > 1) return; // double-click: the first click already spoke the word
              const sel = typeof window !== "undefined" ? window.getSelection() : null;
              if (sel && !sel.isCollapsed) {
                if (!lastWasClick.current) return; // a drag just ended; the selection handler owns it
                sel.removeAllRanges(); // a click inside an old selection picks this word, not the old phrase
              }
              setActive(wordIdx.indexOf(i));
              pickWord(i);
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
