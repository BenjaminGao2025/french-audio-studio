import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { TextCursor, Volume2 } from "lucide-react";
import { api } from "@/api";
import { audioController } from "@/lib/audio-controller";
import {
  WORD_TAP_SLOP,
  glossFor,
  nearestElement,
  tokenizeFrench,
  type WordGloss,
} from "@/lib/french-words";
import {
  DRAG_SLOP,
  endedDrag,
  hasSelectedText,
  snapRangeToWords,
  trackGestures,
  unionRect,
  wordsText,
  type Rect,
} from "@/lib/read-selection";
import { cn } from "@/lib/utils";
import { closeSharedWordCard, showSharedWordCard } from "@/lib/shared-word-card";

// Only one word card is open on a page: opening another closes this one.
let closeOpenCard: (() => void) | null = null;

interface OpenWord {
  /** Index of the word's token, or -1 for a selected phrase. */
  index: number;
  word: string;
  gloss: WordGloss | null;
  status: "ready" | "loading" | "none";
  style: CSSProperties;
}

/** The words picked in range mode: the first tap, then the last. Only valid for the text it was made in. */
interface Pick {
  text: string;
  start: number;
  end: number | null;
}

type Box = Rect & { width: number; height: number };
interface Anchor {
  getBoundingClientRect(): Box;
}

const CARD_WIDTH = 288;
/** Space the card needs above or below the text. */
const CARD_ROOM = 220;
/** How long a selection must stay put before it is read (touch handles move it a lot). */
const SETTLE_MS = 250;
/** How long a collapsed selection is ignored, so a finished selection still opens its card. */
const COLLAPSE_MS = 200;

