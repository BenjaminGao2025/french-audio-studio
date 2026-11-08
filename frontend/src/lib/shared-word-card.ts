// The SPA and legacy study/review pages use the same word-card renderer and guards.
import "../../../static/i18n.js";
import "../../../static/speech-eval.js";
import "../../../static/word-popover.js";
import "../../../static/word-context.js";
import "../../../static/word-popover.css";
import { api } from "@/api";
import { getToken } from "@/api/client";
import { normalizeLookup, type WordGloss } from "@/lib/french-words";

type Target = { sentence: string; word: string; occurrence: number; start: number; end: number };
type Anchor = {
  getBoundingClientRect():
    | DOMRect
    | DOMRectReadOnly
    | { left: number; top: number; right: number; bottom: number; width: number; height: number };
  coversRange?: (range: Range) => boolean;
};
type Card = {
  show(
    word: string,
    anchor: Anchor,
    context: { target: Target | null; sentence: string },
    navigation: { silent: boolean },
  ): Promise<void>;
  close(): void;
};
type Legacy = {
  FrenchWordPopover: { create(options: unknown): Card };
  FrenchWordContext: { spans(word: string, sentence: string): { start: number; end: number }[] };
};
const legacy = window as unknown as Legacy;
let card: Card | undefined;
let ownerClose: (() => void) | undefined;
let ownerBlock: HTMLElement | null = null;
let ownerSpeak: ((text: string) => void) | undefined;
const contexts = new Map<string, Promise<unknown>>();
export function closeSharedWordCard() {
  card?.close();
}
export function showSharedWordCard(
  word: string,
  sentence: string,
  start: number,
  anchor: Anchor,
  speak: (text: string) => void,
  onClose: () => void,
  gloss?: WordGloss | null,
  block?: HTMLElement | null,
) {
  ownerSpeak = speak;
  ownerBlock = block || null;
  ownerClose = onClose;
  card ??= legacy.FrenchWordPopover.create({
    speak: (text: string) => ownerSpeak?.(text),
    getAuthToken: getToken,
    lookup: async (word: string) => {
      const raw = await api.analyze.lookup(word);
      const gloss = normalizeLookup(word, raw);
      return {
        token: word,
        lemma: gloss?.lemma || word,
        pos: gloss?.pos || "",
        phonetic: gloss?.ipa || "",
        explanation_cn: gloss?.zh || "",
        explanation_en: gloss?.en || "",
      };
    },
    etymology: (word: string, lemma?: string) => api.analyze.etymology(word, lemma),
    selectionPopover: false,
    blockFor: () => ownerBlock,
    wordSelector: "[data-fr-word]",
    onClose: () => ownerClose?.(),
    wordContext: {
      target: (_word: string, _anchor: Anchor, context: { target: Target | null }) =>
        context.target,
      explain: (target: Target) => {
        const key = `${getToken()}:${target.sentence}:${target.word}:${target.occurrence}`;
        if (!contexts.has(key)) {
          const request = api.analyze
            .wordContext({
              sentence: target.sentence,
              word: target.word,
              occurrence: target.occurrence,
            })
            .then((reply) => ({ ...reply.context, state: reply.state }));
          request.catch(() => contexts.delete(key));
          contexts.set(key, request);
        }
        return contexts.get(key);
      },
    },
  });
  const spans = legacy.FrenchWordContext.spans(word, sentence);
  const occurrence = spans.findIndex((span) => span.start === start);
  const span = spans[occurrence];
  const target = span
    ? {
        sentence,
        word,
        occurrence,
        ...span,
        entry: gloss
          ? {
              meaning_zh: gloss.zh,
              meaning_en: gloss.en,
              why_en: gloss.why || gloss.note || "",
              lemma: gloss.lemma,
              pos: gloss.pos,
            }
          : null,
      }
    : null;
  return card.show(word, anchor, { target, sentence }, { silent: true });
}
