import { useState } from "react";
import { Star } from "lucide-react";
import type { StudySentence } from "../data/fixtures";
import type { ApiWord } from "../api/study";
import { toggleWordDeck } from "../api/wordDeck";
import { lookupKey } from "../lib/lookup";
import { announce, useApp } from "../state/store";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export function WordDeckStar({ word, sentence, details }: { word: string; sentence: StudySentence; details?: Partial<ApiWord> }) {
  const member = useApp(s => s.cards.some(c => (c.mode === "cloze" || (!c.mode && c.kind === "Fill-in")) && lookupKey(c.word ?? "") === lookupKey(word)));
  const [pending, setPending] = useState<boolean | null>(null);
  const saved = pending ?? member;
  const label = saved ? "Saved" : "Save word";
  const toggle = async () => {
    setPending(!saved);
    try { await toggleWordDeck(word, sentence, details); }
    catch { announce("Couldn’t update your word deck. Please try again.", true); }
    finally { setPending(null); }
  };
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-pressed={saved} aria-label={label} disabled={pending !== null} onClick={() => void toggle()}><Star aria-hidden className={saved ? "fill-current" : undefined} /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>;
}
