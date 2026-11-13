import { useEffect } from "react";
import { toast } from "sonner";
import { APP_VERSION } from "../data/releases";

/* The /app page is never cached and names the release in its pwa-register.js?v= query, so a
   window left open can compare that with the version its own code was built as. */
const VERSION_IN_PAGE = /pwa-register\.js\?v=([\w.-]+)/;
const CHECK_EVERY_MS = 30 * 60_000;
const MIN_GAP_MS = 60_000;

export function versionInPage(html: string): string | null {
  return VERSION_IN_PAGE.exec(html)?.[1] ?? null;
}

export async function liveVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/app/index.html", { cache: "no-store", credentials: "same-origin" });
    return res.ok ? versionInPage(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Offers a reload once a newer release is live. Checks when the window comes back into view and every 30 minutes. */
export function useUpdatePrompt(enabled: boolean = import.meta.env.PROD, fetchImpl?: typeof fetch) {
  useEffect(() => {
    if (!enabled) return;
    let shown = false;
    let last = 0;
    const check = () => {
      const now = Date.now();
      if (shown || document.visibilityState === "hidden" || now - last < MIN_GAP_MS) return;
      last = now;
      void liveVersion(fetchImpl).then((live) => {
        if (!live || live === APP_VERSION || shown) return;
        shown = true;
        toast(`Version ${live} is ready`, {
          id: "app-update",
          description: "Reload to start using it.",
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
      });
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [enabled, fetchImpl]);
}
