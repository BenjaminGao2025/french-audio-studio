import { ArrowRight, LogIn } from "lucide-react";
import { loginUrl } from "../api/client";
import { go, useApp } from "../state/store";
import { PageHead } from "../components/ui";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

const BENEFITS: Record<string, { title: string; text: string }> = {
  "study/personal": { title: "Personal speaking practice", text: "Save your own ideas, recordings and reflection in your practice archive." },
  "study/grammar": { title: "My grammar map", text: "Revisit the grammar patterns you have met in your own saved sentences." },
  review: { title: "Review", text: "Your saved cards come back on the right day, so the words you studied stay with you. Review keeps your queue, library and mastered cards in your account." },
  practice: { title: "Practice", text: "Writing, speaking and listening practice keep their drafts and results in your account." },
  progress: { title: "Progress", text: "See your audio time toward 1,000 hours and your practice history." },
  settings: { title: "Settings", text: "Your learning preferences and account details appear after you sign in." },
};

/* SCR-AUTH-01 · signed out → real sign-in page → back to the intended destination */
export function Gate({ dest }: { dest: string }) {
  const route = useApp((s) => s.route);
  const b = BENEFITS[dest] ?? BENEFITS.review;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHead title={b.title} />
      <Card>
        <CardContent className="flex flex-col items-start gap-4">
          <p className="text-sm text-muted-foreground">Sign in to open this page.</p>
          <Button type="button" variant="default" onClick={() => location.assign(loginUrl(route))}>{<LogIn aria-hidden />}Sign in</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* Unknown /app path */
export function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead title="Page not found" desc="There is no page at this address." />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="default" onClick={() => go("study")}>Continue to Study{<ArrowRight aria-hidden />}</Button>
      </div>
    </div>
  );
}

/* SCR-LEG-01 */
export function Legacy() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead title="This page has moved" />
      <div className="flex flex-col gap-6" style={{ maxWidth: 640 }}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="default" onClick={() => go("study")}>Continue to Study{<ArrowRight aria-hidden />}</Button>
          <Button type="button" variant="outline" onClick={() => go("review/saved")}>Find my saved content</Button>
        </div>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-balance">Can’t find something?</h2>
          <ul className="divide-y overflow-hidden rounded-lg border">
            <li className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1">Saved cards and sentences</span><Button type="button" variant="ghost" onClick={() => go("review/saved")}>Review → Saved cards</Button></li>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1">Mastered cards</span><Button type="button" variant="ghost" onClick={() => go("review/mastered")}>Review → Mastered</Button></li>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1">Past analyses and practice attempts</span><Button type="button" variant="ghost" onClick={() => go("progress/history")}>Progress → History</Button></li>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1">Exam practice</span><Button type="button" variant="ghost" onClick={() => go("practice/exams")}>Practice → Exam practice</Button></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
