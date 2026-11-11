import { ChevronLeft, Headphones, Mic, PenSquare, Radio, AudioLines, GraduationCap } from "lucide-react";
import { go } from "../state/store";
import { Banner, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHead, Pill } from "../components/ui";
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
    <Button kind="tertiary" className="h-8 px-2 text-sm" icon={<ChevronLeft aria-hidden />} onClick={() => go(to)} style={{ alignSelf: "flex-start", marginLeft: -12 }}>
      {label}
    </Button>
  );
}

/* SCR-PRA-01 */
function Hub() {
  const dest = [
    { to: "practice/write", icon: <PenSquare aria-hidden />, title: "Write", text: "TCF writing tasks" },
    { to: "practice/speak", icon: <Mic aria-hidden />, title: "Speak", text: "Answer out loud" },
    { to: "practice/listen", icon: <Headphones aria-hidden />, title: "Listen", text: "Sentences you have studied" },
    { to: "practice/episodes", icon: <Radio aria-hidden />, title: "Episodes", text: "Longer audio" },
    { to: "practice/studio", icon: <AudioLines aria-hidden />, title: "Audio Studio", text: "Your words as French audio" },
    { to: "practice/exams", icon: <GraduationCap aria-hidden />, title: "Exam practice", text: "Planned" },
  ];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead title="Practice" />
      <div className="grid gap-4 sm:grid-cols-2">
        {dest.map((d) => (
          <Card key={d.to}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">{d.icon}{d.title}</CardTitle>
              <CardDescription>{d.text}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button kind="secondary" onClick={() => go(d.to)}>Open</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* SCR-EXM-01: the exam module is planned; nothing here is a real TCF test yet. */
function ExamPlaceholder() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Exam practice" eyebrow={<Pill>Planned · questions not yet verified</Pill>} desc="Full TCF Canada-style mock tests are planned." />
      <div className="flex flex-col gap-4">
        <Banner tone="info" title="Not available yet">
          We won’t publish mock tests until the questions have been checked against the real exam format. Until then, practise each skill on its own.
        </Banner>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="secondary" onClick={() => go("practice/write")}>Write</Button>
          <Button kind="secondary" onClick={() => go("practice/speak")}>Speak</Button>
          <Button kind="secondary" onClick={() => go("practice/listen")}>Listen</Button>
        </div>
      </div>
    </div>
  );
}
