import { Button } from "./ui/button";

/** Only explicit ⟦French surface⟧ marks create links. Malformed marks become plain text. */
export function explanationParts(text: string): { text: string; french: boolean }[] {
  const marks = /⟦([^⟦⟧]+)⟧/g;
  const plain = text.replace(marks, "");
  if (/[⟦⟧]/.test(plain)) return [{ text: text.replace(/[⟦⟧]/g, ""), french: false }];
  const parts: { text: string; french: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(marks)) {
    if (match.index! > at) parts.push({ text: text.slice(at, match.index), french: false });
    const surface = match[1];
    parts.push({ text: surface, french: /^[\p{L}\p{M}]+(?:['’ -][\p{L}\p{M}]+)*$/u.test(surface) });
    at = match.index! + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), french: false });
  return parts;
}

export function MarkedExplanation({ text, onWord }: { text: string; onWord: (word: string) => void }) {
  return <>{explanationParts(text).map((part, i) => part.french
    ? <Button key={i} type="button" variant="link" lang="fr" className="inline h-auto whitespace-normal p-0 font-serif text-inherit underline" onClick={() => onWord(part.text)}>{part.text}</Button>
    : <span key={i}>{part.text}</span>)}</>;
}
