import { ArrowRight, BookOpen, Layers, LogIn } from "lucide-react";
import { loginUrl } from "../api/client";
import { go, useApp } from "../state/store";
import { Button, PageHead } from "../components/ui";

const BENEFITS: Record<string, { title: string; text: string }> = {
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
    <div className="page">
      <PageHead title={b.title} eyebrow="You’re signed out" desc={b.text} />
      <div className="panel stack gap-4" style={{ maxWidth: 560 }}>
        <div className="row gap-3">
          <span className="dest-icon">{dest === "review" ? <Layers aria-hidden /> : <BookOpen aria-hidden />}</span>
          <p className="grow">Sign in to see your own cards, history and progress.</p>
        </div>
        <div className="btn-row">
          <Button kind="primary" icon={<LogIn aria-hidden />} onClick={() => location.assign(loginUrl(route))}>
            Sign in
          </Button>
        </div>
        <p className="t-meta">After signing in you’ll return to {b.title}.</p>
      </div>
    </div>
  );
}

/* Unknown /app path */
export function NotFound() {
  return (
    <div className="page">
      <PageHead title="Page not found" desc="There is no page at this address." />
      <div className="btn-row">
        <Button kind="primary" iconAfter={<ArrowRight aria-hidden />} onClick={() => go("study")}>Continue to Study</Button>
      </div>
    </div>
  );
}

/* SCR-LEG-01 */
export function Legacy() {
  return (
    <div className="page">
      <PageHead title="This page has moved" desc="The link you followed points to an older page. Everything you need now lives in Study, Review, Practice, Progress and Settings." />
      <div className="stack gap-5" style={{ maxWidth: 640 }}>
        <div className="btn-row">
          <Button kind="primary" iconAfter={<ArrowRight aria-hidden />} onClick={() => go("study")}>Continue to Study</Button>
          <Button kind="secondary" onClick={() => go("review/saved")}>Find my saved content</Button>
        </div>
        <section className="stack gap-3">
          <h2 className="t-section">Can’t find something?</h2>
          <ul className="list">
            <li className="list-row"><span className="grow">Saved cards and sentences</span><Button kind="tertiary" onClick={() => go("review/saved")}>Review → Saved cards</Button></li>
            <li className="list-row"><span className="grow">Mastered cards</span><Button kind="tertiary" onClick={() => go("review/mastered")}>Review → Mastered</Button></li>
            <li className="list-row"><span className="grow">Past analyses and practice attempts</span><Button kind="tertiary" onClick={() => go("progress/history")}>Progress → History</Button></li>
            <li className="list-row"><span className="grow">Exam practice</span><Button kind="tertiary" onClick={() => go("practice/exams")}>Practice → Exam practice</Button></li>
          </ul>
          <p className="t-support">Your saved content stays in your account. Nothing needs to be cleared or reset to find it.</p>
        </section>
      </div>
    </div>
  );
}
