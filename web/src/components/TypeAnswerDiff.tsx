import { ArrowDown, Check } from "lucide-react";
import { typeDiff } from "../lib/typeDiff";
import { sayFrench } from "../state/store";
import { Button } from "./ui/button";

export function TypeAnswerDiff({ typed, correct }: { typed: string; correct: string }) {
  const columns = typeDiff(typed, correct);
  const equal = columns.every(c => c.match);
  if (equal && typed.normalize("NFC") === correct.normalize("NFC")) return <Button variant="ghost" className="h-auto justify-start whitespace-pre-wrap break-all px-0 font-mono text-success" aria-label="Correct answer" onClick={() => sayFrench(correct)}><Check aria-hidden />{correct.normalize("NFC")}</Button>;
  return <div className="max-w-full overflow-x-auto" aria-label="Answer comparison">
    <div className="w-max min-w-full font-mono text-base leading-relaxed" lang="fr">
      <div aria-label="Your answer" className="whitespace-pre">{columns.map((c, i) => <span key={i} className={!c.typed ? "text-muted-foreground" : c.match ? "text-success" : `text-destructive${!c.correct ? " line-through" : ""}`}>{c.typed || "-"}</span>)}</div>
      <ArrowDown className="my-1 size-4 text-muted-foreground" aria-hidden />
      <Button variant="ghost" aria-label="Correct answer" className="h-auto justify-start gap-0 whitespace-pre px-0 py-0 font-mono text-base font-normal" onClick={() => sayFrench(correct)}>{columns.map((c, i) => <span key={i} className={!c.correct ? "text-muted-foreground" : c.match ? "text-success" : "bg-muted text-foreground underline decoration-2 underline-offset-4"}>{c.correct || "\u00a0"}</span>)}</Button>
    </div>
  </div>;
}
