import { useEffect, useRef, useState } from "react";
import { Mic, Play, Square } from "lucide-react";
import { api } from "@/api";
import type { Lane, RateStage, Rubric, SkipReason } from "@/api/types";
import { cn } from "@/lib/utils";
import { btn } from "@/components/fr/kit-utils";
import { Chip } from "@/components/fr/kit";

// ---- AudioButton: one shared <audio> element, shows playing state ----

let sharedAudio: HTMLAudioElement | null = null;

export function AudioButton({
  url,
  label,
  rate,
  onPlay,
  size = "md",
  disabled = false,
}: {
  /** null when there is nothing playable (e.g. empty text): the button is disabled. */
  url: string | null;
  label?: string;
  rate?: RateStage;
  onPlay?: () => void;
  size?: "md" | "lg";
  disabled?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const owner = useRef<HTMLAudioElement | null>(null);
  const pending = useRef(false);
  useEffect(
    () => () => {
      const audio = owner.current;
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
      }
    },
    [],
  );
  const play = async () => {
    if (pending.current || !url) return;
    if (playing && owner.current) {
      owner.current.pause();
      setPlaying(false);
      return;
    }
    if (sharedAudio) {
      sharedAudio.pause();
      sharedAudio.onended?.(new Event("ended"));
    }
    const audio = new Audio(url);
    sharedAudio = audio;
    owner.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      setError(true);
    };
    pending.current = true;
    setError(false);
    try {
      await audio.play();
      if (owner.current === audio) {
        setPlaying(true);
        onPlay?.();
      }
    } catch {
      setPlaying(false);
      setError(true);
    } finally {
      pending.current = false;
    }
  };
  const rateLabel = rate === "slow30" ? " · -30%" : rate === "slow20" ? " · -20%" : "";
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => void play()}
        disabled={disabled || !url}
        aria-label={label || (playing ? "Stop" : "Play")}
        className={
          size === "lg"
            ? "mx-auto grid h-20 w-20 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            : btn.ghost
        }
      >
        {playing ? (
          <Square className={size === "lg" ? "h-8 w-8" : "h-4 w-4"} />
        ) : (
          <Play className={size === "lg" ? "h-8 w-8 fill-current" : "h-4 w-4"} />
        )}
        {size === "md" && (
          <>
            {label ?? (playing ? "Stop" : "Play")}
            {rateLabel}
          </>
        )}
      </button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          Audio unavailable — try again.
        </span>
      )}
    </span>
  );
}

// ---- Recorder: MediaRecorder with elapsed time and permission errors ----

export function Recorder({
  onDone,
  maxSeconds,
  className,
}: {
  onDone: (blob: Blob, durationSec: number) => void;
  maxSeconds?: number | undefined;
  className?: string;
}) {
  const [rec, setRec] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => {
    recRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRec(false);
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = (Date.now() - startRef.current) / 1000;
        onDone(new Blob(chunks, { type: mime }), duration);
      };
      recRef.current = mr;
      startRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const s = (Date.now() - startRef.current) / 1000;
        setElapsed(Math.floor(s));
        if (maxSeconds && s >= maxSeconds) stop();
      }, 250);
      mr.start();
      setRec(true);
    } catch {
      setError("Microphone unavailable — check browser permission and try again.");
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <button
        type="button"
        onClick={rec ? stop : start}
        className={cn(
          "grid h-16 w-16 place-items-center rounded-full transition",
          rec
            ? "animate-pulse bg-destructive text-destructive-foreground"
            : "bg-primary text-primary-foreground",
        )}
        aria-label={rec ? "Stop recording" : "Start recording"}
      >
        {rec ? <Square className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </button>
      <span className="text-xs tabular-nums text-muted-foreground">
        {rec ? `Recording… ${elapsed}s` : "Tap to record"}
      </span>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---- BlockTimer: heartbeat to /api/game/heartbeat every 60s while visible ----

export function BlockTimer({ lane, active }: { lane: Lane; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const beat = () => {
      if (document.visibilityState === "visible") void api.game.heartbeat(lane, 60).catch(() => {});
    };
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
  }, [lane, active]);
  return null;
}

// ---- SkipReasonSelect ----

const skipReasons: { value: SkipReason; label: string }[] = [
  { value: "no_time", label: "No time" },
  { value: "too_hard", label: "Too hard" },
  { value: "health", label: "Health" },
  { value: "family", label: "Family" },
];

export function SkipReasonSelect({
  onPick,
  onCancel,
}: {
  onPick: (r: SkipReason) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">Skip because:</span>
      {skipReasons.map((r) => (
        <button
          key={r.value}
          onClick={() => onPick(r.value)}
          className="rounded-full px-2 py-0.5 hover:bg-secondary"
        >
          {r.label}
        </button>
      ))}
      <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
        ✕
      </button>
    </div>
  );
}

// ---- RubricPanel ----

export function RubricPanel({ rubric }: { rubric: Rubric }) {
  return (
    <div className="panel space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Estimated score</h3>
        <Chip>AI estimate</Chip>
      </div>
      <div className="text-3xl font-semibold tabular-nums">
        {rubric.score_low}–{rubric.score_high}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          confidence: {rubric.confidence}
        </span>
      </div>
      {rubric.hard_fail && (
        <Chip tone="bad">A1 non-atteint risk: {rubric.hard_fail.replace("_", " ")}</Chip>
      )}
      <ul className="space-y-2">
        {rubric.dims.map((d) => (
          <li key={d.dim} className="flex items-baseline justify-between gap-4 text-sm">
            <span>{d.dim}</span>
            <span className="flex items-center gap-2">
              {d.evidence && <span className="text-xs text-muted-foreground">{d.evidence}</span>}
              <Chip tone="accent">{d.cefr}</Chip>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
