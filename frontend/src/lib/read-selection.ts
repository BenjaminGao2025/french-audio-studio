// Selection helpers for tappable French text (components/fr/words.tsx): snapping a selection to
// whole words, placing the floating "Read selection" bar, and telling a tap from a drag. Same rules
// as the legacy /study page (static/read-selection.js), so a selection reads the same on both.

export const DRAG_SLOP = 8;
/** The word card takes up to this many characters; a longer selection can only be read aloud. */
export const MEANING_MAX_CHARS = 40;
export const BAR_MARGIN = 8;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const isLetterOrDigit = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /\p{N}/u.test(c);

// Letters, digits and the joiners of l'homme, aujourd’hui, est-ce count as part of a word; so do
// the , . : inside a number (3,5 15:30), like the tokenizer in french-words.ts
function isWordChar(full: string, i: number): boolean {
  const c = full[i];
  if (c === undefined) return false;
  if (isLetterOrDigit(c) || c === "'" || c === "’" || c === "-") return true;
  return (c === "," || c === "." || c === ":") && isDigit(full[i - 1]) && isDigit(full[i + 1]);
}

/**
 * Widens [start, end) of `full` to whole words where an end falls inside one, then trims spaces and
 * punctuation off both ends (a trailing apostrophe stays: "qu'"). null when no word is left.
 */
