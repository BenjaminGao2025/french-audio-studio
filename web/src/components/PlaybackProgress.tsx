import { useLayoutEffect, useState, type ComponentProps } from "react";
import { fmtClock } from "../lib/format";
import { readPlaybackPosition, type PlayerState } from "../state/store";
import { Progress } from "./ui/progress";
import { Slider } from "./ui/slider";

/** Only these small controls render per frame. Timekeeping, persistence and the rest of the
 * screen keep using the normal media events; buffering never advances a guessed audio clock. */
function usePlaybackPosition(player: PlayerState | null, fallback = 0) {
  const [position, setPosition] = useState(player?.position ?? fallback);
  const id = player?.id;
  const reported = player?.position ?? fallback;
  const duration = player?.duration ?? 0;
  const playing = player?.status === "playing";
  const speed = player?.speed ?? 1;

  useLayoutEffect(() => {
    let frame: number | undefined;
    let start = performance.now();
    const draw = () => {
      // The elapsed-time fallback is only for the design reference's simulated player.
      const actual = id === undefined ? null : readPlaybackPosition(id);
      const elapsed = playing && !document.hidden ? (performance.now() - start) / 1000 : 0;
      const next = actual ?? reported + elapsed * speed;
      setPosition(Math.max(0, duration > 0 ? Math.min(duration, next) : next));
      if (playing && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const visibility = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      start = performance.now();
      draw();
    };
    draw();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, reported, duration, playing, speed]);

  return position;
}

export function PlaybackProgress({ player, className = "", ...props }: {
  player: PlayerState | null;
} & Omit<ComponentProps<typeof Progress>, "value">) {
  const position = usePlaybackPosition(player);
  const value = player?.duration ? (position / player.duration) * 100 : 0;
  return <Progress {...props} value={value} className={`${className} [&_[data-slot=progress-indicator]]:transition-none`} />;
}

export function PlaybackSeek({ player, position, duration, onSeek }: {
  player: PlayerState | null;
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const shown = usePlaybackPosition(player, position);
  return (
    <Slider
      min={0}
      max={Math.max(1, duration)}
      step={1}
      value={[shown]}
      aria-label="Position in the episode"
      aria-valuetext={`${fmtClock(shown)} of ${fmtClock(duration)}`}
      onValueChange={([value]) => onSeek(value)}
    />
  );
}
