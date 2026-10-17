import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { btn, isNotAvailable } from "@/components/fr/kit-utils";
import { useT } from "@/i18n";

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded bg-secondary" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useT();
  if (isNotAvailable(error)) {
    return <EmptyState title={t("notAvailable")} hint={t("notAvailableHint")} />;
  }
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="font-medium">Couldn't load this</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {retry && (
        <button onClick={retry} className={`${btn.ghost} mt-2`}>
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      )}
    </div>
  );
}

/** Render helper: loading → error → empty → content. */
export function DataView<T>({
  query,
  isEmpty,
  empty,
  children,
  skeletonLines = 3,
  quiet = false,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => void;
  };
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
  skeletonLines?: number;
  /** Optional panel: render nothing (instead of "not available") when the server lacks the route. */
  quiet?: boolean;
}) {
  if (query.isPending) return <Skeleton lines={skeletonLines} />;
  if (query.isError) {
    if (quiet && isNotAvailable(query.error)) return null;
    return <ErrorState error={query.error} retry={query.refetch} />;
  }
  const data = query.data!;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children(data)}</>;
}
