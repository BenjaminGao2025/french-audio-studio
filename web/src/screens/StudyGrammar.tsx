import { useEffect, useState } from "react";
import { getGrammarMap, getGrammarSentences, type GrammarBlock } from "../api/learning";
import { listStudyRecords } from "../api/history";
import { openAnalysisInStudy } from "../state/study";
import { get, go, patchStudy, sayFrench, useApp } from "../state/store";
import { Crumbs, PageHead, Spinner, pageFrame } from "../components/ui";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { cn } from "cn";

type Example = Awaited<ReturnType<typeof getGrammarSentences>>["sentences"][number];
export function StudyGrammar() {
  const route = useApp((s) => s.route);
  const pointId = new URLSearchParams(route.split("?")[1]).get("point") ?? "";
  const [blocks, setBlocks] = useState<GrammarBlock[]>([]);
  const [seen, setSeen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examples, setExamples] = useState<Example[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const point = blocks.flatMap((b) => b.points).find((p) => p.id === pointId);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    getGrammarMap().then((r) => { if (active) { setBlocks(r.blocks); setSeen(r.seen); } })
      .catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    let active = true; setExamples([]); setError("");
    if (!pointId) { setPending(false); return; }
    setPending(true);
    getGrammarSentences(pointId).then((r) => { if (active) setExamples(r.sentences); })
      .catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [pointId, attempt]);
  useEffect(() => { if (point) document.getElementById("grammar-point-detail")?.focus(); }, [point]);
  const study = async (example: Example) => {
    setOpening(true); setError("");
    try {
      const records = await listStudyRecords();
      const record = records.find((r) => r.id === example.history_id && r.sentences?.some((s) => s.sentence === example.sentence));
      if (record) {
        openAnalysisInStudy(record);
        patchStudy({ index: record.sentences!.findIndex((s) => s.sentence === example.sentence), tab: "grammar" });
      } else {
        patchStudy({ mode: "text", drafts: { ...get().study.drafts, text: example.sentence } });
        go("study/new");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn’t open this sentence."); }
    finally { setOpening(false); }
  };
  return <div className={pageFrame()}><PageHead title="My grammar map" back={<Crumbs items={[{ label: "Study", onClick: () => go("study") }, { label: "My grammar map" }]} />} />
    <div className="flex flex-col gap-6">
      {loading && <Spinner label="Loading grammar map…" />}
      {error && <Alert variant="destructive"><AlertTitle>Couldn’t load grammar</AlertTitle><AlertDescription>{error}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Retry</Button></div></AlertDescription></Alert>}
      {!loading && <p className="text-sm text-muted-foreground">{seen} grammar points encountered</p>}
      {!!pointId && <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-labelledby="grammar-point-detail"><h2 id="grammar-point-detail" tabIndex={-1} className="text-lg font-semibold text-balance">{point?.en ?? pointId}</h2>{point && <p className="text-sm text-muted-foreground"><span lang="fr">{point.fr}</span> · {point.level}</p>}
        {pending ? <Spinner label="Finding your sentences…" /> : examples.length ? <ul className="divide-y overflow-hidden rounded-lg border">{examples.map((s, i) => <li key={i} className="flex flex-col gap-2 border-b p-4 last:border-b-0 flex flex-col gap-2"><p lang="fr">{s.sentence}</p>{s.translation_en && <p>{s.translation_en}</p>}<div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => sayFrench(s.sentence)}>Listen</Button><Button type="button" variant="ghost" aria-disabled={(!!(opening)) || undefined} className={cn((!!(opening)) ? "opacity-50" : "")} onClick={(event) => { if (!!(opening)) { event.preventDefault(); return; } (() => void study(s))(); }}>Study this sentence</Button></div></li>)}</ul> : !error && <p className="text-sm font-medium">No saved examples yet</p>}
      </section>}
      {blocks.map((block) => <section key={block.id} className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><h2 className={`rounded-md border-l-2 border-primary bg-muted px-3 py-2 structure-${block.id}`}>{block.en}</h2><div className="grid gap-2 sm:grid-cols-2">{block.points.map((p) => <Button type="button" variant={p.id === pointId ? "default" : "outline"} key={p.id} aria-pressed={p.id === pointId} onClick={() => go(`study/grammar?point=${encodeURIComponent(p.id)}`)}>{p.en} · {p.count}{p.focus ? " · Core pattern" : ""}</Button>)}</div></section>)}
    </div>
  </div>;
}
