import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { stopPlayback, useApp } from "../state/store";
import { fmtClock } from "../lib/format";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { cn } from "cn";


export const EXCLUSIVE_AUDIO = "french-study-audio";
export function takeAudioFocus(origin?: HTMLMediaElement | null) {
  stopPlayback();
  window.dispatchEvent(new CustomEvent(EXCLUSIVE_AUDIO, { detail: origin }));
}
/** Shared with the compact Ask AI recorder; mp4 covers iPhone Safari. */
export function recordingMime() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find(x => MediaRecorder.isTypeSupported(x));
}
const takes = new Map<string, { blob: Blob; url: string; saved: boolean }>();

/** Keeps the last take while switching study tabs; failed processing can retry the same recording. */
export function StudyRecorder({ id, label, actionLabel = "Check recording", onTake, autoSubmit = true, disabled = false, onPendingChange }: {
  id: string; label: string; actionLabel?: string;
  onTake: (blob: Blob, signal: AbortSignal) => Promise<void>; autoSubmit?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void;
}) {
  const [take, setTake] = useState(takes.get(id));
  const [phase, setPhase] = useState<"idle" | "asking" | "recording" | "busy">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(true);
  const capture = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const callback = useRef(onTake); callback.current = onTake;
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange;
  const pending = phase !== "idle" || !!take && !take.saved;
  useEffect(() => {
    pendingCallback.current?.(pending);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (pending) window.addEventListener("beforeunload", warn);
    return () => { pendingCallback.current?.(false); window.removeEventListener("beforeunload", warn); };
  }, [pending]);
  const globalPlayer = useApp((s) => s.player);

  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };
  const release = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => {
    mounted.current = true;
    const pause = (e: Event) => { capture.current++; if ((e as CustomEvent).detail !== player.current) player.current?.pause(); stop(); };
    window.addEventListener(EXCLUSIVE_AUDIO, pause);
    return () => { mounted.current = false; capture.current++; abort.current?.abort(); stop(); release(); player.current?.pause(); window.removeEventListener(EXCLUSIVE_AUDIO, pause); };
  }, []);
  useEffect(() => {
    if (globalPlayer && ["playing", "loading", "buffering"].includes(globalPlayer.status)) { capture.current++; player.current?.pause(); stop(); }
  }, [globalPlayer?.status, globalPlayer?.owner.label]);
  useEffect(() => {
    if (phase !== "recording") return;
    const start = performance.now();
    const timer = setInterval(() => {
      const n = Math.floor((performance.now() - start) / 1000); setSeconds(n);
      if (n >= 180) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const submit = async (recording = take) => {
    if (!recording || recording.saved) return;
    abort.current?.abort(); const ctl = new AbortController(); abort.current = ctl;
    setPhase("busy"); setError("");
    try {
      await callback.current(recording.blob, ctl.signal);
      if (!mounted.current || ctl.signal.aborted) return;
      const saved = { ...recording, saved: true }; takes.set(id, saved); setTake(saved);
    } catch (e) {
      if (mounted.current && !ctl.signal.aborted) setError(e instanceof Error ? e.message : "Couldn’t process this recording. Try again.");
    } finally { if (mounted.current && !ctl.signal.aborted) setPhase("idle"); }
  };
  const start = async () => {
    setError(""); setPhase("asking"); takeAudioFocus();
    const request = ++capture.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Recording is not supported in this browser.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || request !== capture.current) { media.getTracks().forEach((t) => t.stop()); if (mounted.current) setPhase("idle"); return; }
      stream.current = media;
      const mime = recordingMime();
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onerror = () => { release(); if (mounted.current) { setPhase("idle"); setError("Recording stopped unexpectedly. Please try again."); } };
      r.onstop = () => {
        release();
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        if (mounted.current) setPhase("idle");
        if (!blob.size && !mounted.current) return;
        if (!blob.size) { setError("No audio was recorded. Please try again."); return; }
        const old = takes.get(id); if (old) URL.revokeObjectURL(old.url);
        const next = { blob, url: URL.createObjectURL(blob), saved: false };
        takes.set(id, next);
        if (!mounted.current) return;
        setTake(next);
        if (autoSubmit) void submit(next);
      };
      setSeconds(0); r.start(); setPhase("recording");
    } catch (e) {
      release();
      if (!mounted.current) return;
      setPhase("idle");
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Allow microphone access in your browser’s site settings, then try again." : e instanceof Error ? e.message : "Couldn’t start the microphone.");
    }
  };
  return <div className="study-recorder flex flex-col gap-3" role="group" aria-label={label}>
    <div className="flex flex-wrap items-center gap-2">
      {phase === "recording" ? <Button type="button" variant="default" onClick={stop}>{<Square aria-hidden />}Stop · {fmtClock(seconds)}</Button> :
        <Button type="button" variant="outline" aria-disabled={(!!(disabled || phase === "busy") || !!(phase === "asking")) || undefined} aria-busy={phase === "asking" || undefined} className={cn((!!(disabled || phase === "busy") || !!(phase === "asking")) ? "opacity-50" : "")} onClick={(event) => { if (!!(disabled || phase === "busy") || !!(phase === "asking")) { event.preventDefault(); return; } (() => void start())(); }}>{phase === "asking" ? <Loader2 className="animate-spin" aria-hidden /> : (<Mic aria-hidden />)}{take ? "Record again" : label}</Button>}
      {take && phase !== "recording" && <Button type="button" variant="default" aria-disabled={(!!(take.saved || disabled) || !!(phase === "busy")) || undefined} aria-busy={phase === "busy" || undefined} className={cn((!!(take.saved || disabled) || !!(phase === "busy")) ? "opacity-50" : "")} onClick={(event) => { if (!!(take.saved || disabled) || !!(phase === "busy")) { event.preventDefault(); return; } (() => void submit())(); }}>{phase === "busy" ? <Loader2 className="animate-spin" aria-hidden /> : null}{take.saved ? (autoSubmit ? "Checked" : "Saved") : error ? "Retry recording" : actionLabel}</Button>}
    </div>
    {take && phase !== "recording" && <div className="flex flex-col gap-2"><span className="text-xs leading-4 text-muted-foreground">My recording</span><audio ref={player} controls src={take.url} onPlay={() => { takeAudioFocus(player.current); }} /></div>}
    {error && <Alert variant="destructive" role="alert"><AlertTitle>Recording needs attention</AlertTitle><AlertDescription>{error} Your last recording is kept so you can retry.</AlertDescription></Alert>}
  </div>;
}
