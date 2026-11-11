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
import { Banner, Button, Dialog, PageHead, Pill, Skeleton, Spinner } from "../components/ui";
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
    <div className="page">
      <PageHead
        back={<BackTo label="Practice" to="practice" />}
        title="Episodes"
        desc="Longer listening made from the sentences you studied, with new stories at your level. Pause and come back any time."
      />
      <div className="stack gap-5">
        {state === "loading" && <><Spinner label="Loading episodes…" /><Skeleton lines={4} /></>}
        {state === "error" && (
          <Banner tone="error" title="Episodes didn’t load" live="assertive" actions={<Button kind="secondary" onClick={reload}>Retry</Button>}>
            {error || "The server didn’t respond."} Your episodes and listening positions are safe.
          </Banner>
        )}
        {state === "ok" && data && (
          <>
            {cont && (
              <section className="panel stack gap-3" aria-labelledby="cont-h">
                <h2 id="cont-h" className="t-label">Continue listening</h2>
                <p lang="fr" className="t-section">{episodeTitle(cont)}</p>
                <p className="t-support num">Stopped at {fmtClock(pos(cont))} of {fmtClock(cont.duration ?? 0)}</p>
                <div className="btn-row">
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
              <ul className="list">
                {list.map((e) => (
                  <li key={e.id}>
                    <EpisodeRow e={e} position={pos(e)} onChanged={reload} />
                  </li>
                ))}
              </ul>
            )}
            <p className="t-meta">Episode time counts toward 1,000 hours while the audio plays, also with the screen locked. Listening on the go counts at half weight for your level.</p>
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
      <button className="list-btn" onClick={() => go(`practice/episodes/${e.id}`)}>
        <span className="grow stack gap-1">
          <span className="episode-title" lang="fr">{episodeTitle(e)}</span>
          {e.settings?.request && <span className="t-support">{e.settings.request}</span>}
          <span className="meta-row">
            {levelOf(e) && <span className="meta-chip">{levelOf(e)}</span>}
            {minutes && <span className="meta-chip num">{minutes}</span>}
            <span className="meta-chip">{status}</span>
          </span>
        </span>
        <ChevronRight aria-hidden className="chev" />
      </button>
    );
  }
  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      <span className="grow stack gap-1">
        <span className="row">
          <span className="t-strong">{episodeTitle(e)}</span>
          {e.status === "generating" ? <Pill tone="info">Being made…</Pill> : <Pill tone="error">Failed</Pill>}
        </span>
        {e.status === "generating" ? (
          <span className="t-support">This takes a few minutes. You can leave this page; it keeps going.</span>
        ) : (
          <span className="t-support">{e.error || "The episode couldn’t be made."}</span>
        )}
        {(levelOf(e) || minutes) && (
          <span className="meta-row">
            {levelOf(e) && <span className="meta-chip">{levelOf(e)}</span>}
            {minutes && <span className="meta-chip num">{minutes}</span>}
          </span>
        )}
      </span>
      {e.status === "failed" && (
        <Button
          kind="tertiary"
          className="btn--sm-text"
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
    <section className="panel stack gap-3" aria-labelledby="new-ep-h">
      <h2 id="new-ep-h" className="t-label">Make a new episode</h2>
      <div className="filter-bar">
        <label className="field" style={{ width: 160 }}>
          <span className="field-label">Level</span>
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value as EpisodeLevel)}>
            {data.levels.map((l) => (
              <option key={l} value={l}>{l}{l === data.recommended_level ? " (suggested)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 140 }}>
          <span className="field-label">Length</span>
          <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {data.lengths.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Topic or request (optional)</span>
        <input className="input" maxLength={500} value={request} placeholder="e.g. a job interview, the weather, a story set in Montréal" onChange={(e) => setRequest(e.target.value)} />
      </label>
      {phase === "failed" && (
        <Banner tone="error" title="The episode wasn’t started" live="assertive">{error || "The server didn’t respond."}</Banner>
      )}
      <div className="btn-row">
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
      <div className="page">
        <PageHead back={<BackTo label="Episodes" to="practice/episodes" />} title="Episode" />
        <Spinner label="Loading the episode…" />
        <Skeleton lines={4} />
      </div>
    );
  if (state === "error" || !e || e.status !== "ready")
    return (
      <div className="page">
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
    <div className="page">
      <PageHead
        back={<BackTo label="Episodes" to="practice/episodes" />}
        eyebrow={`Episode${levelOf(e) ? ` · ${levelOf(e)}` : ""} · ${minutesOf(e)} min`}
        title={title}
        desc={e.settings?.request || undefined}
      />
      <div className="stack gap-5">
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
        <section className="player" aria-label={`Episode player: ${title}`}>
          <div className="player-main">
            <Button
              kind={restore === "ask" && !mine ? "secondary" : "primary"}
              className="play-btn"
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
            <div className="grow stack gap-1" style={{ minWidth: 180 }}>
              <span className="t-strong">{statusText}</span>
              <span className="t-support num">{fmtClock(position)} / {fmtClock(duration)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(duration))}
                step={1}
                value={Math.round(position)}
                aria-label="Position in the episode"
                aria-valuetext={`${fmtClock(position)} of ${fmtClock(duration)}`}
                onChange={(ev) => seek(Number(ev.target.value))}
                style={{ width: "100%", accentColor: "var(--primary)" }}
              />
            </div>
            <div className="row gap-2">
              <Button kind="tertiary" className="btn--sm-text" onClick={() => seek(position - 15)} aria-label="Back 15 seconds">−15 s</Button>
              <Button kind="tertiary" className="btn--sm-text" onClick={() => seek(position + 15)} aria-label="Forward 15 seconds">+15 s</Button>
            </div>
            <label className="row gap-2">
              <span className="t-support">Speed</span>
              <select className="select" style={{ width: 92 }} value={mine?.speed ?? 1} disabled={!mine} onChange={(ev) => updatePlayer({ speed: Number(ev.target.value) })}>
                {[0.75, 1, 1.25, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
            </label>
            {mine && <Button kind="tertiary" onClick={stopPlayback}>Stop</Button>}
          </div>
          {mine?.status === "error" && (
            <Banner tone="error" title="The episode couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>
              Check your connection. Your position is kept.
            </Banner>
          )}
          <p className="t-support num">
            Played this time: {fmtClock(mine?.countedSeconds ?? 0)}. Episodes count as listening on the go: the time the audio really plays (at 2×, 10 minutes of audio is 5 minutes).
          </p>
        </section>

        <section className="stack gap-3" aria-labelledby="tr-h">
          <h2 id="tr-h" className="t-section">Transcript</h2>
          {cueState === "loading" && <Skeleton lines={3} />}
          {cueState === "error" && <Banner tone="warning" title="The transcript didn’t load">The audio still works.</Banner>}
          {cueState === "ok" && cues && (
            <ol className="list">
              {cues.map((c, i) => (
                <li key={`${c.at}-${i}`}>
                  <button
                    className="list-btn"
                    onClick={() => seek(c.at)}
                    aria-current={i === current ? "true" : undefined}
                    style={i === current ? { background: "var(--primary-weak)" } : undefined}
                  >
                    <span className="t-meta num" style={{ width: 52, flexShrink: 0 }}>{fmtClock(c.at)}</span>
                    <span className="grow stack">
                      <span lang="fr">{c.text}</span>
                      {c.sub && <span className="t-support">{c.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="btn-row" aria-label="Episode files">
          <a className="btn btn--secondary" href={episodeFileUrl(e.id, "mp3")} download><Download aria-hidden /> MP3</a>
          <a className="btn btn--tertiary" href={episodeFileUrl(e.id, "lrc")} download>Lyrics (LRC)</a>
          <a className="btn btn--tertiary" href={episodeFileUrl(e.id, "srt")} download>Subtitles (SRT)</a>
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
