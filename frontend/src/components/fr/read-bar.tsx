import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Volume2, X } from "lucide-react";
import { placeBar, type Rect } from "@/lib/read-selection";

/**
 * The floating "Read selection" bar of a selected run of French words (see FrenchWords). It is
 * position: fixed in the page body, near the selection, and always inside the viewport. The buttons
 * are 44px tall on touch screens (.fr-read-btn in styles.css).
 */
export function ReadBar({
  rect,
  touch,
  canRead,
  canMeaning,
  playing,
  error,
  onRead,
  onMeaning,
  onClear,
  onPress,
}: {
  /** The selection on screen, in viewport coordinates. */
  rect: Rect;
  /** A touch screen: the bar goes below the selection instead of above it. */
  touch: boolean;
  canRead: boolean;
  canMeaning: boolean;
  /** The selection is being read aloud. */
  playing: boolean;
  error: boolean;
  onRead: () => void;
  onMeaning: () => void;
  /** Only in range mode: drops the highlighted words. */
  onClear?: (() => void) | undefined;
  /** A finger or the mouse went down on the bar: the selection may collapse before the click. */
  onPress: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  // Placed after every render, before paint: it needs the bar's own size, and the selection
  // moves when the page scrolls or resizes
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const { left, top, docked } = placeBar(
      rect,
      { width: el.offsetWidth || 230, height: el.offsetHeight || 44 },
      { width: window.innerWidth, height: window.innerHeight },
      touch,
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset["docked"] = String(docked);
  });
  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selection actions"
      data-fr-read-bar
      className="fr-read-bar"
      // Pressing a button must not steal focus or collapse the selection it acts on
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={onPress}
    >
      <button
        type="button"
        className={`fr-read-btn fr-read-btn-main${playing ? " is-playing" : ""}`}
        disabled={!canRead}
        aria-busy={playing || undefined}
        onClick={onRead}
      >
        <Volume2 className="h-4 w-4" aria-hidden="true" />
        Read selection
      </button>
      {canMeaning && (
        <button type="button" className="fr-read-btn" onClick={onMeaning}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Meaning
        </button>
      )}
      {onClear && (
        <button
          type="button"
          className="fr-read-btn"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {error && (
        <span role="alert" className="fr-read-error">
          Audio unavailable — try again.
        </span>
      )}
    </div>,
    document.body,
  );
}
