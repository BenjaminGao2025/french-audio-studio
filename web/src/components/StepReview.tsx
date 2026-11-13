import { useEffect, useState } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { cardKey, loadSavedCards, toggleSentenceReview, useSavedCards } from "../api/srs";
import { announce } from "../state/store";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** `compact` renders a ghost icon button for repeated step rows; it needs a TooltipProvider above it. */
export function StepReview({ sentence, english, compact = false }: { sentence: string; english: string; compact?: boolean }) {
  const added = useSavedCards(sentence).has(cardKey("listen"));
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadSavedCards([sentence]).catch(() => undefined); }, [sentence]);
  const label = added ? "In review" : "Review";
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try { await toggleSentenceReview(sentence, english); }
    catch { announce("Couldn’t update review.", true); }
    finally { setBusy(false); }
  };
  if (compact) {
    return <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={label} aria-pressed={added} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick}>{added ? <BookmarkCheck aria-hidden /> : <BookmarkPlus aria-hidden />}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>;
  }
  return <Button type="button" variant="outline" size="sm" aria-pressed={added} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick}>{label}</Button>;
}
