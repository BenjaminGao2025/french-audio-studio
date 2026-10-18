import { useEffect, useRef } from "react";

/** Count visible, recent activity; omit AI waits, hidden tabs and idle time. */
export function useActiveSeconds(enabled: boolean) {
  const seconds = useRef(0);
  const lastActivity = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    lastActivity.current = Date.now();
    let previous = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const tick = setInterval(() => {
      const current = Date.now();
      if (document.visibilityState === "visible" && current - lastActivity.current < 60_000) {
        seconds.current += Math.min(1, (current - previous) / 1000);
      }
      previous = current;
    }, 1000);
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      clearInterval(tick);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
    };
  }, [enabled]);
  return {
    read: () => Math.floor(seconds.current),
    reset: () => {
      seconds.current = 0;
    },
  };
}
