import { useEffect, useState } from "react";
import { cardKey, loadSavedCards, toggleSentenceReview, useSavedCards } from "../api/srs";
import { announce } from "../state/store";
import { Button } from "./ui/button";

export function StepReview({ sentence, english }: { sentence: string; english: string }) {
  const added = useSavedCards(sentence).has(cardKey("listen"));
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadSavedCards([sentence]).catch(() => undefined); }, [sentence]);
  return <Button type="button" variant="outline" size="sm" aria-pressed={added} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={async () => {
    if (busy) return;
    setBusy(true);
    try { await toggleSentenceReview(sentence, english); }
    catch { announce("Couldn’t update review.", true); }
    finally { setBusy(false); }
  }}>{added ? "In review" : "Review"}</Button>;
}
