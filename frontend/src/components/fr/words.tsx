import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { Volume2, X } from "lucide-react";
import { api } from "@/api";
import { audioController } from "@/lib/audio-controller";
import {
  WORD_TAP_SLOP,
  glossFor,
  nearestElement,
  normalizeLookup,
  tokenizeFrench,
  type WordGloss,
} from "@/lib/french-words";
import { cn } from "@/lib/utils";

// Only one word card is open on a page: opening another closes this one.
let closeOpenCard: (() => void) | null = null;

interface OpenWord {
  index: number;
  word: string;
  gloss: WordGloss | null;
  status: "ready" | "loading" | "none";
  style: CSSProperties;
}

const CARD_WIDTH = 288;
/** Space the card needs above or below the text. */
const CARD_ROOM = 220;

/**
 * French text whose words can be tapped: a tap plays the word through the shared audio controller
 * and opens a small card with its meaning. Every word has a hit area of at least 44px on touch
 * screens with no gaps between neighbours (see .fr-word in styles.css), a tap that still misses
 * goes to the nearest word on the line, and words never interfere with the row around them.
 */
export function FrenchWords({
  text,
  glosses = [],
  as: Tag = "p",
  className,
  onWord,
}: {
  text: string;
  /** What the analysis already knows about the words of this text. */
  glosses?: WordGloss[];
  as?: "p" | "span" | "div";
  className?: string;
  /** Called with the tapped word, e.g. to select the sentence it belongs to. */
  onWord?: (word: string) => void;
}) {
  const tokens = useMemo(() => tokenizeFrench(text), [text]);
  const host = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState<OpenWord | null>(null);
  const [audioError, setAudioError] = useState(false);

  const close = useCallback(() => setOpen(null), []);

  // Stop this component's audio when it goes away, and forget it as the open card
  useEffect(
    () => () => {
      if (audio.current) audioController.stop(audio.current);
      if (closeOpenCard === close) closeOpenCard = null;
    },
    [close],
  );

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

  // Called straight from the click, so iOS lets the audio start
  const speak = (word: string) => {
    const url = api.speech.ttsUrl(word);
    if (!url) return;
    const clip = new Audio(url);
    audio.current = clip;
    setAudioError(false);
    audioController
      .play(clip, () => {})
      .catch(() => {
        if (audio.current === clip) setAudioError(true);
      });
  };

  const placeCard = (el: HTMLElement): CSSProperties => {
    const box = host.current;
    if (!box) return {};
    const hostRect = box.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
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

  const openWord = (el: HTMLElement) => {
    const word = el.dataset["frWord"] ?? "";
    if (!word) return;
    if (closeOpenCard && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    speak(word);
    onWord?.(word);
    const gloss = glossFor(word, glosses);
    const index = Number(el.dataset["frIndex"]);
    setOpen({ index, word, gloss, status: gloss ? "ready" : "loading", style: placeCard(el) });
    if (gloss) return;
    const settle = (found: WordGloss | null) =>
      setOpen((cur) =>
        cur && cur.word === word ? { ...cur, gloss: found, status: found ? "ready" : "none" } : cur,
      );
    void Promise.resolve()
      .then(() => api.analyze.lookup(word))
      .then((raw) => settle(normalizeLookup(word, raw)))
      .catch(() => settle(null));
  };

  // The word under a click, else the nearest one on the line. A drag that selected text is not a
  // tap, and a click without a position (keyboard, script) only counts on a word itself.
  const wordOf = (e: MouseEvent<HTMLElement>): HTMLElement | null => {
    const direct =
      e.target instanceof Element ? e.target.closest<HTMLElement>("[data-fr-word]") : null;
    if (direct) return direct;
    if (e.detail === 0 || window.getSelection()?.toString().trim()) return null;
    return nearestElement(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-fr-word]"),
      e.clientX,
      e.clientY,
      WORD_TAP_SLOP,
    ) as HTMLElement | null;
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = wordOf(e);
    if (el) openWord(el);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-fr-word]") : null;
    if (!el) return;
    e.preventDefault();
    openWord(el);
  };

  const gloss = open?.gloss;
  const meta = [gloss?.pos, gloss?.lemma && `base form: ${gloss.lemma}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div ref={host} className="relative">
      <Tag lang="fr" className={cn("fr-words", className)} onClick={onClick} onKeyDown={onKeyDown}>
        {tokens.map((token, i) =>
          token.word === undefined ? (
            token.text
          ) : (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className="fr-word"
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
      {open && (
        <div
          role="dialog"
          aria-label={`Meaning of ${open.word}`}
          data-fr-card
          className="panel absolute z-30 space-y-2 p-3 text-sm"
          style={open.style}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="fr text-lg font-semibold" lang="fr">
                {open.word}
              </span>
              {gloss?.ipa && <span className="ipa ml-2">{gloss.ipa}</span>}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
          {open.status === "loading" && <p role="status">Looking up…</p>}
          {open.status === "none" && (
            <p className="text-muted-foreground">No meaning found for this word.</p>
          )}
          {gloss?.en && <p>{gloss.en}</p>}
          {gloss?.zh && <p>{gloss.zh}</p>}
          {gloss?.why && <p className="text-xs text-muted-foreground">{gloss.why}</p>}
          {gloss?.note && <p className="text-xs text-muted-foreground">{gloss.note}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`Hear ${open.word}`}
              onClick={() => speak(open.word)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 hover:bg-secondary pointer-coarse:min-h-11"
            >
              <Volume2 className="h-4 w-4" />
              Hear
            </button>
            {audioError && (
              <span role="alert" className="text-xs text-destructive">
                Audio unavailable — try again.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
