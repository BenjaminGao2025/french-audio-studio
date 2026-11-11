import { useEffect, useRef, useState } from "react";
import { mediaRequest } from "../api/learning";
import { useApp } from "../state/store";
import { EXCLUSIVE_AUDIO, takeAudioFocus } from "./StudyRecorder";
import { Spinner } from "./ui";
import { Button } from "./ui/button";

/** Fetch private audio with authentication, then release its local URL on navigation. */
export function PrivateAudio({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const player = useRef<HTMLAudioElement>(null);
  const globalPlayer = useApp((s) => s.player);
  useEffect(() => {
    const ctl = new AbortController(); let local = "";
    setUrl(""); setError("");
    mediaRequest(path, undefined, ctl.signal).then((r) => r.blob()).then((blob) => {
      if (!ctl.signal.aborted) { local = URL.createObjectURL(blob); setUrl(local); }
    }).catch((e: unknown) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "Couldn’t load audio."); });
    return () => { ctl.abort(); if (local) URL.revokeObjectURL(local); };
  }, [path, attempt]);
  useEffect(() => {
    const pause = (e: Event) => { if ((e as CustomEvent).detail !== player.current) player.current?.pause(); };
    window.addEventListener(EXCLUSIVE_AUDIO, pause);
    return () => window.removeEventListener(EXCLUSIVE_AUDIO, pause);
  }, []);
  useEffect(() => {
    if (globalPlayer && ["playing", "loading", "buffering"].includes(globalPlayer.status)) player.current?.pause();
  }, [globalPlayer]);
  return <div className="flex flex-col gap-2"><p className="text-sm font-medium">{label}</p>
    {url && <audio ref={player} aria-label={label} controls src={url} onPlay={() => takeAudioFocus(player.current)} onError={() => setError("Couldn’t play this audio. Try loading it again.")} />}
    {!url && !error && <Spinner label="Loading audio…" />}
    {error && <><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Retry audio</Button></>}
  </div>;
}
