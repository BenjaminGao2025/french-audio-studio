/* SCR-PRA-05 Audio Studio: turn your own words into natural French, then into audio to listen to. */
import { useState } from "react";
import { Download, Pause, Play, Wand2 } from "lucide-react";
import { type TransformLevel, type TransformStyle, VOICES, makeSpeech, transformToFrench } from "../api/practice";
import { fmtClock } from "../lib/format";
import { announce, go, patchStudy, retryPlayback, set, startPlayback, updatePlayer, useApp } from "../state/store";
import { Banner, Button, PageHead, Pill, Segmented, Spinner } from "../components/ui";
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
    <div className="page">
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Audio Studio"
        desc="Write what you want to say in any language, get natural French, and turn it into audio you can listen to and study."
      />
      <div className="stack gap-5">
        <div className="field">
          <label htmlFor="studio-in" className="field-label">What you want to say (Chinese, English or French)</label>
          <textarea id="studio-in" className="textarea" rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="row gap-4" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Segmented label="Style" value={style} onChange={setStyle} options={STYLES} />
          <Segmented label="Level" value={level} onChange={setLevel} options={LEVELS} />
        </div>
        <div className="btn-row">
          <Button kind="secondary" icon={<Wand2 aria-hidden />} busy={phase === "transforming"} disabledReason={!input.trim() ? "Write something first." : undefined} onClick={() => void transform()}>
            Make it French
          </Button>
          <Button kind="tertiary" disabled={!input.trim()} onClick={() => { setFrench(input.trim()); setNote("Your own French, unchanged"); setAudio(null); }}>
            It’s already French
          </Button>
        </div>
        {phase === "transforming" && <Spinner label="Writing natural French…" />}

        <div className="field">
          <label htmlFor="studio-fr" className="field-label">French text for the audio</label>
          <textarea id="studio-fr" className="textarea" lang="fr" rows={5} value={french} onChange={(e) => setFrench(e.target.value)} />
          {note && <p className="field-help">{note} · AI-written French can contain mistakes</p>}
        </div>
        <label className="field" style={{ maxWidth: 320 }}>
          <span className="field-label">Voice</span>
          <select className="select" value={voice} onChange={(e) => { setVoice(e.target.value); setAudio(null); }}>
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>

        {error && <Banner tone="error" title="That didn’t work" live="assertive">{error} Your text is kept.</Banner>}
        {phase === "speaking" && <Spinner label="Making the audio…" />}

        <div className="btn-row">
          {audio && !stale ? (
            <>
              <Button kind="primary" icon={mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />} busy={mine?.status === "loading"} onClick={toggle}>
                {mine?.status === "playing" ? "Pause" : mine?.status === "ended" ? "Play again" : "Play"}
              </Button>
              {mine && <span className="t-support num">{fmtClock(mine.position)} / {fmtClock(mine.duration)}</span>}
              <a className="btn btn--tertiary" href={`${audio.url}?download=true`} download>
                <Download aria-hidden /> Download MP3
              </a>
            </>
          ) : (
            <Button kind="primary" busy={phase === "speaking"} disabledReason={!french.trim() ? "Add the French text first." : undefined} onClick={() => void speak()}>
              {stale ? "Make audio again" : "Make audio"}
            </Button>
          )}
          {french.trim() && (
            <Button kind="tertiary" onClick={() => { patchStudy({ drafts: { ...studyDrafts, text: french.trim() } }); go("study/new"); }}>
              Study this text
            </Button>
          )}
        </div>
        {mine?.status === "error" && <Banner tone="error" title="Couldn’t play" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>} />}
        <p className="row gap-2"><Pill>Listening time counts</Pill><span className="t-support">Time spent playing this audio counts toward your listening hours.</span></p>
      </div>
    </div>
  );
}
