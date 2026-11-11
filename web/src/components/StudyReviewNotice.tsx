import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { go, useApp } from "../state/store";
import { Button } from "./ui";

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
    <aside className="fact-card">
      <h2 className="meta-k">Due today</h2>
      <dl className="fact-dl">
        <div><dt>Cards</dt><dd>{counts.total}</dd></div>
        <div><dt>To revisit</dt><dd>{revisit}</dd></div>
      </dl>
      <Button kind="secondary" onClick={() => go("review/due")}>Review today’s cards</Button>
    </aside>
  );
}
