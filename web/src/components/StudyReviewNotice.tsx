import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { go, useApp } from "../state/store";
import { Button } from "./ui/button";


type Counts = { total: number; review: number; learning: number; new: number; reviewed_today: number };
export function StudyReviewNotice() {
  const auth = useApp((s) => s.auth);
  const route = useApp((s) => s.route);
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setCounts(null);
    if (auth === "out") return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      apiFetch<{ counts: Counts }>(`/api/srs/queue?tz_offset=${new Date().getTimezoneOffset()}`, { signal: ctl.signal, noAuthRedirect: true })
        .then((r) => { if (!ctl.signal.aborted) setCounts(r.counts); }).catch(() => undefined);
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { ctl.abort(); window.removeEventListener("focus", refresh); };
  }, [auth, route]);
  if (!counts?.total) return null;
  const revisit = counts.review + counts.learning;
  return (
    <aside className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4">
      <h2 className="text-xs font-medium text-muted-foreground">Due today</h2>
      <dl className="flex flex-wrap gap-6">
        <div><dt>Cards</dt><dd>{counts.total}</dd></div>
        <div><dt>To revisit</dt><dd>{revisit}</dd></div>
      </dl>
      <Button type="button" variant="outline" onClick={() => go("review/due")}>Review today’s cards</Button>
    </aside>
  );
}
