// Word-level helpers for tappable French text (components/fr/words.tsx). Same tokenizer as the
// legacy /study page (static/study.js), so a word taps the same on both.

export interface WordGloss {
  word: string;
  ipa?: string | undefined;
  lemma?: string | undefined;
  pos?: string | undefined;
  en?: string | undefined;
  zh?: string | undefined;
  why?: string | undefined;
  note?: string | undefined;
}

export type FrenchToken = { text: string; word?: undefined } | { text: string; word: string };

const LETTER = "A-Za-zÀ-ÖØ-öø-ÿŒœ";
// A word with an inner apostrophe (l'homme), aujourd'hui, a number or time (15h30, 3,5, 1er), a
// run of punctuation, or whitespace
const TOKEN = new RegExp(
  `(aujourd['’]hui|[${LETTER}]+(?:['’][${LETTER}]+)?['’]?|\\d+(?:[.,:]\\d+)*(?:h\\d{0,2})?(?:ère|ere|er|re|ème|eme|e)?|[^\\s${LETTER}\\d]+|\\s+)`,
  "gi",
);
const STARTS_WORD = new RegExp(`^[${LETTER}\\d]`, "i");
const STARTS_PLAIN = new RegExp(`^[\\s${LETTER}\\d]`, "i");

/**
 * Splits text into words and everything else. Punctuation stuck to a word ("enfants,") is part of
 * that word's token, so the comma is part of its tap target; `word` is always the bare word.
 */
export function tokenizeFrench(text: string): FrenchToken[] {
  if (!text) return [];
  const raw = text.match(TOKEN) ?? [text];
  const tokens: FrenchToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!;
    if (STARTS_WORD.test(token)) {
      const word = token.replace(/['’]$/, "").trim() || token.trim();
      const next = raw[i + 1];
      const tail = next !== undefined && !STARTS_PLAIN.test(next) ? next : "";
      tokens.push({ word, text: token + tail });
      if (tail) i++;
    } else tokens.push({ text: token });
  }
  return tokens;
}

/** Pixels around a word within which a tap still counts for it: half of the 44px minimum. */
export const WORD_TAP_SLOP = 22;

/**
 * The element whose box is nearest to a point, within `slop` pixels (0 inside it); null when none
 * is that near. A tap between two words, on a comma or a few pixels off the glyphs still belongs
 * to the closest word on its line.
 */
export function nearestElement(
  elements: Iterable<Element>,
  x: number,
  y: number,
  slop: number,
): Element | null {
  let best: Element | null = null;
  let bestDistance = slop;
  for (const el of elements) {
    for (const r of Array.from(el.getClientRects())) {
      const distance = Math.hypot(
        Math.max(r.left - x, 0, x - r.right),
        Math.max(r.top - y, 0, y - r.bottom),
      );
      if (distance <= bestDistance) {
        best = el;
        bestDistance = distance;
      }
    }
  }
  return best;
}

const ELISION = /^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i;

/** The analysis entry for a tapped word: the word itself, its base form, or what follows an elision. */
export function glossFor(word: string, glosses: WordGloss[]): WordGloss | null {
  const lower = word.toLowerCase();
  const elided = lower.match(ELISION)?.[2];
  const same = (g: WordGloss, form: string) =>
    g.word.toLowerCase() === form || g.lemma?.toLowerCase() === form;
  return (
    glosses.find((g) => same(g, lower)) ??
    (elided ? glosses.find((g) => same(g, elided)) : null) ??
    null
  );
}

/** A /api/lookup answer as a gloss, or null when it has no meaning in it. */
export function normalizeLookup(word: string, raw: unknown): WordGloss | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const gloss: WordGloss = {
    word,
    ipa: text(r["phonetic"]) ?? text(r["ipa"]),
    lemma: text(r["lemma"]),
    pos: text(r["pos"]),
    en: text(r["explanation_en"]) ?? text(r["en"]),
    zh: text(r["explanation_cn"]) ?? text(r["zh"]),
  };
  return gloss.en || gloss.zh ? gloss : null;
}