export function snapOffsets(full: string, start: number, end: number): [number, number] | null {
  let s = Math.max(0, Math.min(start, full.length));
  let e = Math.max(s, Math.min(end, full.length));
  if (s > 0 && s < full.length && isWordChar(full, s - 1) && isWordChar(full, s)) {
    while (s > 0 && isWordChar(full, s - 1)) s--;
  }
  if (e > 0 && e < full.length && isWordChar(full, e - 1) && isWordChar(full, e)) {
    while (e < full.length && isWordChar(full, e)) e++;
  }
  while (s < e && !isLetterOrDigit(full[s])) s++;
  while (e > s && !(isLetterOrDigit(full[e - 1]) || full[e - 1] === "'" || full[e - 1] === "’"))
    e--;
  return s < e && /[\p{L}\p{N}]/u.test(full.slice(s, e)) ? [s, e] : null;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The text of a run of words as it is read aloud: whitespace collapsed, no punctuation at the ends. */
export function wordsText(text: string): string {
  const span = snapOffsets(text, 0, text.length);
  return span ? collapse(text.slice(span[0], span[1])) : "";
}

export interface SnappedSelection {
  /** The selected words, ready to read: whole words only, whitespace collapsed. */
  text: string;
  /** A range around exactly those words, for its position on screen. */
  range: Range;
}

function textNodesOf(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

/** How many characters of `container`'s text come before a point inside it. */
function offsetOf(container: Element, node: Node, offset: number): number {
  const before = document.createRange();
  before.setStart(container, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

function pointAt(
  nodes: Text[],
  offset: number,
  atEnd: boolean,
): { node: Text; offset: number } | null {
  let passed = 0;
  for (const node of nodes) {
    const length = node.data.length;
    if (
      atEnd
        ? offset > passed && offset <= passed + length
        : offset >= passed && offset < passed + length
    ) {
      return { node, offset: offset - passed };
    }
    passed += length;
  }
  return null;
}

/**
 * The selection `range` as the whole words of `container` it touches. Only the container's own text
 * counts: a selection that runs on past either end (a drag over the line below, the English gloss)
 * is cut at the end of the French line. null when it holds no word of the container.
 */
export function snapRangeToWords(range: Range, container: Element): SnappedSelection | null {
  if (range.collapsed || !range.intersectsNode(container)) return null;
  const bounds = document.createRange();
  bounds.selectNodeContents(container);
  const full = bounds.toString();
  const start =
    range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0
      ? 0
      : offsetOf(container, range.startContainer, range.startOffset);
  const end =
    range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0
      ? full.length
      : offsetOf(container, range.endContainer, range.endOffset);
  const span = snapOffsets(full, start, end);
  if (!span) return null;
  const nodes = textNodesOf(container);
  const from = pointAt(nodes, span[0], false);
  const to = pointAt(nodes, span[1], true);
  if (!from || !to) return null;
  const tight = document.createRange();
  tight.setStart(from.node, from.offset);
  tight.setEnd(to.node, to.offset);
  const text = collapse(full.slice(span[0], span[1]));
  return text ? { text, range: tight } : null;
}

export function canShowMeaning(text: string): boolean {
  return text.length <= MEANING_MAX_CHARS && /\p{L}/u.test(text);
}

/** The smallest rectangle around all the given boxes, or null when there are none. */
export function unionRect(rects: Iterable<Rect>): Rect | null {
  let union: Rect | null = null;
  for (const r of rects) {
    union = union
      ? {
          left: Math.min(union.left, r.left),
          top: Math.min(union.top, r.top),
          right: Math.max(union.right, r.right),
          bottom: Math.max(union.bottom, r.bottom),
        }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return union;
}

export interface Size {
  width: number;
  height: number;
}

export interface BarPlacement {
  left: number;
  top: number;
  /** Nothing fit near the selection, so the bar sits at the bottom of the screen. */
  docked: boolean;
}

/**
 * Where the bar goes (position: fixed, so viewport coordinates). A mouse gets it above the selection;
 * on a touch screen it goes below, because the system callout sits above a selection and its handles
 * hang at the ends. The other side is the fallback, then the bottom of the screen. Always inside the
 * viewport.
 */
export function placeBar(rect: Rect, bar: Size, viewport: Size, touch: boolean): BarPlacement {
  const margin = BAR_MARGIN;
  const maxLeft = Math.max(margin, viewport.width - bar.width - margin);
  const left = Math.max(margin, Math.min((rect.left + rect.right) / 2 - bar.width / 2, maxLeft));
  const fits = (top: number) => top >= margin && top + bar.height <= viewport.height - margin;
  const below = rect.bottom + (touch ? 28 : 10);
  const above = rect.top - 10 - bar.height;
  const order = touch ? [below, above] : [above, below];
  const top = order.find(fits);
  if (top !== undefined) return { left, top, docked: false };
  return { left, top: Math.max(margin, viewport.height - bar.height - margin), docked: true };
}

/** True when the box is entirely off screen (a bar for it would point at nothing). */
export function isOffScreen(rect: Rect, viewport: Size): boolean {
  return (
    rect.bottom < 0 || rect.top > viewport.height || rect.right < 0 || rect.left > viewport.width
  );
}

// ---------------------------------------------------------------------------------------------
// Tap or drag? A drag-select ends with a click on the text around the words, and the nearest-word
// rule would turn that into a tap on a word. So every pointer gesture is measured, and a click that
// follows one that moved more than DRAG_SLOP is not a tap.

const gesture = { x: 0, y: 0, active: false, moved: false, endedAt: Number.NEGATIVE_INFINITY };
let trackers = 0;
let untrackAll: (() => void) | null = null;
/** A click comes right after the pointer is released; an older gesture says nothing about it. */
const CLICK_WINDOW_MS = 800;

function startTracking() {
  const down = (e: MouseEvent) => {
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    gesture.active = true;
    gesture.moved = false;
  };
  const move = (e: MouseEvent) => {
    if (gesture.active && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > DRAG_SLOP) {
      gesture.moved = true;
    }
  };
  const up = (e: MouseEvent) => {
    move(e);
    gesture.active = false;
    gesture.endedAt = performance.now();
  };
  const passive = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", down as EventListener, passive);
  document.addEventListener("pointermove", move as EventListener, passive);
  document.addEventListener("pointerup", up as EventListener, passive);
  document.addEventListener("pointercancel", up as EventListener, passive);
  untrackAll = () => {
    document.removeEventListener("pointerdown", down as EventListener, passive);
    document.removeEventListener("pointermove", move as EventListener, passive);
    document.removeEventListener("pointerup", up as EventListener, passive);
    document.removeEventListener("pointercancel", up as EventListener, passive);
  };
}

/** Starts measuring pointer gestures (shared by every text on the page); returns the stop function. */
export function trackGestures(): () => void {
  if (trackers++ === 0) {
    gesture.active = false;
    gesture.moved = false;
    gesture.endedAt = Number.NEGATIVE_INFINITY;
    startTracking();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    // The last text to leave also forgets the gesture, so a stale drag cannot reach a later click
    if (--trackers === 0) {
      untrackAll?.();
      gesture.active = false;
      gesture.moved = false;
      gesture.endedAt = Number.NEGATIVE_INFINITY;
    }
  };
}

/** True when the click being handled ended a pointer gesture that moved: a drag, not a tap. */
export function endedDrag(): boolean {
  return gesture.moved && performance.now() - gesture.endedAt < CLICK_WINDOW_MS;
}

/** True while some text on the page is selected. */
export function hasSelectedText(): boolean {
  return Boolean(window.getSelection()?.toString().trim());
}
