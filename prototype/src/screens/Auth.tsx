import { ArrowRight, BookOpen, Layers, LogIn } from "lucide-react";
import { DEMO_USER } from "../data/fixtures";
import { announce, get, go, set, simulate, useApp } from "../state/store";
import { Banner, Button, PageHead, Spinner } from "../components/ui";

const BENEFITS: Record<string, { title: string; text: string }> = {
  review: { title: "Review", text: "Your saved cards come back on the right day, so the words you studied stay with you. Review keeps your queue, library and mastered cards in your account." },
  practice: { title: "Practice", text: "Writing, speaking and listening practice keep their drafts and results in your account." },
  progress: { title: "Progress", text: "See your audio time toward 1,000 hours and your practice history." },
  settings: { title: "Settings", text: "Your learning preferences and account details appear after you sign in." },
};

/* SCR-AUTH-01 · signed out → demo sign-in → return to the intended destination */
export function Gate({ dest }: { dest: string }) {
  const signIn = useApp((s) => s.signIn);
  const forced = useApp((s) => s.ss["SCR-AUTH-01"]);
  const phase = forced === "pending" || forced === "error" ? forced : signIn;
  const b = BENEFITS[dest] ?? BENEFITS.review;
  const run = () => {
    set(() => ({ signIn: "pending", returnTo: get().route, ss: { ...get().ss, "SCR-AUTH-01": "" } }));
    announce("Signing in with the demo account…");
    simulate("signin", 1200, true, { needsNetwork: false })
      .then(() => {
        if (get().signIn !== "pending") return; // cancelled
        const to = get().returnTo;
        set(() => ({ auth: "in", signIn: "idle" }));
        announce(`Signed in as ${DEMO_USER.name}. Your demo data is back.`);
        go(to);
      })
      .catch(() => {
        if (get().signIn !== "pending") return;
        set(() => ({ signIn: "error" }));
        announce("Demo sign-in didn’t complete.", true);
      });
  };
  return (
    <div className="page">
      <PageHead title={b.title} eyebrow="You’re signed out" desc={b.text} />
      <div className="panel stack gap-4" style={{ maxWidth: 560 }}>
        <div className="row gap-3">
          <span className="dest-icon">{dest === "review" ? <Layers aria-hidden /> : <BookOpen aria-hidden />}</span>
          <p className="grow">This prototype uses one fictional demo account. No email, password or payment is ever requested.</p>
        </div>
        {phase === "pending" && (
          <div className="row row--between">
            <Spinner label="Signing in with the demo account…" />
            <Button kind="secondary" onClick={() => { set(() => ({ signIn: "idle" })); announce("Sign-in cancelled."); }}>Cancel</Button>
          </div>
        )}
        {phase === "error" && (
          <Banner tone="error" title="Demo sign-in didn’t complete" live="assertive">Nothing changed. Your demo data is safe — try again.</Banner>
        )}
        {phase !== "pending" && (
          <div className="btn-row">
            <Button kind="primary" icon={<LogIn aria-hidden />} onClick={run}>
              {phase === "error" ? "Try again" : "Continue with demo account"}
            </Button>
          </div>
        )}
        <p className="t-meta">After signing in you’ll return to {b.title}.</p>
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
          <Button kind="secondary" onClick={() => go("review/library")}>Find my saved content</Button>
        </div>
        <section className="stack gap-3">
          <h2 className="t-section">Can’t find something?</h2>
          <ul className="list">
            <li className="list-row"><span className="grow">Saved cards and sentences</span><Button kind="tertiary" onClick={() => go("review/library")}>Review → Word library</Button></li>
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
