import { ChevronLeft, Headphones, Mic, PenSquare, Radio, AudioLines, GraduationCap } from "lucide-react";
import { go } from "../state/store";
import { Card, CardDescription, CardHeader, CardTitle, PageHead } from "../components/ui";
import { EpisodeList, EpisodePlayer } from "./Episodes";
import { Listen } from "./PracticeListen";
import { Speak } from "./PracticeSpeak";
import { Studio } from "./PracticeStudio";
import { Write } from "./PracticeWrite";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";

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
    <Button type="button" variant="ghost" style={{ alignSelf: "flex-start", marginLeft: -12 }} className="h-8 px-2 text-sm" onClick={() => go(to)}>{<ChevronLeft aria-hidden />}{label}</Button>
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
          <Card key={d.to} className="py-0">
            <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal rounded-xl px-0 py-0 text-left" onClick={() => go(d.to)}><CardHeader className="w-full">
                <CardTitle className="flex items-center gap-2 text-base">{d.icon}{d.title}</CardTitle>
                <CardDescription>{d.text}</CardDescription>
              </CardHeader></Button>
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
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Exam practice" eyebrow={<Badge variant="outline">Planned · questions not yet verified</Badge>} />
      <div className="flex flex-col gap-4">
        <Alert variant="default"><AlertTitle>Not available yet</AlertTitle></Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => go("practice/write")}>Write</Button>
          <Button type="button" variant="outline" onClick={() => go("practice/speak")}>Speak</Button>
          <Button type="button" variant="outline" onClick={() => go("practice/listen")}>Listen</Button>
        </div>
      </div>
    </div>
  );
}
