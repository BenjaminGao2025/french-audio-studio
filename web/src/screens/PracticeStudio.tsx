/* SCR-PRA-05 Audio Studio: turn your own words into natural French, then into audio to listen to. */
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";
import { useState } from "react";
import { Download, Pause, Play, Loader2 } from "lucide-react";
import { type TransformLevel, type TransformStyle, VOICES, makeSpeech, transformToFrench } from "../api/practice";
import { fmtClock } from "../lib/format";
import { announce, go, patchStudy, retryPlayback, set, startPlayback, updatePlayer, useApp } from "../state/store";
import { PageHead, Spinner, Textarea, pageFrame } from "../components/ui";
import { BackTo } from "./Practice";

const STYLES: { value: TransformStyle; label: string }[] = [
  { value: "spoken", label: "Spoken" },
  { value: "neutral", label: "Neutral" },
  { value: "formal", label: "Formal" },
];
const LEVELS: { value: TransformLevel; label: string }[] = [
  { value: "A1-A2", label: "A1–A2" },
  { value: "B1-B2", label: "B1–B2" },
];

function useDraft(key: string, initial = ""): [string, (v: string) => void] {
  const v = useApp((s) => s.drafts[key] ?? initial);
  return [v, (nv: string) => set((s) => ({ drafts: { ...s.drafts, [key]: nv } }))];
}