const toBox = (r: Rect): Box => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });
const rectOfRange = (range: Range): Rect => {
  const { left, top, right, bottom } = range.getBoundingClientRect();
  return { left, top, right, bottom };
};
const bare = (word: string) => word.replace(/['’]$/, "").toLowerCase();

/** The French text whose selection is being handled: the first one the range touches. */
function ownerLine(range: Range): Element | undefined {
  return Array.from(document.querySelectorAll(".fr-words")).find((el) => range.intersectsNode(el));
}

/**
 * French text whose words can be tapped: a tap plays the word through the shared audio controller
 * and opens a small card with its meaning. Every word has a hit area of at least 44px on touch
 * screens with no gaps between neighbours (see .fr-word in styles.css), a tap that still misses
 * goes to the nearest word on the line, and words never interfere with the row around them.
 *
 * A drag (or a long press with handles) selects words instead: the selection snaps to whole words
 * and opens their meaning card, whose speaker plays them aloud. With `sentenceControls` the
 * text also gets a "Read sentence" button and a "Select words" switch for range mode: tap the first
 * word, then the last one, which does the same without touch handles.
 */
export function FrenchWords({
  text,
  glosses = [],
  as: Tag = "p",
  className,
  onWord,
  sentenceControls = false,
}: {
  text: string;
  /** What the analysis already knows about the words of this text. */
  glosses?: WordGloss[];
  as?: "p" | "span" | "div";
  className?: string;
  /** Called with the tapped word, e.g. to select the sentence it belongs to. */
  onWord?: (word: string) => void;
  /** Adds the Read sentence button and the range-mode switch under the text. */
  sentenceControls?: boolean;
}) {
  const tokens = useMemo(() => tokenizeFrench(text), [text]);
  const host = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState<OpenWord | null>(null);
  const [playing, setPlaying] = useState<"sentence" | null>(null);
  const [audioError, setAudioError] = useState<"word" | "sentence" | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const pick = picked && picked.text === text ? picked : null;

  // What the document-level listeners need to see without being set up again on every render
  const openRef = useRef<OpenWord | null>(null);
  const rangeRef = useRef(false);
  const pickRef = useRef<Pick | null>(null);
  // A selection made by opening a card must not open it again on the next selectionchange
  const used = useRef(false);
  const consumedRange = useRef<Range | null>(null);
  const dragJustEnded = useRef(false);
  useEffect(() => {
    openRef.current = open;
  });

  const close = useCallback(() => {
    closeSharedWordCard();
    setOpen(null);
    setAudioError(null);
  }, []);

  const resetSelection = useCallback(() => {
    used.current = false;
  }, []);

  // Stop this component's audio when it goes away, and forget its card
  useEffect(
    () => () => {
      if (audio.current) audioController.stop(audio.current);
      if (closeOpenCard === close) {
        closeSharedWordCard();
        closeOpenCard = null;
      }
    },
    [close],
  );
  // The consumed selection belongs to the text it was made for
  useEffect(() => resetSelection, [text, resetSelection]);

  // Escape or a press anywhere else closes the card
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPress = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest("[data-fr-card], [data-fr-word]")) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open, close]);

  // ---- Reading aloud -------------------------------------------------------------------------

  // Called straight from the click, so iOS lets the audio start. `by` is the control that gets the
  // "playing" state while the clip runs.
  const speak = (words: string, by: "word" | "sentence" = "word") => {
    const url = api.speech.ttsUrl(words);
    if (!url) return;
    const clip = new Audio(url);
    audio.current = clip;
    setAudioError(null);
    setPlaying(by === "word" ? null : by);
    const ended = () => setPlaying((cur) => (audio.current === clip ? null : cur));
    const failed = () => {
      if (audio.current !== clip) return;
      setAudioError(by);
      ended();
    };
    clip.onended = ended;
    clip.onerror = failed;
    audioController
      .play(clip, ended)
      .then((started) => {
        if (!started) ended();
      })
      .catch(failed);
  };

  // ---- The word card -------------------------------------------------------------------------

  const placeCard = (anchor: Anchor): CSSProperties => {
    const box = host.current;
    if (!box) return {};
    const hostRect = box.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, box.clientWidth || CARD_WIDTH);
    const center = rect.left - hostRect.left + rect.width / 2;
    const left = Math.max(0, Math.min(center - width / 2, (box.clientWidth || width) - width));
    // Clear of the whole text, so the other lines of a wrapped sentence stay tappable while the
    // card is open: above it for a word in the upper half, below it for the lower half (when
    // there is room on that side)
    const roomAbove = hostRect.top > CARD_ROOM;
    const roomBelow = window.innerHeight - hostRect.bottom > CARD_ROOM;
    const lowerHalf = rect.top + rect.bottom > hostRect.top + hostRect.bottom;
    const below = roomAbove && roomBelow ? lowerHalf : !roomAbove;
    return below
      ? { left, width, top: hostRect.height + 8 }
      : { left, width, bottom: hostRect.height + 8 };
  };

  const openEntry = (
    word: string,
    index: number,
    anchor: Anchor,
    options: { silent?: boolean } = {},
  ) => {
    resetSelection();
    if (closeOpenCard && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    // A selection already carries its own audio; it plays from the card's speaker instead.
    if (!options.silent) speak(word);
    let start =
      index >= 0 ? tokens.slice(0, index).reduce((n, token) => n + token.text.length, 0) : -1;
    let sourceRange: Range | null = null;
    const selection = window.getSelection();
    if (index < 0 && selection?.rangeCount && line.current) {
      const range = selection.getRangeAt(0);
      if (
        line.current.contains(range.startContainer) &&
        line.current.contains(range.endContainer)
      ) {
        sourceRange = range.cloneRange();
        const prefix = document.createRange();
        prefix.selectNodeContents(line.current);
        prefix.setEnd(range.startContainer, range.startOffset);
        start = prefix.toString().length;
      }
    }
    used.current = true;
    consumedRange.current = sourceRange;
    setOpen({ index, word, gloss: null, status: "ready", style: placeCard(anchor) });
    void showSharedWordCard(
      word,
      text,
      start,
      {
        getBoundingClientRect: () => anchor.getBoundingClientRect(),
        coversRange: (other) =>
          Boolean(
            sourceRange &&
            sourceRange.compareBoundaryPoints(Range.START_TO_START, other) === 0 &&
            sourceRange.compareBoundaryPoints(Range.END_TO_END, other) === 0,
          ),
      },
      speak,
      () => setOpen(null),
      glossFor(word, glosses),
      line.current,
    );
  };

  // The document listeners are set up once; this lets them see the latest openEntry.
  const openEntryRef = useRef(openEntry);
  useEffect(() => {
    openEntryRef.current = openEntry;
  });

  const openWord = (el: HTMLElement) => {
    const word = el.dataset["frWord"] ?? "";
    if (!word) return;
    openEntry(word, Number(el.dataset["frIndex"]), el);
    onWord?.(word);
  };

  // ---- Range mode: pick the first and the last word instead of dragging ----------------------

  const updatePick = (next: Pick | null) => {
    pickRef.current = next;
    setPicked(next);
  };

  const wordEls = () =>
    Array.from(line.current?.querySelectorAll<HTMLElement>("[data-fr-index]") ?? []);

  const rangeRect = (lo: number, hi: number): Rect | null =>
    unionRect(
      wordEls()
        .filter((el) => Number(el.dataset["frIndex"]) >= lo && Number(el.dataset["frIndex"]) <= hi)
        .map((el) => el.getBoundingClientRect()),
    );

  const clearRange = useCallback(() => {
    pickRef.current = null;
    setPicked(null);
    resetSelection();
  }, [resetSelection]);

  const rangeTap = (el: HTMLElement) => {
    const index = Number(el.dataset["frIndex"]);
    if (!Number.isFinite(index)) return;
    const cur = pickRef.current?.text === text ? pickRef.current : null;
    if (!cur || cur.end !== null) {
      // The first word of a new span
      updatePick({ text, start: index, end: null });
      resetSelection();
      return;
    }
    updatePick({ text, start: cur.start, end: index });
    const lo = Math.min(cur.start, index);
    const hi = Math.max(cur.start, index);
    const words = wordsText(
      tokens
        .slice(lo, hi + 1)
        .map((t) => t.text)
        .join(""),
    );
    const rect = rangeRect(lo, hi);
    if (!words || !rect) return;
    // A complete span opens its meaning card straight away and leaves range mode.
    rangeRef.current = false;
    setRangeMode(false);
    clearRange();
    openEntryRef.current(words, lo, { getBoundingClientRect: () => toBox(rect) }, { silent: true });
  };

  const toggleRange = () => {
    if (rangeMode) {
      rangeRef.current = false;
      setRangeMode(false);
      clearRange();
      return;
    }
    rangeRef.current = true;
    setRangeMode(true);
    // A native selection and the highlighted span must not be on screen together
    window.getSelection()?.removeAllRanges();
    close();
  };

  // ---- Native selection: drag, or a long press with handles ----------------------------------

  // The word a point means: the one under it, else the nearest one on this text
  const wordNear = useCallback(
    (target: EventTarget | null, x: number, y: number): HTMLElement | null => {
      const el = target instanceof Element ? target : null;
      const direct = el?.closest<HTMLElement>("[data-fr-word]");
      if (direct) return direct;
      if (!el || !line.current?.contains(el)) return null;
      const words = line.current.querySelectorAll<HTMLElement>("[data-fr-word]");
      return nearestElement(words, x, y, WORD_TAP_SLOP) as HTMLElement | null;
    },
    [],
  );

  // Paints the words from `from` to `to` as the document selection, snapped to whole words.
  // A drag that runs past this text is cut at its end.
  const paintDrag = useCallback(
    (from: HTMLElement, to: HTMLElement) => {
      const el = line.current;
      if (!el) return;
      const range = document.createRange();
      if (from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING) {
        range.setStartBefore(from);
        range.setEndAfter(to);
      } else {
        range.setStartBefore(to);
        range.setEndAfter(from);
      }
      const snapped = snapRangeToWords(range, el);
      if (!snapped) return;
      dragJustEnded.current = true;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(snapped.range);
      // No toolbar while dragging: mouseup opens the card for the finished selection.
      used.current = false;
    },
    [],
  );

  useEffect(() => {
    const el = line.current;
    if (!el) return;
    const untrack = trackGestures();
    let settle: ReturnType<typeof setTimeout> | undefined;
    let mouseHeld = false;
    const inBar = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-fr-read-bar]") !== null;

    // The selection as whole words of this text, or null when it is empty or belongs to another text
    const snap = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      return ownerLine(range) === el ? snapRangeToWords(range, el) : null;
    };
    const evaluate = () => {
      if (rangeRef.current) return;
      const found = snap();
      const consumed = consumedRange.current;
      if (
        used.current &&
        found &&
        consumed &&
        consumed.compareBoundaryPoints(Range.START_TO_START, found.range) === 0 &&
        consumed.compareBoundaryPoints(Range.END_TO_END, found.range) === 0
      )
        return;
      if (!found) return;
      // A double click opened the card of this very word and then selected it: the card is enough
      const shown = openRef.current;
      if (shown && shown.index >= 0 && bare(shown.word) === bare(found.text)) return;
      const rect = rectOfRange(found.range);
      // A finished selection opens its meaning card directly; its speaker is the audio path.
      openEntryRef.current(
        found.text,
        -1,
        { getBoundingClientRect: () => toBox(rect) },
        { silent: true },
      );
    };
    const later = (ms: number) => {
      clearTimeout(settle);
      settle = setTimeout(evaluate, ms);
    };

    // Touch selections have no mouseup: wait until the handles stop moving
    const onSelectionChange = () => {
      if (mouseHeld || rangeRef.current) return;
      later(snap() ? SETTLE_MS : COLLAPSE_MS);
    };
    const onMouseDown = (e: globalThis.MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-word-card], [data-fr-card]"))
        return;
      used.current = false;
      if (e.button === 0 && !inBar(e.target)) mouseHeld = true;
    };
    const onMouseUp = (e: globalThis.MouseEvent) => {
      if (!mouseHeld) return;
      mouseHeld = false;
      if (rangeRef.current || inBar(e.target)) return;
      clearTimeout(settle);
      if (snap()) evaluate();
      else later(COLLAPSE_MS);
    };
    // The mouse drag is painted here, not by the browser: a native drag that starts on a word
    // does not survive — the word is focusable, which cancels the browser's selection drag when
    // the caret lands at its edge, and the 44px hit area above the text moves the selection
    // anchor past the word, dropping it from the selection. (A long press on a phone selects
    // natively with the system handles and is not touched by this.)
    const drag = { x: 0, y: 0, from: null as HTMLElement | null };
    const startDrag = (e: globalThis.MouseEvent) => {
      if (e.button !== 0 || inBar(e.target) || rangeRef.current) return;
      dragJustEnded.current = false;
      const el = e.target instanceof Element ? e.target : null;
      // Only a press on this text is taken over; anywhere else the browser may select
      if (!el || !line.current?.contains(el)) return;
      const word = wordNear(el, e.clientX, e.clientY);
      if (!word) return;
      e.preventDefault();
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.from = word;
    };
    const onDocMove = (e: globalThis.MouseEvent) => {
      if (!drag.from) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_SLOP) return;
      const to = wordNear(e.target, e.clientX, e.clientY);
      if (to) paintDrag(drag.from, to);
    };
    const endDrag = () => {
      drag.from = null;
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onDocMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mouseup", endDrag);
    return () => {
      clearTimeout(settle);
      untrack();
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousedown", startDrag);
      document.removeEventListener("mousemove", onDocMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mouseup", endDrag);
    };
  }, [resetSelection, wordNear, paintDrag]);

  // Escape drops the span picked in range mode
  useEffect(() => {
    if (!rangeMode) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") clearRange();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rangeMode, clearRange]);

  // ---- Clicks and keys on the text -----------------------------------------------------------

  // The word under a click, else the nearest one on the line. A drag, or text that is selected,
  // is not a tap: a drag-select ends in a click on the line around the words, which must never
  // be turned into a tap on the nearest word. A click without a position (keyboard, script) only
  // counts on a word itself. In range mode no selection can exist, so only the drag counts.
  const wordOf = (e: MouseEvent<HTMLElement>): HTMLElement | null => {
    if (dragJustEnded.current) {
      dragJustEnded.current = false;
      return null;
    }
    if (endedDrag()) return null;
    const direct =
      e.target instanceof Element ? e.target.closest<HTMLElement>("[data-fr-word]") : null;
    if (direct) return direct;
    if (!rangeMode && hasSelectedText()) return null;
    if (e.detail === 0) return null;
    return nearestElement(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-fr-word]"),
      e.clientX,
      e.clientY,
      WORD_TAP_SLOP,
    ) as HTMLElement | null;
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = wordOf(e);
    if (!el) return;
    if (rangeMode) rangeTap(el);
    else openWord(el);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-fr-word]") : null;
    if (!el) return;
    e.preventDefault();
    if (rangeMode) rangeTap(el);
    else openWord(el);
  };

  const range = pick
    ? {
        lo: Math.min(pick.start, pick.end ?? pick.start),
        hi: Math.max(pick.start, pick.end ?? pick.start),
      }
    : null;
  const hint = rangeMode
    ? !pick
      ? "Tap the first word"
      : pick.end === null
        ? "Tap the last word"
        : ""
    : "";
  const sentenceBtn =
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium transition hover:bg-secondary disabled:opacity-40 aria-pressed:border-primary aria-pressed:bg-accent aria-busy:bg-accent";
  return (
    <div ref={host} className="relative">
      <Tag
        ref={line as never}
        lang="fr"
        className={cn("fr-words", rangeMode && "is-range-mode", className)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {tokens.map((token, i) =>
          token.word === undefined ? (
            token.text
          ) : (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className={cn("fr-word", range && i >= range.lo && i <= range.hi && "fr-word-range")}
              data-fr-word={token.word}
              data-fr-index={i}
              aria-haspopup="dialog"
              aria-expanded={open?.index === i}
            >
              {token.text}
            </span>
          ),
        )}
      </Tag>
      {sentenceControls && (
        <div className="fr-sentence-controls mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Read sentence"
            title="Read sentence"
            className={sentenceBtn}
            disabled={!api.speech.ttsUrl(text)}
            aria-busy={playing === "sentence" || undefined}
            onClick={() => speak(text, "sentence")}
          >
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            Read
          </button>
          <button
            type="button"
            aria-label="Select words"
            title="Select words"
            className={sentenceBtn}
            aria-pressed={rangeMode}
            onClick={toggleRange}
          >
            <TextCursor className="h-4 w-4" aria-hidden="true" />
            Select
          </button>
          {hint && (
            <span role="status" className="text-xs text-muted-foreground">
              {hint}
            </span>
          )}
          {audioError === "sentence" && (
            <span role="alert" className="text-xs text-destructive">
              Audio unavailable — try again.
            </span>
          )}
        </div>
      )}
      {open && audioError === "word" && (
        <span role="alert" className="text-xs text-destructive">
          Audio unavailable — try again.
        </span>
      )}
    </div>
  );
}
