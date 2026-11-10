/* SCR-PRA-04 Guided listening on the learner's own sentences:
 * listen blind → rate yourself → see the text → relisten (slow, normal, normal) → answer one question. */
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  type ListeningSession,
  getListening,
  listenBlind,
  listenCheck,
  listenRelisten,
  listenReveal,
  newListening,
  relistensDone,
} from "../api/practice";
import { ApiError } from "../api/client";
import { fmtClock } from "../lib/format";
import { formatFriendlyPhonetic } from "../lib/phonetic";
import { announce, get, go, retryPlayback, set, startPlayback, updatePlayer, useApp } from "../state/store";
import { Banner, Button, PageHead, Pill, Spinner } from "../components/ui";
import { BackTo } from "./Practice";

const SELF = ["Almost nothing", "Some of it", "Most or all of it"] as const;
const RELISTEN = ["Slow", "Normal speed", "Normal speed again"];
/** The server's offline stand-in when no AI gloss was available; not worth showing. */
const PLACEHOLDER_GLOSS = "Vocabulary item in sentence context";

export function Listen() {
  const sessionId = useApp((s) => s.drafts["listen:session"] ?? "");
  const setSessionId = (id: string) => set((s) => ({ drafts: { ...s.drafts, "listen:session": id } }));
  const [s, setS] = useState<ListeningSession | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "empty">(sessionId ? "loading" : "idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plays, setPlays] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getListening(sessionId)
      .then((x) => { setS(x); setState("idle"); setPlays(x.blind_plays || 0); })
      .catch(() => { setSessionId(""); setState("idle"); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setState("loading");
    setError("");
    try {
      const x = await newListening();
      setS(x);
      setSessionId(x.id);
      setPlays(0);
      setChoice(null);
      setState("idle");
      announce("New listening clip ready. Listen without the text first.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return setState("empty");
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn’t start a session.");
    }
  };

  const act = async (fn: () => Promise<ListeningSession>, done?: string) => {
    setBusy(true);
    setError("");
    try {
      setS(await fn());
      if (done) announce(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const head = <PageHead back={<BackTo label="Practice" to="practice" />} title="Listen" eyebrow="Guided listening · your own sentences" desc="Listen first without the text, say how much you understood, then read along and listen again." />;

  if (!s) {
    return (
      <div className="page">
        {head}
        <div className="stack gap-4">
          {state === "loading" && <Spinner label="Preparing a clip from your sentences…" />}
          {state === "empty" && (
            <Banner tone="info" title="Nothing to listen to yet" actions={<Button kind="primary" onClick={() => go("study")}>Go to Study</Button>}>
              Listening clips are made from sentences you have studied. Analyse a French text in Study and save a sentence first.
            </Banner>
          )}
          {state === "error" && <Banner tone="error" title="Couldn’t start a session" live="assertive">{error}</Banner>}
          {state !== "loading" && (
            <div className="btn-row">
              <Button kind="primary" onClick={() => void begin()}>{state === "error" ? "Retry" : "Start listening"}</Button>
            </div>
          )}
          <p className="t-support">Each clip is one of your saved or studied sentences, read by a French voice. The speed moves up as you get questions right.</p>
        </div>
      </div>
    );
  }

  const done = relistensDone(s);
  const answered = !!s.result;
  const q = s.material.question;
  const step = answered ? 5 : done >= 3 ? 4 : s.revealed ? 3 : s.blind_self !== null ? 2 : 1;
  return (
    <div className="page">
      {head}
      <div className="stack gap-5">
        <p className="row gap-2">
          <Pill>Step {Math.min(step, 4)} of 4</Pill>
          <span className="t-support">{["", "Listen without the text", "Read the text", "Listen again", "Answer the question", "Done"][step]}</span>
        </p>

        {step === 1 && (
          <div className="stack gap-4">
            <ClipButton label="Play the clip" src={s.audio_url_normal} speed={1} onStart={() => setPlays((n) => n + 1)} />
            <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
              <legend className="t-strong" style={{ marginBottom: 8 }}>How much did you understand?</legend>
              {SELF.map((label, i) => (
                <label key={label} className="option">
                  <input type="radio" name="listen-self" checked={choice === i} onChange={() => setChoice(i)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <div className="btn-row">
              <Button
                kind="primary"
                busy={busy}
                disabledReason={!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined}
                onClick={() => void act(() => listenBlind(s.id, choice as 0 | 1 | 2, plays), "Saved.")}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack gap-3">
            <p className="t-support">You said you understood: <span className="t-strong">{SELF[s.blind_self ?? 0].toLowerCase()}</span>.</p>
            <div className="btn-row">
              <Button kind="primary" busy={busy} onClick={() => void act(() => listenReveal(s.id), "Text shown.")}>Show the text</Button>
            </div>
            {busy && <Spinner label="Preparing the text and word notes…" />}
          </div>
        )}

        {step >= 3 && <Transcript s={s} />}

        {step === 3 && (
          <div className="stack gap-3">
            <p className="t-strong">Listen again while reading · {done} of 3</p>
            <ClipButton
              key={done}
              label={`Play · ${RELISTEN[done]}`}
              src={done === 0 ? s.audio_url_slow : s.audio_url_normal}
              speed={1}
              onEnded={() => void act(() => listenRelisten(s.id, done), done === 2 ? "Question unlocked." : undefined)}
            />
            <p className="t-meta">The question unlocks after you’ve listened all the way through three times: once slow, then twice at normal speed.</p>
          </div>
        )}

        {step >= 4 && q.options.length > 0 && (
          <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }} disabled={answered || busy}>
            <legend lang="fr" className="t-strong" style={{ marginBottom: 8 }}>{q.prompt}</legend>
            {q.options.map((o, i) => {
              const mine = answered ? s.answer_index === i : choice === i;
              const right = answered && q.answer_index === i;
              return (
                <label key={i} className="option">
                  <input type="radio" name="listen-q" checked={mine} onChange={() => setChoice(i)} />
                  <span lang="fr">{o}{right ? " — correct answer" : ""}{answered && mine && !right ? " — your answer" : ""}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        {step === 4 && (
          <div className="btn-row">
            <Button kind="primary" busy={busy} disabledReason={choice === null ? "Choose an answer first." : undefined} onClick={() => void act(() => listenCheck(s.id, choice!), "Answer checked.")}>Check</Button>
          </div>
        )}

        {answered && (
          <div className="stack gap-3">
            <Banner tone={s.result!.correct ? "success" : "error"} title={s.result!.correct ? "Correct" : "Not this time"} live="polite">
              {q.explanation && <span lang="fr">{q.explanation}</span>}
            </Banner>
            <div className="btn-row">
              <Button kind="primary" onClick={() => void begin()}>Next clip</Button>
              <Button kind="secondary" onClick={() => go("practice")}>Back to Practice</Button>
            </div>
          </div>
        )}

        {error && <Banner tone="error" title="That didn’t work" live="assertive">{error}</Banner>}
      </div>
    </div>
  );
}

function Transcript({ s }: { s: ListeningSession }) {
  const m = s.material;
  const words = m.words.filter((w) => w.ipa || (w.en && w.en !== PLACEHOLDER_GLOSS)).slice(0, 12);
  return (
    <section className="panel stack gap-3" aria-label="Text of the clip">
      <p lang="fr" className="t-fr-lg">{m.text}</p>
      {(m.translation_en || m.breakdown) && <p className="t-support">{m.translation_en || m.breakdown}</p>}
      {words.length > 0 && (
        <ul className="stack gap-1" style={{ paddingLeft: 20 }}>
          {words.map((w, i) => (
            <li key={i}>
              <span lang="fr" className="t-strong">{w.w}</span>
              {formatFriendlyPhonetic(w.ipa) && <span className="t-meta"> {formatFriendlyPhonetic(w.ipa)}</span>}
              {w.en && w.en !== PLACEHOLDER_GLOSS && <span> — {w.en}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One audio file through the shared player. `onEnded` fires once, when this playback reaches the end. */
function ClipButton({ label, src, speed, onStart, onEnded }: { label: string; src: string; speed: number; onStart?: () => void; onEnded?: () => void }) {
  const p = useApp((st) => st.player);
  const mineId = useRef<number | null>(null);
  const fired = useRef(false);
  const mine = p && p.id === mineId.current ? p : null;

  useEffect(() => {
    if (mine?.status === "ended" && !fired.current) {
      fired.current = true;
      onEnded?.();
    }
  }, [mine?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // A retry is a new playback: follow its id.
  const retry = () => {
    retryPlayback();
    mineId.current = get().player?.id ?? null;
  };

  const click = () => {
    if (mine?.status === "playing") return updatePlayer({ status: "paused" });
    if (mine?.status === "error") return retry();
    if (mine && mine.status !== "ended") return updatePlayer({ status: "playing" });
    fired.current = false;
    startPlayback({ kind: "practice", label: "Listening clip", route: "practice/listen" }, 10, { src, speed, repeat: false });
    mineId.current = get().player?.id ?? null;
    onStart?.();
  };

  return (
    <div className="stack gap-2">
      <div className="btn-row">
        <Button kind="secondary" icon={mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />} busy={mine?.status === "loading"} onClick={click}>
          {mine?.status === "playing" ? "Pause" : mine?.status === "ended" ? "Play again" : label}
        </Button>
        {mine && <span className="t-support num">{fmtClock(mine.position)} / {fmtClock(mine.duration)}</span>}
      </div>
      {mine?.status === "error" && <Banner tone="error" title="The clip couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retry}>Retry</Button>}>Your progress is kept.</Banner>}
    </div>
  );
}