export function Studio() {
  const [input, setInput] = useDraft("studio");
  const [french, setFrench] = useDraft("studio:french");
  const [voice, setVoice] = useDraft("studio:voice", VOICES[0].id);
  const [style, setStyle] = useState<TransformStyle>("spoken");
  const [level, setLevel] = useState<TransformLevel>("A1-A2");
  const [phase, setPhase] = useState<"idle" | "transforming" | "speaking">("idle");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [audio, setAudio] = useState<{ url: string; text: string } | null>(null);
  const studyDrafts = useApp((s) => s.study.drafts);
  const p = useApp((s) => s.player);
  const mine = p?.owner.kind === "studio" && audio && p.src === audio.url ? p : null;

  const transform = async () => {
    setPhase("transforming");
    setError("");
    try {
      const r = await transformToFrench(input.trim(), style, level, "fr-FR");
      setFrench(r.text);
      setAudio(null);
      setNote(`${r.task_label}${r.quality_check === "proofread" ? " · proofread" : ""}`);
      announce("French text ready.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t write the French text.");
    } finally {
      setPhase("idle");
    }
  };

  const speak = async () => {
    const text = french.trim();
    setPhase("speaking");
    setError("");
    try {
      const r = await makeSpeech(text, voice);
      setAudio({ url: r.audio_url, text });
      startPlayback({ kind: "studio", label: "Audio Studio", route: "practice/studio" }, Math.max(3, text.length / 14), { src: r.audio_url });
      announce("Audio ready. Playing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t make the audio.");
    } finally {
      setPhase("idle");
    }
  };

  const toggle = () => {
    if (!audio) return;
    if (!mine) return startPlayback({ kind: "studio", label: "Audio Studio", route: "practice/studio" }, Math.max(3, audio.text.length / 14), { src: audio.url });
    if (mine.status === "playing") return updatePlayer({ status: "paused" });
    if (mine.status === "error") return retryPlayback();
    updatePlayer({ status: "playing", position: mine.status === "ended" ? 0 : mine.position });
  };

  const stale = !!audio && audio.text !== french.trim();
  return (
    <div className={pageFrame()}>
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Audio Studio"
      />
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <label htmlFor="studio-in" className="text-sm font-medium">What you want to say (Chinese, English or French)</label>
          <Textarea id="studio-in" rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 gap-4" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <ToggleGroup type="single" variant="outline" value={style} onValueChange={(next) => { if (STYLES.some((o) => o.value === next)) setStyle(next as TransformStyle); }} aria-label="Style">{(STYLES).map((o) => (<ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>))}</ToggleGroup>
          <ToggleGroup type="single" variant="outline" value={level} onValueChange={(next) => { if (LEVELS.some((o) => o.value === next)) setLevel(next as TransformLevel); }} aria-label="Level">{(LEVELS).map((o) => (<ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>))}</ToggleGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" aria-disabled={(!!(phase === "transforming") || !!(!input.trim() ? "Write something first." : undefined)) || undefined} aria-busy={phase === "transforming" || undefined} className={cn((!!(phase === "transforming") || !!(!input.trim() ? "Write something first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "transforming") || !!(!input.trim() ? "Write something first." : undefined)) { event.preventDefault(); return; } (() => void transform())(); }}>{phase === "transforming" ? <Loader2 className="animate-spin" aria-hidden /> : null}Make it French{(!input.trim() ? "Write something first." : undefined) ? <span className="sr-only">{!input.trim() ? "Write something first." : undefined}</span> : null}</Button>
          <Button type="button" variant="ghost" aria-disabled={(!!(!input.trim())) || undefined} className={cn((!!(!input.trim())) ? "opacity-50" : "")} onClick={(event) => { if (!!(!input.trim())) { event.preventDefault(); return; } (() => { setFrench(input.trim()); setNote("Your own French, unchanged"); setAudio(null); })(); }}>It’s already French</Button>
        </div>
        {phase === "transforming" && <Spinner label="Writing natural French…" />}

        <div className="grid gap-2">
          <label htmlFor="studio-fr" className="text-sm font-medium">French text for the audio</label>
          <Textarea id="studio-fr" lang="fr" rows={5} value={french} onChange={(e) => setFrench(e.target.value)} />
          {note && <p className="text-sm text-muted-foreground">{note} · AI-written French can contain mistakes</p>}
        </div>
        <label className="grid gap-2" style={{ maxWidth: 320 }}>
          <span className="text-sm font-medium">Voice</span>
          <Select value={voice} onValueChange={(v) => { setVoice(v); setAudio(null); }}><SelectTrigger aria-label={"Voice"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(VOICES.map((v) => ({ value: v.id, label: v.label }))).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
        </label>

        {error && <Alert variant="destructive" role="alert"><AlertTitle>That didn’t work</AlertTitle><AlertDescription>{error} Your text is kept.</AlertDescription></Alert>}
        {phase === "speaking" && <Spinner label="Making the audio…" />}

        <div className="flex flex-wrap items-center gap-2">
          {audio && !stale ? (
            <>
              <Button type="button" variant="default" aria-disabled={(!!(mine?.status === "loading")) || undefined} aria-busy={mine?.status === "loading" || undefined} className={cn((!!(mine?.status === "loading")) ? "opacity-50" : "")} onClick={(event) => { if (!!(mine?.status === "loading")) { event.preventDefault(); return; } (toggle)(); }}>{mine?.status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : (mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />)}{mine?.status === "playing" ? "Pause" : mine?.status === "ended" ? "Play again" : "Play"}</Button>
              {mine && <span className="text-sm text-muted-foreground tabular-nums">{fmtClock(mine.position)} / {fmtClock(mine.duration)}</span>}
              <Button variant="ghost" asChild>
                <a href={`${audio.url}?download=true`} download>
                  <Download aria-hidden /> Download MP3
                </a>
              </Button>
            </>
          ) : (
            <Button type="button" variant="default" aria-disabled={(!!(phase === "speaking") || !!(!french.trim() ? "Add the French text first." : undefined)) || undefined} aria-busy={phase === "speaking" || undefined} className={cn((!!(phase === "speaking") || !!(!french.trim() ? "Add the French text first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "speaking") || !!(!french.trim() ? "Add the French text first." : undefined)) { event.preventDefault(); return; } (() => void speak())(); }}>{phase === "speaking" ? <Loader2 className="animate-spin" aria-hidden /> : null}{stale ? "Make audio again" : "Make audio"}{(!french.trim() ? "Add the French text first." : undefined) ? <span className="sr-only">{!french.trim() ? "Add the French text first." : undefined}</span> : null}</Button>
          )}
          {french.trim() && (
            <Button type="button" variant="ghost" onClick={() => { patchStudy({ drafts: { ...studyDrafts, text: french.trim() } }); go("study/new"); }}>Study this text</Button>
          )}
        </div>
        {mine?.status === "error" && <Alert variant="destructive"><AlertTitle>Couldn’t play</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={retryPlayback}>Retry</Button></div></AlertDescription></Alert>}
      </div>
    </div>
  );
}
