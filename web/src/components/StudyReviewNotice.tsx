import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { go, useApp } from "../state/store";
import { Stat } from "./ui";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";


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
    <Card>
      <CardHeader>
        <CardTitle>Due today</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-4">
          <Stat label="Cards" value={counts.total} />
          <Stat label="To revisit" value={revisit} />
          <Stat label="New" value={counts.new} />
        </dl>
      </CardContent>
      <CardFooter className="border-t">
        <Button type="button" className="w-full sm:w-auto" onClick={() => go("review/due")}>Review today’s cards</Button>
      </CardFooter>
    </Card>
  );
}
