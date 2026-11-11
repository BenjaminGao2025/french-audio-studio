import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { ApiError } from "../api/client";
import {
  createEpisode,
  deleteEpisode,
  episodeAudioUrl,
  episodeFileUrl,
  episodeTitle,
  listEpisodes,
  loadTranscript,
  savePosition,
  savedPositions,
  type Cue,
  type EpisodeLevel,
  type EpisodeList as EpisodeListData,
  type ServerEpisode,
} from "../api/episodes";
import { audioJumped } from "../api/time";
import { fmtClock } from "../lib/format";
import { announce, go, retryPlayback, startPlayback, stopPlayback, updatePlayer, useApp } from "../state/store";
import { Banner, Button, ChoiceSelect, Dialog, Input, PageHead, Pill, Skeleton, Spinner } from "../components/ui";
import { Slider } from "../components/ui/slider";
import { Button as StockButton } from "../components/ui/button";
import { BackTo } from "./Practice";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "");

/* The list is shared by the list and the player, so opening an episode doesn't fetch it again. */
let cached: EpisodeListData | null = null;

function useEpisodes() {
  const [data, setData] = useState<EpisodeListData | null>(cached);
  const [state, setState] = useState<"loading" | "ok" | "error">(cached ? "ok" : "loading");
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (!cached) setState("loading");
    listEpisodes()
      .then((d) => {
        cached = d;
        if (!live) return;
        setData(d);
        setState("ok");
      })
      .catch((e) => {
        if (!live) return;
        setError(errText(e));
        setState(cached ? "ok" : "error");
      });
    return () => {
      live = false;
    };
  }, [n]);
  return { data, state, error, reload: () => setN((x) => x + 1) };
}

/** Test helper. */
export function resetEpisodeCache() {
  cached = null;
}

const levelOf = (e: ServerEpisode) => e.settings?.level ?? "";
const minutesOf = (e: ServerEpisode) => Math.round((e.duration ?? (e.settings?.minutes ?? 0) * 60) / 60);

/* SCR-EPI-01 */
export function EpisodeList() {
  const { data, state, error, reload } = useEpisodes();
  const positions = savedPositions();
  const list = data?.episodes ?? [];
  const generating = list.some((e) => e.status === "generating");
  // While an episode is being made, look again every 15 seconds.
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [generating]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: ServerEpisode) => positions[e.id] ?? 0;
  const cont = list.find((e) => e.status === "ready" && pos(e) > 5 && pos(e) < (e.duration ?? 0) - 5);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Episodes"
      />
      <div className="flex flex-col gap-6">
        {state === "loading" && <><Spinner label="Loading episodes…" /><Skeleton lines={4} /></>}
        {state === "error" && (
          <Banner tone="error" title="Episodes didn’t load" live="assertive" actions={<Button kind="secondary" onClick={reload}>Retry</Button>}>
            {error || "The server didn’t respond."} Your episodes and listening positions are safe.
          </Banner>
        )}
        {state === "ok" && data && (
          <>
            {cont && (
              <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-labelledby="cont-h">
                <h2 id="cont-h" className="text-sm font-medium">Continue listening</h2>
                <p lang="fr" className="text-lg font-semibold text-balance">{episodeTitle(cont)}</p>
                <p className="text-sm text-muted-foreground tabular-nums">Stopped at {fmtClock(pos(cont))} of {fmtClock(cont.duration ?? 0)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button kind="primary" icon={<Play aria-hidden />} onClick={() => go(`practice/episodes/${cont.id}`)}>Continue</Button>
                </div>
              </section>
            )}
            <NewEpisode data={data} busy={generating} onCreated={reload} />
            {list.length === 0 ? (
              <Banner tone="neutral" title="No episodes yet">
                Make your first one above. It uses the sentences you saved and analysed, so study a few texts first for a better episode.
              </Banner>
            ) : (
              <ul className="divide-y overflow-hidden rounded-lg border">
                {list.map((e) => (
                  <li key={e.id}>
                    <EpisodeRow e={e} position={pos(e)} onChanged={reload} />
                  </li>
                ))}
              </ul>
            )}

          </>
        )}
      </div>
    </div>
  );
}

