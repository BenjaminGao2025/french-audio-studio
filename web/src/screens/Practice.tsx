import { ChevronLeft, ChevronRight, Headphones, Mic, PenSquare, Radio, AudioLines, GraduationCap } from "lucide-react";
import { go } from "../state/store";
import { Banner, Button, PageHead, Pill } from "../components/ui";
import { EpisodeList, EpisodePlayer } from "./Episodes";
import { Listen } from "./PracticeListen";
import { Speak } from "./PracticeSpeak";
import { Studio } from "./PracticeStudio";
import { Write } from "./PracticeWrite";

export function PracticeScreen({ parts }: { parts: string[] }) {
  const [a, b] = parts;
  if (a === "write") return <Write />;
  if (a === "speak") return <Speak />;
  if (a === "listen") return <Listen />;
  if (a === "studio") return <Studio />;
  if (a === "episodes") return b ? <EpisodePlayer id={b} /> : <EpisodeList />;
  if (a === "exams") return <ExamPlaceholder />;
  return <Hub />;
}

export function BackTo({ label, to }: { label: string; to: string }) {
  return (
    <Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go(to)} style={{ alignSelf: "flex-start", marginLeft: -12 }}>
      {label}
    </Button>
  );
}

/* SCR-PRA-01 */
function Hub() {
  const dest = [
    { to: "practice/write", icon: <PenSquare aria-hidden />, title: "Write", text: "TCF Canada writing tasks: hints first, then corrections." },
    { to: "practice/speak", icon: <Mic aria-hidden />, title: "Speak", text: "Answer out loud with your microphone, including a role-play with an AI examiner." },
    { to: "practice/listen", icon: <Headphones aria-hidden />, title: "Listen", text: "Guided listening on your own sentences: blind, read along, then a question." },
    { to: "practice/episodes", icon: <Radio aria-hidden />, title: "Episodes", text: "Continuous listening: longer audio you can come back to." },
    { to: "practice/studio", icon: <AudioLines aria-hidden />, title: "Audio Studio", text: "Turn what you want to say into natural French audio." },
    { to: "practice/exams", icon: <GraduationCap aria-hidden />, title: "Exam practice", text: "Planned · questions not yet verified." },
  ];
  return (
    <div className="page">
      <PageHead title="Practice" />
      <ul className="list studio-grid">
        {dest.map((d) => (
          <li key={d.to}>
            <button className="list-btn" onClick={() => go(d.to)}>
              <span className="dest-icon">{d.icon}</span>
              <span className="grow stack">
                <span className="t-strong">{d.title}</span>
                <span className="t-support">{d.text}</span>
              </span>
              <ChevronRight aria-hidden className="chev" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* SCR-EXM-01: the exam module is planned; nothing here is a real TCF test yet. */
function ExamPlaceholder() {
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Exam practice" eyebrow={<Pill>Planned · questions not yet verified</Pill>} desc="Full TCF Canada-style mock tests are planned." />
      <div className="stack gap-4">
        <Banner tone="info" title="Not available yet">
          We won’t publish mock tests until the questions have been checked against the real exam format. Until then, practise each skill on its own.
        </Banner>
        <div className="btn-row">
          <Button kind="secondary" onClick={() => go("practice/write")}>Write</Button>
          <Button kind="secondary" onClick={() => go("practice/speak")}>Speak</Button>
          <Button kind="secondary" onClick={() => go("practice/listen")}>Listen</Button>
        </div>
      </div>
    </div>
  );
}
