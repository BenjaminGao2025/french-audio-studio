/* Microphone recorder: MediaRecorder → /api/transcribe (local Whisper on the server). */
import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";
import { transcribe } from "../api/practice";
import { fmtClock } from "../lib/format";
import { announce } from "../state/store";
import { Banner, Button, Spinner } from "./ui";

/** The server rejects long uploads; stop well before that. */
export const MAX_RECORD_SECONDS = 180;

type Phase = "idle" | "asking" | "recording" | "transcribing" | "done" | "error";

export interface Recording {
  text: string;
  /** Seconds of audio actually recorded. */
  seconds: number;
}

function pickMime(): string {
  const MR = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MR.isTypeSupported(t)) ?? "";
}

export function recorderSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/**
 * One take per press: record, stop, transcribe, then hand the text to the parent.
 * The last take can be played back from this device; nothing but the transcript is kept.
 */
export function Recorder({ label, onText, disabled }: { label: string; onText: (r: Recording) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const alive = useRef(true);
  // Transcription finishes later; always hand the text to the latest callback (the parent's draft may have changed).
  const cb = useRef(onText);
  cb.current = onText;

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (rec.current && rec.current.state !== "inactive") rec.current.stop();
      release();
      audio.current?.pause();
    };
  }, []);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = Math.floor((performance.now() - started.current) / 1000);
      setSecs(s);
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 250);
    return () => clearInterval(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!recorderSupported()) {
      setPhase("error");
      setError("This browser can’t record audio. Type your answer instead.");
      return;
    }
    setError("");
    setPhase("asking");
    audio.current?.pause();
    setPlaying(false);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setPhase("error");
      setError(denied ? "Microphone access is blocked. Allow it in your browser’s site settings, or type your answer instead." : "No microphone was found. Type your answer instead.");
      announce("Recording didn’t start.", true);
      return;
    }
    if (!alive.current) return release();
    const mime = pickMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    r.onstop = () => {
      release();
      const seconds = Math.max(1, Math.round((performance.now() - started.current) / 1000));
      const blob = new Blob(chunks, { type: r.mimeType || mime || "audio/webm" });
      if (!alive.current) return;
      setUrl(URL.createObjectURL(blob));
      void send(blob, seconds);
    };
    rec.current = r;
    started.current = performance.now();
    setSecs(0);
    r.start();
    setPhase("recording");
    announce("Recording. Press Stop when you’re done.");
  };

  const stop = () => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    setPhase("transcribing");
  };

  const send = async (blob: Blob, seconds: number) => {
    setPhase("transcribing");
    try {
      const res = await transcribe(blob);
      if (!alive.current) return;
      if (!res.text) {
        setPhase("error");
        setError("No speech was recognised. Speak a little louder or closer to the microphone, then record again.");
        announce("No speech recognised.", true);
        return;
      }
      setPhase("done");
      announce("Transcribed.");
      cb.current({ text: res.text, seconds: Math.round(res.duration || seconds) });
    } catch (e) {
      if (!alive.current) return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Transcription failed.");
      announce("Transcription failed.", true);
    }
  };

  const togglePlay = () => {
    if (!url) return;
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(false);
      audio.current.onpause = () => setPlaying(false);
    }
    if (audio.current.src !== url) audio.current.src = url;
    if (playing) return audio.current.pause();
    audio.current.currentTime = 0;
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const busy = phase === "asking" || phase === "transcribing";
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {phase === "recording" ? (
          <Button kind="primary" icon={<Square aria-hidden />} onClick={stop}>Stop recording</Button>
        ) : (
          <Button kind="secondary" icon={<Mic aria-hidden />} busy={busy} disabled={disabled} onClick={() => void start()}>
            {phase === "done" || phase === "error" ? "Record again" : "Start recording"}
          </Button>
        )}
        {url && phase !== "recording" && (
          <Button kind="tertiary" icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={togglePlay}>
            {playing ? "Pause my recording" : "Play my recording"}
          </Button>
        )}
        <span className="text-sm text-muted-foreground tabular-nums" aria-live="off">
          {phase === "recording" ? `Recording · ${fmtClock(secs)} / ${fmtClock(MAX_RECORD_SECONDS)}` : phase === "asking" ? "Waiting for the microphone…" : ""}
        </span>
      </div>
      {phase === "transcribing" && <Spinner label="Transcribing…" />}
      {phase === "error" && <Banner tone="error" title="Recording didn’t work" live="assertive">{error}</Banner>}
    </div>
  );
}
