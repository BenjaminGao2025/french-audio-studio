import { Button } from "./ui/button";
import { sayFrench } from "../state/store";
import { formatFriendlyPhonetic } from "../lib/phonetic";

export function Phonetic({ word, ipa, className = "" }: { word: string; ipa: string; className?: string }) {
  const text = formatFriendlyPhonetic(ipa);
  if (!text) return null;
  return <Button type="button" variant="ghost" className={`h-auto cursor-pointer whitespace-normal px-1 py-0 text-sm font-normal text-muted-foreground hover:text-foreground ${className}`} aria-label={`Pronounce “${word}”`} onClick={e => { e.stopPropagation(); sayFrench(word); }}>{text}</Button>;
}
