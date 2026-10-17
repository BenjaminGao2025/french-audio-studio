import type { useNavigate } from "@tanstack/react-router";
import { ApiError } from "@/api/client";
import { t } from "@/i18n";
// Non-component kit exports (kept separate from kit.tsx so react-refresh stays happy).

export const meta = (title: string, description: string) => ({
  meta: [
    { title: `${title} · 1000H French` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} · 1000H French` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ],
});

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary disabled:opacity-40",
  soft: "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-80",
};

/** Navigate to a plan route string that may contain a query string. */
export function navTo(navigate: ReturnType<typeof useNavigate>, route: string) {
  const [path, qs] = route.split("?");
  void navigate({
    to: path as never,
    search: Object.fromEntries(new URLSearchParams(qs ?? "")) as never,
  });
}

/** Preserve existing plan parameters and replace, never duplicate, the block id. */
export function withBlock(route: string, id: string): string {
  const [base, hash] = route.split("#");
  const [path, query] = (base ?? route).split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("block", id);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

/** The route is missing on this server (feature not built yet): 404 or 405 from the API. */
export function isNotAvailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

/** Text for a failed user action: "not available" when the server lacks the route. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (isNotAvailable(error)) return t("notAvailable");
  return error instanceof Error ? error.message : fallback;
}