function EpisodeRow({ e, position, onChanged }: { e: ServerEpisode; position: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const minutes = e.status === "ready" ? `${minutesOf(e)} min` : e.settings?.minutes ? `${e.settings.minutes} min requested` : "";
  if (e.status === "ready") {
    const d = e.duration ?? 0;
    const status = position >= d - 5 && d > 0 ? "Finished" : position > 5 ? `Continue at ${fmtClock(position)}` : "Not started";
    return (
      <Button kind="tertiary" className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left" onClick={() => go(`practice/episodes/${e.id}`)}>
        <span className="min-w-0 flex-1 flex flex-col gap-1">
          <span className="font-serif text-xl leading-snug" lang="fr">{episodeTitle(e)}</span>
          {e.settings?.request && <span className="text-sm text-muted-foreground">{e.settings.request}</span>}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {levelOf(e) && <span className="inline-flex items-baseline gap-1.5 text-sm">{levelOf(e)}</span>}
            {minutes && <span className="inline-flex items-baseline gap-1.5 text-sm tabular-nums">{minutes}</span>}
            <span className="inline-flex items-baseline gap-1.5 text-sm">{status}</span>
          </span>
        </span>
        <ChevronRight aria-hidden />
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ alignItems: "flex-start" }}>
      <span className="min-w-0 flex-1 flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{episodeTitle(e)}</span>
          {e.status === "generating" ? <Pill tone="info">Being made…</Pill> : <Pill tone="error">Failed</Pill>}
        </span>
        {e.status === "generating" ? (
          <span className="text-sm text-muted-foreground">This takes a few minutes. You can leave this page; it keeps going.</span>
        ) : (
          <span className="text-sm text-muted-foreground">{e.error || "The episode couldn’t be made."}</span>
        )}
        {(levelOf(e) || minutes) && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {levelOf(e) && <span className="inline-flex items-baseline gap-1.5 text-sm">{levelOf(e)}</span>}
            {minutes && <span className="inline-flex items-baseline gap-1.5 text-sm tabular-nums">{minutes}</span>}
          </span>
        )}
      </span>
      {e.status === "failed" && (
        <Button
          kind="tertiary"
          className="h-8 px-2 text-sm"
          icon={<Trash2 aria-hidden />}
          busy={busy}
          onClick={() => {
            setBusy(true);
            deleteEpisode(e.id)
              .then(() => {
                announce("Failed episode removed.");
                onChanged();
              })
              .catch(() => announce("Couldn’t remove the episode.", true))
              .finally(() => setBusy(false));
          }}
        >
          Remove
        </Button>
      )}
    </div>
  );
}

function NewEpisode({ data, busy, onCreated }: { data: EpisodeListData; busy: boolean; onCreated: () => void }) {
  const [level, setLevel] = useState<EpisodeLevel>(data.recommended_level);
  const [minutes, setMinutes] = useState(data.lengths[0] ?? 20);
  const [request, setRequest] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "failed">("idle");
  const [error, setError] = useState("");
  const submit = () => {
    setPhase("sending");
    createEpisode({ level, minutes, request: request.trim() })
      .then(() => {
        setPhase("idle");
        setRequest("");
        announce("Your episode is being made. It appears in the list when it’s ready.");
        onCreated();
      })
      .catch((e) => {
        setError(errText(e));
        setPhase("failed");
      });
  };
  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-labelledby="new-ep-h">
      <h2 id="new-ep-h" className="text-sm font-medium">Make a new episode</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2" style={{ width: 160 }}>
          <span className="text-sm font-medium">Level</span>
          <ChoiceSelect
            ariaLabel="Level"
            value={level}
            onValueChange={(v) => setLevel(v as EpisodeLevel)}
            options={data.levels.map((l) => ({ value: l, label: `${l}${l === data.recommended_level ? " (suggested)" : ""}` }))}
          />
        </label>
        <label className="grid gap-2" style={{ width: 140 }}>
          <span className="text-sm font-medium">Length</span>
          <ChoiceSelect
            ariaLabel="Length"
            value={String(minutes)}
            onValueChange={(v) => setMinutes(Number(v))}
            options={data.lengths.map((m) => ({ value: String(m), label: `${m} min` }))}
          />
        </label>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Topic or request (optional)</span>
        <Input maxLength={500} value={request} placeholder="Topic" onChange={(e) => setRequest(e.target.value)} />
      </label>
      {phase === "failed" && (
        <Banner tone="error" title="The episode wasn’t started" live="assertive">{error || "The server didn’t respond."}</Banner>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button kind="primary" busy={phase === "sending"} onClick={submit} disabledReason={busy ? "An episode is already being made. Wait for it to finish." : undefined}>
          Make episode
        </Button>
      </div>
    </section>
  );
}

/* SCR-EPI-02 */
export function EpisodePlayer({ id }: { id: string }) {
  const { data, state, error, reload } = useEpisodes();
  const e = data?.episodes.find((x) => x.id === id);
  if (state === "loading")
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHead back={<BackTo label="Episodes" to="practice/episodes" />} title="Episode" />
        <Spinner label="Loading the episode…" />
        <Skeleton lines={4} />
      </div>
    );
  if (state === "error" || !e || e.status !== "ready")
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHead back={<BackTo label="Episodes" to="practice/episodes" />} title={e ? episodeTitle(e) : "Episode"} />
        {state === "error" ? (
          <Banner tone="error" title="The episode didn’t load" live="assertive" actions={<Button kind="secondary" onClick={reload}>Retry</Button>}>{error || "The server didn’t respond."}</Banner>
        ) : (
          <Banner tone="warning" title={e ? "This episode isn’t ready" : "This episode isn’t in your list"} actions={<Button kind="secondary" onClick={() => go("practice/episodes")}>All episodes</Button>}>
            {e?.status === "generating" ? "It’s still being made." : e?.status === "failed" ? e.error || "It couldn’t be made." : "It may have been replaced or removed."}
          </Banner>
        )}
      </div>
    );
  return <Player e={e} />;
}

