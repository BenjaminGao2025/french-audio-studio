import { Phonetic } from "../components/Phonetic";
/* SCR-PRA-04 Guided listening on the learner's own sentences:
 * listen blind → rate yourself → see the text → relisten (slow, normal, normal) → answer one question. */
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Loader2 } from "lucide-react";
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
import { PageHead, RadioGroup, RadioGroupItem, Spinner, pageFrame } from "../components/ui";
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

  const head = <PageHead back={<BackTo label="Practice" to="practice" />} title="Listen" eyebrow="Guided listening" />;

  if (!s) {
    return (
      <div className={pageFrame()}>
        {head}
        <div className="flex flex-col gap-4">
          {state === "loading" && <Spinner label="Preparing a clip from your sentences…" />}
          {state === "empty" && (
            <Alert variant="default"><AlertTitle>Nothing to listen to yet</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="default" onClick={() => go("study")}>Go to Study</Button></div></AlertDescription></Alert>
          )}
          {state === "error" && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t start a session</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {state !== "loading" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" onClick={() => void begin()}>{state === "error" ? "Retry" : "Start listening"}</Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const done = relistensDone(s);
  const answered = !!s.result;
  const q = s.material.question;
  const step = answered ? 5 : done >= 3 ? 4 : s.revealed ? 3 : s.blind_self !== null ? 2 : 1;
  return (
    <div className={pageFrame()}>
      {head}
      <div className="flex flex-col gap-6">
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Step {Math.min(step, 4)} of 4</Badge>
          <span className="text-sm text-muted-foreground">{["", "Listen without the text", "Read the text", "Listen again", "Answer the question", "Done"][step]}</span>
        </p>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <ClipButton label="Play the clip" src={s.audio_url_normal} speed={1} onStart={() => setPlays((n) => n + 1)} />
            <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={busy}>
              <legend className="mb-2 font-medium">How much did you understand?</legend>
              <RadioGroup value={choice === null ? "" : String(choice)} onValueChange={(v) => setChoice(Number(v))} className="gap-2">
              {SELF.map((label, i) => (
                <label key={label} className="flex items-center gap-3">
                  <RadioGroupItem value={String(i)} />
                  <span>{label}</span>
                </label>
              ))}
              </RadioGroup>
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" aria-disabled={(!!(busy) || !!(!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy) || !!(!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy) || !!(!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined)) { event.preventDefault(); return; } (() => void act(() => listenBlind(s.id, choice as 0 | 1 | 2, plays), "Saved."))(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}Continue{(!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined) ? <span className="sr-only">{!plays ? "Play the clip at least once." : choice === null ? "Choose how much you understood." : undefined}</span> : null}</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">You said you understood: <span className="font-medium">{SELF[s.blind_self ?? 0].toLowerCase()}</span>.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" aria-disabled={(!!(busy)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => void act(() => listenReveal(s.id), "Text shown."))(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}Show the text</Button>
            </div>
            {busy && <Spinner label="Preparing the text and word notes…" />}
          </div>
        )}

        {step >= 3 && <Transcript s={s} />}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="font-medium">Listen again while reading · {done} of 3</p>
            <ClipButton
              key={done}
              label={`Play · ${RELISTEN[done]}`}
              src={done === 0 ? s.audio_url_slow : s.audio_url_normal}
              speed={1}
              onEnded={() => void act(() => listenRelisten(s.id, done), done === 2 ? "Question unlocked." : undefined)}
            />

          </div>
        )}

        {step >= 4 && q.options.length > 0 && (
          <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={answered || busy}>
            <legend lang="fr" className="mb-2 font-medium">{q.prompt}</legend>
            <RadioGroup value={choice === null ? "" : String(choice)} onValueChange={(v) => setChoice(Number(v))} className="gap-2">
            {q.options.map((o, i) => {
              const mine = answered ? s.answer_index === i : choice === i;
              const right = answered && q.answer_index === i;
              return (
                <label key={i} className="flex items-center gap-3">
                  <RadioGroupItem value={String(i)} />
                  <span lang="fr">{o}{right ? " — correct answer" : ""}{answered && mine && !right ? " — your answer" : ""}</span>
                </label>
              );
            })}
            </RadioGroup>
          </fieldset>
        )}

        {step === 4 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default" aria-disabled={(!!(busy) || !!(choice === null ? "Choose an answer first." : undefined)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy) || !!(choice === null ? "Choose an answer first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy) || !!(choice === null ? "Choose an answer first." : undefined)) { event.preventDefault(); return; } (() => void act(() => listenCheck(s.id, choice!), "Answer checked."))(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}Check{(choice === null ? "Choose an answer first." : undefined) ? <span className="sr-only">{choice === null ? "Choose an answer first." : undefined}</span> : null}</Button>
          </div>
        )}

        {answered && (
          <div className="flex flex-col gap-3">
            <Alert variant={s.result!.correct ? "default" : "destructive"} role="status"><AlertTitle>{s.result!.correct ? "Correct" : "Not this time"}</AlertTitle><AlertDescription>{q.explanation && <span lang="fr">{q.explanation}</span>}</AlertDescription></Alert>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" onClick={() => void begin()}>Next clip</Button>
              <Button type="button" variant="outline" onClick={() => go("practice")}>Back to Practice</Button>
            </div>
          </div>
        )}

        {error && <Alert variant="destructive" role="alert"><AlertTitle>That didn’t work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
    </div>
  );
}

function Transcript({ s }: { s: ListeningSession }) {
  const m = s.material;
  const words = m.words.filter((w) => w.ipa || (w.en && w.en !== PLACEHOLDER_GLOSS)).slice(0, 12);
  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-label="Text of the clip">
      <p lang="fr" className="font-serif text-2xl leading-snug wrap-break-word">{m.text}</p>
      {(m.translation_en || m.breakdown) && <p className="text-sm text-muted-foreground">{m.translation_en || m.breakdown}</p>}
      {words.length > 0 && (
        <ul className="flex flex-col gap-1" style={{ paddingLeft: 20 }}>
          {words.map((w, i) => (
            <li key={i}>
              <span lang="fr" className="font-medium">{w.w}</span>
              {formatFriendlyPhonetic(w.ipa) && <Phonetic word={w.w} ipa={w.ipa} />}
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" aria-disabled={(!!(mine?.status === "loading")) || undefined} aria-busy={mine?.status === "loading" || undefined} className={cn((!!(mine?.status === "loading")) ? "opacity-50" : "")} onClick={(event) => { if (!!(mine?.status === "loading")) { event.preventDefault(); return; } (click)(); }}>{mine?.status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : (mine?.status === "playing" ? <Pause aria-hidden /> : <Play aria-hidden />)}{mine?.status === "playing" ? "Pause" : mine?.status === "ended" ? "Play again" : label}</Button>
        {mine && <span className="text-sm text-muted-foreground tabular-nums">{fmtClock(mine.position)} / {fmtClock(mine.duration)}</span>}
      </div>
      {mine?.status === "error" && <Alert variant="destructive" role="alert"><AlertTitle>The clip couldn’t play</AlertTitle><AlertDescription>Your progress is kept.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={retry}>Retry</Button></div></AlertDescription></Alert>}
    </div>
  );
}
