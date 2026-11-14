import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import type { WordConjugation } from "../api/lookup";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui";
import { sayFrench } from "../state/store";

type Tense = WordConjugation["tenses"][number];
const PERSON = ["", "je", "tu", "il", "nous", "vous", "ils"];

/** Présent plus the tense of the tapped form open; every other tense one tap away. No AI. */
export function ConjugationTable({ conjugation: c, word }: { conjugation: WordConjugation; word: string }) {
  const byKey = new Map(c.tenses.map(t => [t.key, t]));
  const open = ["present", c.focus && c.focus !== "present" && byKey.has(c.focus) ? c.focus : "passe_compose"];
  const first = open.map(k => byKey.get(k)).filter((t): t is Tense => Boolean(t));
  const rest = c.tenses.filter(t => !first.includes(t));
  const focus = byKey.get(c.focus);
  const persons = focus?.cells.filter(x => x.current).map(x => PERSON[x.person]) ?? [];
  const what = focus ? [focus.label, persons.join(" / ")].filter(Boolean).join(" · ") : c.role;
  // Other readings of the same spelling: laisse is also a subjunctive and an imperative.
  const also = c.tenses.filter(t => t !== focus && t.cells.some(x => x.current)).map(t => t.label);
  // Forms that sound like the tapped one: laisse, laisses, laissent are all /lɛs/.
  const sound = focus?.cells.find(x => x.current)?.ipa;
  const same = sound ? [...new Set(focus!.cells.filter(x => x.ipa === sound).map(x => x.form))] : [];
  return <div className="flex flex-col gap-3">
    <p className="text-sm text-muted-foreground">
      <span lang="fr" className="font-serif text-foreground">{word}</span> → <span lang="fr" className="font-serif text-foreground">{c.lemma}</span>
      {what && <> · {what}</>}
    </p>
    <TenseGrid tenses={first} />
    {(also.length > 0 || same.length > 1 || c.aux !== "avoir") && <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {same.length > 1 && <li>Sound the same: <span lang="fr" className="font-serif text-sm text-foreground">{same.join(" · ")}</span></li>}
      {also.length > 0 && <li>Same spelling in: {also.join(", ")}</li>}
      {c.aux === "être" && <li>Compound tenses use <span lang="fr" className="font-serif text-sm text-foreground">être</span>; the participle agrees with the subject.</li>}
      {c.aux === "both" && c.also && <li>Without an object, it takes <span lang="fr" className="font-serif text-sm text-foreground">être</span>: <span lang="fr" className="font-serif text-sm text-foreground">{c.also}</span></li>}
    </ul>}
    {rest.length > 0 && <Collapsible>
      <CollapsibleTrigger className="group flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        All tenses<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1"><TenseGrid tenses={rest} /></CollapsibleContent>
    </Collapsible>}
    <p className="text-xs text-muted-foreground">
      Tap any form to hear it.
      {c.source_url && <> Source: <a href={c.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Wiktionary</a> (CC BY-SA 4.0)</>}
    </p>
  </div>;
}

function TenseGrid({ tenses }: { tenses: Tense[] }) {
  return <div className="grid gap-x-3 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
    {tenses.map(t => <div key={t.key} role="group" aria-label={t.label} className="flex min-w-0 flex-col">
      <h4 className="border-b pb-1 text-xs font-normal text-muted-foreground">
        <span lang="fr">{t.label}</span>{t.written && <span> · written</span>}
      </h4>
      <ul className="flex flex-col">
        {t.cells.map(x => <li key={x.person}>
          <Button type="button" variant="ghost" lang="fr" title="Hear it" aria-current={x.current || undefined}
            className="h-auto min-h-9 w-full justify-start whitespace-normal px-1 py-1 text-left font-serif text-base font-normal"
            onClick={() => sayFrench(x.say)}>
            <span className={cn("rounded-md px-1.5 py-0.5", x.current && "bg-accent font-semibold text-accent-foreground")}>
              {x.pronoun && <span className={cn(!x.current && "text-muted-foreground")}>{x.pronoun}{x.pronoun.endsWith("'") ? "" : " "}</span>}{x.form}
            </span>
            {x.current && <span className="sr-only">(in this sentence)</span>}
          </Button>
        </li>)}
      </ul>
    </div>)}
  </div>;
}
