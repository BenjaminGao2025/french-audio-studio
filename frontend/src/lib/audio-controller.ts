// All SPA players (including native episode controls) share this playback owner.
let active: { source: HTMLMediaElement; stop: () => void } | null = null;

function claim(source: HTMLMediaElement, onStop?: () => void) {
  if (active?.source === source) return active;
  const previous = active;
  active = null;
  previous?.stop();
  document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
    if (media !== source && !media.paused) media.pause();
  });
  window.speechSynthesis?.cancel();
  const entry = {
    source,
    stop: () => {
      source.pause();
      onStop?.();
    },
  };
  active = entry;
  return entry;
}

export const audioController = {
  claim,
  async play(source: HTMLMediaElement, onStop: () => void): Promise<boolean> {
    const entry = claim(source, onStop);
    try {
      await source.play();
    } catch (error) {
      if (active !== entry) return false;
      audioController.stop(source);
      throw error;
    }
    if (active !== entry) {
      source.pause();
      return false;
    }
    return true;
  },
  stop(source?: HTMLMediaElement) {
    if (source && active?.source !== source) return;
    const previous = active;
    active = null;
    previous?.stop();
  },
};

document.addEventListener(
  "play",
  (event) => {
    if (event.target instanceof HTMLMediaElement) claim(event.target);
  },
  true,
);
window.addEventListener("pagehide", () => audioController.stop());
