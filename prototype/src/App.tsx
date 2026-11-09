import { useEffect } from "react";
import { AppRoot, Announcer, Frame, Shell, Toasts } from "./components/Shell";
import { DemoNavigator } from "./screens/DemoNavigator";
import { StudyInput, StudyPhoto } from "./screens/StudyInput";
import { StudyLearn } from "./screens/StudyLearn";
import { Launcher, RunScreen } from "./screens/Launcher";
import { ReviewScreen } from "./screens/Review";
import { PracticeScreen } from "./screens/Practice";
import { ProgressScreen } from "./screens/Progress";
import { HistoryScreen } from "./screens/History";
import { SettingsScreen } from "./screens/Settings";
import { DesignReference } from "./screens/Design";
import { Gate, Legacy } from "./screens/Auth";
import { go, parseHash, resetPlaybackClock, set, tick, useApp } from "./state/store";

function Routes() {
  const route = useApp((s) => s.route);
  const auth = useApp((s) => s.auth);
  const hasAnalysis = useApp((s) => s.study.analysis.status === "done" && s.study.sentences.length > 0);
  const [path] = route.split("?");
  const parts = path.split("/");
  const top = parts[0];

  if (auth === "out" && ["review", "practice", "progress", "settings"].includes(top)) return <Gate dest={top} />;

  switch (top) {
    case "study":
      if (parts[1] === "photo") return <StudyPhoto />;
      if (parts[1] === "recall") return <Launcher kind="Recall" />;
      if (parts[1] === "dictation") return <Launcher kind="Dictation" />;
      if (parts[1] === "run") return <RunScreen />;
      if (parts[1] === "new" || !hasAnalysis) return <StudyInput />;
      return <StudyLearn />;
    case "review":
      return <ReviewScreen sub={parts[1] ?? "due"} />;
    case "practice":
      return <PracticeScreen parts={parts.slice(1)} />;
    case "progress":
      if (parts[1] === "history") return <HistoryScreen />;
      return <ProgressScreen sub={parts[1]} />;
    case "settings":
      return <SettingsScreen sub={parts[1]} />;
    case "design":
      return <DesignReference />;
    case "moved":
      return <Legacy />;
    default:
      return <Legacy />;
  }
}

export default function App() {
  useEffect(() => {
    set(() => ({ route: parseHash() }));
    if (parseHash() === "moved" && !location.hash.startsWith("#/moved")) history.replaceState(null, "", location.hash);
    const onHash = () => set(() => ({ route: parseHash() }));
    window.addEventListener("popstate", onHash);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("visibilitychange", resetPlaybackClock);
    const t = setInterval(() => tick(), 250);
    return () => {
      window.removeEventListener("popstate", onHash);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", resetPlaybackClock);
      clearInterval(t);
    };
  }, []);
  // The document title never contains exercise content.
  const route = useApp((s) => s.route);
  useEffect(() => {
    const top = route.split(/[/?]/)[0];
    const names: Record<string, string> = { study: "Study", review: "Review", practice: "Practice", progress: "Progress", settings: "Settings", design: "Design reference", moved: "Page moved" };
    document.title = `${names[top] ?? "1000H French"} · 1000H French Demo`;
  }, [route]);
  return (
    <Frame>
      <AppRoot>
        <Shell>
          <Routes />
        </Shell>
        <Toasts />
        <DemoNavigator />
        <Announcer />
      </AppRoot>
    </Frame>
  );
}

export { go };
