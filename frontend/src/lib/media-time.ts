// Listening time for SPA pages: counts the seconds of audio really played (also with the phone
// locked), through the same tracker the legacy pages use (static/media-time.js).
import "../../../static/media-time.js";
import { api } from "@/api";
import type { Lane } from "@/api/types";

type Tracker = { destroy(): void };
type MediaTime = {
  create(options: {
    laneFor(el: unknown): string;
    onSeconds(lane: string, seconds: number): void;
  }): Tracker;
};

const FLUSH_SECONDS = 30;
const MAX_BEAT_SECONDS = 120; // the server stores at most this much per heartbeat

/** Start counting played audio under `lane`; call the returned function to stop. */
export function trackListening(lane: Lane): () => void {
  const media = (window as unknown as { FrenchMediaTime?: MediaTime }).FrenchMediaTime;
  if (!media) return () => {};
  let pending = 0;
  let flushing = false;
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (pending >= 1) {
        const chunk = Math.min(MAX_BEAT_SECONDS, Math.floor(pending));
        await api.game.heartbeat(lane, chunk);
        pending -= chunk;
      }
    } catch {
      // keep the seconds; the next beat retries
    } finally {
      flushing = false;
    }
  };
  const tracker = media.create({
    laneFor: () => lane,
    onSeconds: (_lane, seconds) => {
      pending += seconds;
      if (pending >= FLUSH_SECONDS) void flush();
    },
  });
  const onHide = () => {
    if (document.hidden) void flush();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onHide);
    tracker.destroy();
    void flush();
  };
}
