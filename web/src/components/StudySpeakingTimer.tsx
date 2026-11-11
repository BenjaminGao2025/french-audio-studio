import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { fmtClock } from "../lib/format";
import { useApp } from "../state/store";
import { EXCLUSIVE_AUDIO, takeAudioFocus } from "./StudyRecorder";
import { Button } from "./ui/button";
import { cn } from "cn";
import { Loader2 } from "lucide-react";


/** Counts microphone activity only during an explicitly started, visible practice session. */
export function StudySpeakingTimer({ journalId, disabled }: { journalId: string; disabled: boolean }) {
  const [active, setActive] = useState(false);
  const [asking, setAsking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const player = useApp((s) => s.player);
  const stop = () => { generation.current++; stopRef.current?.(); stopRef.current = null; setActive(false); setAsking(false); };
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") stop(); };
    window.addEventListener(EXCLUSIVE_AUDIO, stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      generation.current++; stopRef.current?.(); stopRef.current = null;
      window.removeEventListener(EXCLUSIVE_AUDIO, stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => { if (player && ["playing", "loading", "buffering"].includes(player.status)) stop(); }, [player?.status]);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  const start = async () => {
    takeAudioFocus(); const run = ++generation.current;
    setAsking(true); setError("");
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new Error("Microphone activity timing is not supported in this browser.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (run !== generation.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      context = new AudioContext(); await context.resume();
      if (run !== generation.current) { stream.getTracks().forEach((t) => t.stop()); void context.close(); return; }
      const analyser = context.createAnalyser(); analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let voiced = 0, pending = 0, last = performance.now(), lastSend = last;
      const flush = () => {
        const count = Math.min(30, Math.floor(pending));
        if (!count) return;
        pending -= count;
        // Each unique beat is idempotent on the server. No playback or hidden-tab time is sent.
        void apiFetch(`/api/homework/${journalId}/practice`, { body: { beat_id: crypto.randomUUID(), seconds: count }, keepalive: true, noAuthRedirect: true })
          .catch(() => { if (run === generation.current) setError("Some speaking time could not be saved. Your recordings are unaffected."); });
      };
      const timer = setInterval(() => {
        const now = performance.now(), elapsed = Math.min(.25, (now - last) / 1000); last = now;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
        if (document.visibilityState !== "hidden" && rms > .015) { voiced += elapsed; pending += elapsed; setSeconds(Math.floor(voiced)); }
        if (now - lastSend >= 15_000) { flush(); lastSend = now; }
      }, 100);
      stopRef.current = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); void context?.close(); flush(); };
      setSeconds(0); setActive(true); setAsking(false);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop()); void context?.close();
      if (run === generation.current) { setAsking(false); setError(e instanceof Error ? e.message : "Couldn’t start microphone activity timing."); }
    }
  };
  return <div className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><Button type="button" variant={active ? "default" : "outline"} aria-disabled={(!!(disabled) || !!(asking)) || undefined} aria-busy={asking || undefined} className={cn((!!(disabled) || !!(asking)) ? "opacity-50" : "")} onClick={(event) => { if (!!(disabled) || !!(asking)) { event.preventDefault(); return; } (() => active ? stop() : void start())(); }}>{asking ? <Loader2 className="animate-spin" aria-hidden /> : null}{active ? "Stop speaking practice" : "Practise aloud with timer"}</Button><span className="text-xs leading-4 text-muted-foreground" role="status">Speaking activity · {fmtClock(seconds)}</span></div>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}</div>;
}
