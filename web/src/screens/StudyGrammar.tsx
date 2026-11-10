import { useEffect, useState } from "react";
import { getGrammarMap, getGrammarSentences, type GrammarBlock } from "../api/learning";
import { listStudyRecords } from "../api/history";
import { openAnalysisInStudy } from "../state/study";
import { get, go, patchStudy, sayFrench, useApp } from "../state/store";
import { Banner, Button, PageHead, Spinner } from "../components/ui";
import "./study-tools.css";

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
  return <div className="page"><PageHead title="My grammar map" desc="Patterns you have met in your own French sentences. Pick a point to revisit its examples." back={<Button kind="tertiary" onClick={() => go("study")}>Back to Study</Button>} />
    <div className="stack gap-5">
      {loading && <Spinner label="Loading grammar map…" />}
      {error && <Banner tone="error" title="Couldn’t load grammar" actions={<Button kind="secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}>{error}</Banner>}
      {!loading && <p className="t-support">{seen} grammar points encountered. Counts show saved sentence encounters, not mastery.</p>}
      {!!pointId && <section className="panel stack gap-3" aria-labelledby="grammar-point-detail"><h2 id="grammar-point-detail" tabIndex={-1} className="t-section">{point?.en ?? pointId}</h2>{point && <p className="t-support"><span lang="fr">{point.fr}</span> · {point.level}</p>}
        {pending ? <Spinner label="Finding your sentences…" /> : examples.length ? <ul className="list">{examples.map((s, i) => <li key={i} className="study-tip stack gap-2"><p lang="fr">{s.sentence}</p>{s.translation_en && <p>{s.translation_en}</p>}<div className="btn-row"><Button kind="secondary" onClick={() => sayFrench(s.sentence)}>Listen</Button><Button kind="tertiary" disabled={opening} onClick={() => void study(s)}>Study this sentence</Button></div></li>)}</ul> : !error && <p>No saved examples yet. Analyse French text to grow your map.</p>}
      </section>}
      {blocks.map((block) => <section key={block.id} className="panel stack gap-3"><h2 className={`study-note structure-${block.id}`}>{block.en}</h2><div className="grammar-points">{block.points.map((p) => <Button key={p.id} kind={p.id === pointId ? "primary" : "secondary"} aria-pressed={p.id === pointId} onClick={() => go(`study/grammar?point=${encodeURIComponent(p.id)}`)}>{p.en} · {p.count}{p.focus ? " · Core pattern" : ""}</Button>)}</div></section>)}
    </div>
  </div>;
}
