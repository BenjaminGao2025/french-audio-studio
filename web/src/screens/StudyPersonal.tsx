import { useEffect, useRef, useState } from "react";
import { createJournal, downloadJournal, finishJournal, getJournal, listJournals, prepareJournal, saveRecording, type JournalEntry } from "../api/learning";
import { fmtWhen } from "../api/history";
import { StudySpeakingTimer } from "../components/StudySpeakingTimer";
import { PrivateAudio } from "../components/PrivateAudio";
import { StudyRecorder } from "../components/StudyRecorder";
import { Badge, Checkbox, Crumbs, PageHead, Separator, Spinner, Textarea, pageFrame } from "../components/ui";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { get, go, patchStudy, stopPlayback } from "../state/store";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { cn } from "cn";

// Session-only drafts survive a visit to sentence study without persisting private text in storage.
let draft = "";
let lastEntryId = "";
const reflections = new Map<string, { text: string; recalled: boolean }>();
export function StudyPersonal() {
  const [native, setNative] = useState(draft);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [busy, setBusy] = useState("Loading practice archive…");
  const [error, setError] = useState("");
  const [part, setPart] = useState(-1);
  const [pendingTakes, setPendingTakes] = useState<Record<string, boolean>>({});
  const [audioVersion, setAudioVersion] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [reflection, setReflection] = useState("");
  const [recalled, setRecalled] = useState(false);
  const mounted = useRef(true);
  const accept = (next: JournalEntry) => {
    if (!mounted.current) return;
    setEntry(next); lastEntryId = next.id;
    setEntries((old) => [next, ...old.filter((e) => e.id !== next.id)]);
  };
  const select = (next: JournalEntry) => {
    accept(next); setPart(-1); setHidden(false);
    const local = reflections.get(next.id);
    setReflection(local?.text ?? next.reflection); setRecalled(local?.recalled ?? !!next.recalled);
  };
  const request = async (message: string, action: () => Promise<void>) => {
    setBusy(message); setError("");
    try { await action(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Please try again."); }
    finally { if (mounted.current) setBusy(""); }
  };
  useEffect(() => {
    mounted.current = true;
    void request("Loading practice archive…", async () => {
      const data = await listJournals();
      if (!mounted.current) return;
      setEntries(data.entries);
      const previous = data.entries.find((e) => e.id === lastEntryId);
      if (previous) select(previous);
    });
    return () => { mounted.current = false; };
  }, []);
  const trackTake = (key: string, pending: boolean) => setPendingTakes((old) => old[key] === pending ? old : { ...old, [key]: pending });
  const unsaved = !!entry && (pendingTakes[`${entry.id}:first`] || pendingTakes[`${entry.id}:final`]);
  const first = entry?.recordings.find((r) => r.kind === "first");
  const finals = entry?.recordings.filter((r) => r.kind === "final") ?? [];
  const selected = part >= 0 ? entry?.parts[part] : null;
  const text = selected?.french ?? entry?.french ?? "";
  const stage = !entry?.french ? 0 : !first ? 1 : !finals.length ? 2 : !entry.complete ? 3 : 4;
  const remember = (text: string, checked: boolean) => {
    setReflection(text); setRecalled(checked);
    if (entry) reflections.set(entry.id, { text, recalled: checked });
  };
  const stages = ["Prepare", "First attempt", "Practise & recall", "Reflect", "Archived"];
  return <div className={pageFrame("personal-practice")}><PageHead title="Practise my own words" back={<Crumbs items={[{ label: "Study", onClick: () => go("study/new") }, { label: "Practise my own words" }]} />} />
    <div className="flex min-w-0 flex-col gap-6">
      <div className="min-w-0 overflow-x-auto">
        <ol className="flex w-max min-w-full list-none flex-nowrap items-center gap-2 p-0" aria-label="Practice stages">{stages.map((label, i) => <li key={label} className="flex items-center gap-2" aria-current={stage === i ? "step" : undefined} aria-label={label}><Badge variant={stage === i ? "default" : "outline"}>{i + 1}</Badge><span className={cn("text-sm whitespace-nowrap", i !== stage && "max-sm:sr-only")}>{label}</span>{i < stages.length - 1 && <Separator className="mx-1 hidden h-px w-6 sm:block" />}</li>)}</ol>
      </div>
      {busy && <Spinner label={busy} />}
      {error && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t finish</AlertTitle><AlertDescription>{error} Your saved work is kept.</AlertDescription></Alert>}
      {!entry ? <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><label htmlFor="personal-native" className="text-sm font-medium">What I want to say</label>
        <Textarea id="personal-native" rows={7} maxLength={2000} value={native} disabled={!!busy} onChange={(e) => { draft = e.target.value; setNative(draft); }} />
        <p className="text-xs leading-4 text-muted-foreground">{native.length} / 2,000</p><Button type="button" variant="default" aria-disabled={(!!(!!busy || native.trim().length < 5)) || undefined} className={cn((!!(!!busy || native.trim().length < 5)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy || native.trim().length < 5)) { event.preventDefault(); return; } (() => void request("Preparing your French and model reading…", async () => {
          const created = await createJournal(native.trim()); select(created);
          const prepared = await prepareJournal(created.id); accept(prepared);
        }))(); }}>Prepare French and audio</Button>
      </section> : <>
        <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-balance">My own ideas</h2><Button type="button" variant="outline" aria-disabled={(!!(!!busy || unsaved)) || undefined} className={cn((!!(!!busy || unsaved)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy || unsaved)) { event.preventDefault(); return; } (() => { stopPlayback(); setEntry(null); lastEntryId = ""; setNative(""); draft = ""; setError(""); })(); }}>New entry</Button></div><p className="whitespace-pre-wrap wrap-break-word">{entry.native_text}</p><p className="text-xs leading-4 text-muted-foreground">{fmtWhen(entry.created_at)} · {entry.complete ? "Archived" : "In progress"} · {Math.floor(entry.practice_seconds / 60)}m {entry.practice_seconds % 60}s saved speaking activity</p></section>
        <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3"><h2 className="text-lg font-semibold text-balance">Listen, then speak</h2>
          <div className="flex flex-wrap gap-1.5" aria-label="Practice parts"><Button type="button" variant={part === -1 ? "default" : "outline"} aria-pressed={part === -1} onClick={() => setPart(-1)}>Whole text</Button>{entry.parts.map((_, i) => <Button type="button" variant={part === i ? "default" : "outline"} key={i} aria-pressed={part === i} onClick={() => setPart(i)}>Part {i + 1}</Button>)}</div>
          {selected && <p className="whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">{selected.source}</p>}
          {text && <>{hidden ? <p className="rounded-md border-l-2 border-primary bg-muted px-3 py-2">French text hidden. Try saying it from memory.</p> : <p className="whitespace-pre-wrap wrap-break-word text-lg font-semibold text-balance" lang="fr">{text}</p>}<div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? "Show French text" : "Hide French text"}</Button><Button type="button" variant="ghost" aria-disabled={(!!(!!busy)) || undefined} className={cn((!!(!!busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy)) { event.preventDefault(); return; } (() => { stopPlayback(); patchStudy({ mode: "text", drafts: { ...get().study.drafts, text } }); go("study/new"); })(); }}>Study this {part < 0 ? "text" : "part"} sentence by sentence</Button></div></>}
          {entry.reference_url && <PrivateAudio key={`${entry.id}:${part}:${audioVersion}` } path={`${entry.reference_url}${part >= 0 ? `?part=${part}` : ""}`} label={part < 0 ? "Whole-text model reading" : `Model reading · part ${part + 1}`} />}
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" aria-disabled={(!!(!!busy)) || undefined} className={cn((!!(!!busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy)) { event.preventDefault(); return; } (() => void request("Preparing model reading…", async () => { accept(await prepareJournal(entry.id, false, !!entry.reference_url)); setAudioVersion((n) => n + 1); }))(); }}>{entry.reference_url ? "Regenerate model reading" : "Continue preparing French and audio"}</Button>
            {entry.can_expand && <Button type="button" variant="outline" aria-disabled={(!!(!!busy)) || undefined} className={cn((!!(!!busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy)) { event.preventDefault(); return; } (() => void request("Preparing all your ideas in parts…", async () => { accept(await prepareJournal(entry.id, true)); setPart(-1); }))(); }}>Expand and segment all my ideas</Button>}
          </div>{entry.french && !entry.complete && <StudySpeakingTimer key={entry.id} journalId={entry.id} disabled={!!busy} />}
        </section>
        {entry.french && <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-4"><h2 className="text-lg font-semibold text-balance">Keep your progress</h2><p className="text-sm text-muted-foreground">1–180 seconds.</p>
          <div className="grid gap-4 sm:grid-cols-2"><section className="flex flex-col gap-3"><h3 className="font-medium">First attempt</h3>{first ? <PrivateAudio key={first.id} path={first.url} label="Saved first attempt" /> : <StudyRecorder key={`${entry.id}:first`} id={`personal:${entry.id}:first`} label="Record first attempt" autoSubmit={false} actionLabel="Save first attempt" onPendingChange={(pending) => trackTake(`${entry.id}:first`, pending)} disabled={!!busy} onTake={async (blob) => accept(await saveRecording(entry.id, "first", blob))} />}</section>
            <section className="flex flex-col gap-3"><h3 className="font-medium">Final attempt</h3>{!first && <p className="text-sm text-muted-foreground">Save your first attempt before recording the final one.</p>}{!entry.complete && <StudyRecorder key={`${entry.id}:final`} id={`personal:${entry.id}:final`} label="Record final attempt" autoSubmit={false} actionLabel="Save final attempt" onPendingChange={(pending) => trackTake(`${entry.id}:final`, pending)} disabled={!!busy || !first} onTake={async (blob) => accept(await saveRecording(entry.id, "final", blob))} />}{finals.map((r, i) => <PrivateAudio key={r.id} path={r.url} label={`Saved final attempt ${i + 1}`} />)}</section>
          </div>
          <label htmlFor="personal-reflection" className="text-sm font-medium">Reflection</label><Textarea id="personal-reflection" rows={3} maxLength={3000} value={reflection} disabled={!!busy} onChange={(e) => remember(e.target.value, recalled)} placeholder="What was hard? What can you say now?" />
          <label className="flex items-center gap-3"><Checkbox checked={recalled} disabled={!!busy} onCheckedChange={(v) => remember(reflection, v === true)} /> I tried speaking without the text and changing one detail.</label>
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="default" aria-disabled={(!!(!!busy || unsaved || !first || !finals.length || reflection.trim().length < 3)) || undefined} className={cn((!!(!!busy || unsaved || !first || !finals.length || reflection.trim().length < 3)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy || unsaved || !first || !finals.length || reflection.trim().length < 3)) { event.preventDefault(); return; } (() => void request("Saving your reflection and archive…", async () => accept(await finishJournal(entry.id, reflection.trim(), recalled))))(); }}>{entry.complete ? "Update reflection" : "Finish and archive"}</Button><Button type="button" variant="outline" aria-disabled={(!!(!!busy)) || undefined} className={cn((!!(!!busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy)) { event.preventDefault(); return; } (() => void request("Preparing download…", () => downloadJournal(entry.id)))(); }}>Download archive</Button></div>
          {unsaved && <p className="text-sm text-muted-foreground">Stop and save your recording before finishing or opening another entry.</p>}
          {entry.complete && <Alert variant="default"><AlertTitle>Practice archived</AlertTitle><AlertDescription>Your source, French text, recordings and reflection are saved.</AlertDescription></Alert>}
        </section>}
      </>}
      <Card>
        <CardHeader>
          <CardTitle>My practice archive</CardTitle>
          <CardAction className="self-center">
            <Button type="button" variant="outline" size="sm" aria-disabled={(!!(!!busy)) || undefined} className={cn((!!(!!busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!!busy)) { event.preventDefault(); return; } (() => void request("Refreshing archive…", async () => { const r = await listJournals(); if (mounted.current) setEntries(r.entries); }))(); }}>Refresh</Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
        {!entries.length && !busy && <p className="text-sm text-muted-foreground">No practice entries yet.</p>}
        {entries.length > 0 && <ul className="divide-y overflow-hidden rounded-lg border">{entries.map((e) => <li key={e.id}><Button type="button" variant="ghost" aria-disabled={(!!(!!busy || unsaved)) || undefined} className={cn((!!(!!busy)) || unsaved ? "opacity-50" : "", "h-auto w-full justify-start whitespace-normal px-4 py-3 text-left")} onClick={(event) => { if (!!(!!busy || unsaved)) { event.preventDefault(); return; } (() => void request("Opening saved practice…", async () => select(await getJournal(e.id))))(); }}><span className="flex flex-col gap-1 font-normal"><span>{e.native_text.slice(0, 100)}{e.native_text.length > 100 ? "…" : ""}</span><span className="text-xs leading-4 text-muted-foreground">{fmtWhen(e.created_at)} · {e.complete ? "Archived" : "In progress"}</span></span></Button></li>)}</ul>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
