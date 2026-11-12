import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, X } from "lucide-react";
import { transcribeTake } from "../api/learning";
import { EXCLUSIVE_AUDIO, recordingMime, takeAudioFocus } from "./StudyRecorder";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

/** Compact capture for Ask AI. Transcription is reviewed in the input, never sent automatically. */
export function QuestionMic({ sentence, onText, disabled }: { sentence: string; onText: (text: string) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<"idle" | "asking" | "recording" | "transcribing">("idle");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const callback = useRef(onText); callback.current = onText;
  const release = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  useEffect(() => {
    mounted.current = true;
    const interrupt = () => { generation.current++; stop(); };
    window.addEventListener(EXCLUSIVE_AUDIO, interrupt);
    return () => {
      mounted.current = false; generation.current++;
      abort.current?.abort(); stop(); release();
      window.removeEventListener(EXCLUSIVE_AUDIO, interrupt);
    };
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setTimeout(stop, 180_000);
    return () => clearTimeout(timer);
  }, [phase]);
  const start = async () => {
    takeAudioFocus();
    const request = ++generation.current;
    setError(""); setPhase("asking");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || request !== generation.current) {
        media.getTracks().forEach(t => t.stop());
        if (mounted.current) setPhase("idle");
        return;
      }
      stream.current = media;
      const mimeType = recordingMime();
      const r = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = r;
      const chunks: Blob[] = [];
      let failed = false;
      r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      r.onerror = () => {
        failed = true; release();
        if (mounted.current) { setPhase("idle"); setError("Recording stopped unexpectedly. Please try again."); }
      };
      r.onstop = async () => {
        release();
        if (!mounted.current || failed) return;
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        if (!blob.size) { setPhase("idle"); setError("No audio was recorded. Please try again."); return; }
        const ctl = new AbortController(); abort.current = ctl;
        setPhase("transcribing");
        try {
          const text = await transcribeTake(blob, "zh", sentence, ctl.signal);
          if (mounted.current && !ctl.signal.aborted) callback.current(text);
        } catch (e) {
          if (mounted.current && !ctl.signal.aborted) setError(e instanceof Error ? e.message : "Couldn’t transcribe. Please record again.");
        } finally {
          if (mounted.current && !ctl.signal.aborted) setPhase("idle");
        }
      };
      r.start(); setPhase("recording");
    } catch (e) {
      release();
      if (!mounted.current) return;
      setPhase("idle");
      setError(e instanceof DOMException && e.name === "NotAllowedError"
        ? "Allow microphone access in your browser’s site settings, then try again."
        : "Couldn’t start the microphone. Please try again.");
    }
  };
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return <>
    <Button type="button" size="icon" variant={phase === "recording" ? "default" : "ghost"} className="shrink-0"
      aria-label={phase === "recording" ? "Stop recording" : phase === "transcribing" ? "Transcribing question" : "Record question"}
      aria-pressed={phase === "recording"} aria-busy={phase === "asking" || phase === "transcribing"}
      disabled={disabled || phase === "asking" || phase === "transcribing"}
      onClick={() => { if (phase === "recording") stop(); else void start(); }}>
      {phase === "recording" ? <MicOff aria-hidden /> : phase === "asking" || phase === "transcribing" ? <Loader2 className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
    </Button>
    {phase === "recording" && <span className="sr-only" role="status">Recording…</span>}
    {error && <Alert variant="destructive" className="basis-full"><AlertDescription>{error}<Button type="button" variant="ghost" size="icon" aria-label="Dismiss microphone error" onClick={() => setError("")}><X aria-hidden /></Button></AlertDescription></Alert>}
  </>;
}