function Player({ e }: { e: ServerEpisode }) {
  const title = episodeTitle(e);
  const duration = e.duration ?? 0;
  const p = useApp((s) => s.player);
  const mine = p?.owner.episodeId === e.id ? p : null;
  const [start0] = useState(() => savedPositions()[e.id] ?? 0);
  const resumable = start0 > 5 && start0 < duration - 5;
  const [restore, setRestore] = useState<"ask" | "done">(resumable ? "ask" : "done");
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [cueState, setCueState] = useState<"loading" | "ok" | "error">("loading");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastSaved = useRef(start0);

  useEffect(() => {
    let live = true;
    setCueState("loading");
    loadTranscript(e.id)
      .then((c) => {
        if (!live) return;
        setCues(c);
        setCueState("ok");
      })
      .catch(() => live && setCueState("error"));
    return () => {
      live = false;
    };
  }, [e.id]);

  // Keep the position on this device after every 5 seconds of movement, and on pause or end.
  const position = mine?.position ?? start0;
  useEffect(() => {
    if (!mine) return;
    if (Math.abs(mine.position - lastSaved.current) >= 5 || mine.status === "ended" || mine.status === "paused") {
      savePosition(e.id, mine.status === "ended" ? duration : mine.position);
      lastSaved.current = mine.position;
    }
  }, [mine?.position, mine?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (from: number) =>
    startPlayback({ kind: "episode", label: `Episode: ${title}`, route: `practice/episodes/${e.id}`, episodeId: e.id }, duration, { position: from, src: episodeAudioUrl(e.id) });
  const seek = (to: number) => {
    const t = Math.max(0, Math.min(duration, to));
    setRestore("done");
    if (!mine) return play(t);
    updatePlayer({ position: t });
    audioJumped();
    savePosition(e.id, t);
    lastSaved.current = t;
  };
  const statusText = mine ? { loading: "Loading…", playing: "Playing", paused: "Paused", ended: "Ended", error: "Couldn’t play", buffering: "Buffering…" }[mine.status] : "Not playing";
  const current = cues ? cues.reduce((acc, c, i) => (c.at <= position ? i : acc), -1) : -1;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead
        back={<BackTo label="Episodes" to="practice/episodes" />}
        eyebrow={`Episode${levelOf(e) ? ` · ${levelOf(e)}` : ""} · ${minutesOf(e)} min`}
        title={title}
        desc={e.settings?.request || undefined}
      />
      <div className="flex flex-col gap-6">
        {restore === "ask" && !mine && (
          <Banner
            tone="info"
            title={`Continue from ${fmtClock(start0)}?`}
            actions={
              <>
                <Button kind="primary" onClick={() => { setRestore("done"); play(start0); }}>Continue from {fmtClock(start0)}</Button>
                <Button kind="secondary" onClick={() => { setRestore("done"); play(0); }}>Start from the beginning</Button>
              </>
            }
          >
            Your listening position on this device was restored.
          </Banner>
        )}
        <section className="flex flex-col gap-2" aria-label={`Episode player: ${title}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind={restore === "ask" && !mine ? "secondary" : "primary"}
              className=""
              iconOnly
              aria-label={`${mine?.status === "playing" ? "Pause" : mine?.status === "error" ? "Retry" : "Play"} episode ${title}`}
              busy={mine?.status === "loading"}
              icon={mine?.status === "playing" || mine?.status === "buffering" ? <Pause aria-hidden /> : mine?.status === "error" ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
              onClick={() => {
                if (!mine) {
                  setRestore("done");
                  return play(start0 >= duration - 5 ? 0 : start0);
                }
                if (mine.status === "playing" || mine.status === "buffering") return updatePlayer({ status: "paused" });
                if (mine.status === "error") return retryPlayback();
                updatePlayer({ status: "playing", position: mine.status === "ended" ? 0 : mine.position });
              }}
            />
            <div className="min-w-0 flex-1 flex flex-col gap-1" style={{ minWidth: 180 }}>
              <span className="font-medium">{statusText}</span>
              <span className="text-sm text-muted-foreground tabular-nums">{fmtClock(position)} / {fmtClock(duration)}</span>
              <Slider
                min={0}
                max={Math.max(1, Math.round(duration))}
                step={1}
                value={[Math.round(position)]}
                aria-label="Position in the episode"
                aria-valuetext={`${fmtClock(position)} of ${fmtClock(duration)}`}
                onValueChange={([v]) => seek(v)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 gap-2">
              <Button kind="tertiary" className="h-8 px-2 text-sm" onClick={() => seek(position - 15)} aria-label="Back 15 seconds">−15 s</Button>
              <Button kind="tertiary" className="h-8 px-2 text-sm" onClick={() => seek(position + 15)} aria-label="Forward 15 seconds">+15 s</Button>
            </div>
            <label className="flex flex-wrap items-center gap-2 gap-2">
              <span className="text-sm text-muted-foreground">Speed</span>
              <ChoiceSelect
                ariaLabel="Speed"
                className="w-[5.5rem]"
                value={String(mine?.speed ?? 1)}
                disabled={!mine}
                onValueChange={(v) => updatePlayer({ speed: Number(v) })}
                options={[0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: String(v), label: `${v}×` }))}
              />
            </label>
            {mine && <Button kind="tertiary" onClick={stopPlayback}>Stop</Button>}
          </div>
          {mine?.status === "error" && (
            <Banner tone="error" title="The episode couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>
              Check your connection. Your position is kept.
            </Banner>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Played this time: {fmtClock(mine?.countedSeconds ?? 0)}. Episodes count as listening on the go: the time the audio really plays (at 2×, 10 minutes of audio is 5 minutes).
          </p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="tr-h">
          <h2 id="tr-h" className="text-lg font-semibold text-balance">Transcript</h2>
          {cueState === "loading" && <Skeleton lines={3} />}
          {cueState === "error" && <Banner tone="warning" title="The transcript didn’t load">The audio still works.</Banner>}
          {cueState === "ok" && cues && (
            <ol className="divide-y overflow-hidden rounded-lg border">
              {cues.map((c, i) => (
                <li key={`${c.at}-${i}`}>
                  <Button
                    kind="tertiary"
                    className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                    onClick={() => seek(c.at)}
                    aria-current={i === current ? "true" : undefined}
                  >
                    <span className="text-xs leading-4 text-muted-foreground tabular-nums" style={{ width: 52, flexShrink: 0 }}>{fmtClock(c.at)}</span>
                    <span className="min-w-0 flex-1 flex flex-col">
                      <span lang="fr">{c.text}</span>
                      {c.sub && <span className="text-sm text-muted-foreground">{c.sub}</span>}
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex flex-wrap items-center gap-2" aria-label="Episode files">
          <StockButton variant="outline" asChild><a href={episodeFileUrl(e.id, "mp3")} download><Download aria-hidden /> MP3</a></StockButton>
          <StockButton variant="ghost" asChild><a href={episodeFileUrl(e.id, "lrc")} download>Lyrics (LRC)</a></StockButton>
          <StockButton variant="ghost" asChild><a href={episodeFileUrl(e.id, "srt")} download>Subtitles (SRT)</a></StockButton>
          <Button kind="tertiary" icon={<Trash2 aria-hidden />} style={{ color: "var(--error)" }} onClick={() => setConfirmDelete(true)}>Delete episode</Button>
        </section>
        {confirmDelete && (
          <Dialog
            title="Delete this episode?"
            onClose={() => !deleting && setConfirmDelete(false)}
            dismissible={!deleting}
            footer={
              <>
                <Button kind="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} data-autofocus>Cancel</Button>
                <Button
                  kind="destructive"
                  busy={deleting}
                  onClick={() => {
                    setDeleting(true);
                    if (mine) stopPlayback();
                    deleteEpisode(e.id)
                      .then(() => {
                        cached = null;
                        announce("Episode deleted.");
                        go("practice/episodes");
                      })
                      .catch(() => {
                        setDeleting(false);
                        announce("Couldn’t delete the episode. It’s still in your list.", true);
                      });
                  }}
                >
                  Delete episode
                </Button>
              </>
            }
          >
            <p>The audio and its transcript are removed. Listening time you already earned stays in your 1,000 hours.</p>
          </Dialog>
        )}
      </div>
    </div>
  );
}
