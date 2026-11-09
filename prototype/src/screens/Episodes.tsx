import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, ChevronRight, CloudOff } from "lucide-react";
import { EPISODES } from "../data/fixtures";
import { fmtClock } from "../lib/format";
import { announce, go, retryPlayback, set, simulate, startPlayback, stopPlayback, updatePlayer, useApp } from "../state/store";
import { Banner, Button, DemoNote, PageHead, Pill, Skeleton, Spinner } from "../components/ui";
import { BackTo } from "./Practice";

/* SCR-EPI-01 */
export function EpisodeList() {
  const forced = useApp((s) => s.ss["SCR-EPI-01"]);
  const offline = useApp((s) => s.offline);
  const positions = useApp((s) => s.episodePositions);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [n, setN] = useState(0);
  useEffect(() => {
    setLoad("loading");
    let live = true;
    simulate("episodes", 600, true, { needsNetwork: false }).then(() => live && setLoad("ok")).catch(() => live && setLoad("error"));
    return () => {
      live = false;
    };
  }, [n]);
  const state = forced || (load !== "ok" ? load : offline ? "offline" : "ok");
  const list = state === "empty" ? [] : EPISODES;
  const pos = (id: string) => positions[id] ?? EPISODES.find((e) => e.id === id)!.position;
  const cont = list.find((e) => e.available && pos(e.id) > 0 && pos(e.id) < e.durationSeconds);
  return (
    <div className="page">
      <PageHead back={<BackTo label="Practice" to="practice" />} title="Episodes" desc="Continuous listening: longer audio you can pause and come back to. Time counts toward 1,000 hours only while audio plays." />
      <div className="stack gap-5">
        <p className="row"><DemoNote>Background and lock-screen playback: capability not verified.</DemoNote></p>
        {state === "loading" && <><Spinner label="Loading episodes…" /><Skeleton lines={4} /></>}
        {state === "error" && <Banner tone="error" title="Episodes didn’t load" live="assertive" actions={<Button kind="secondary" onClick={() => setN(n + 1)}>Retry</Button>}>Your listening positions are safe.</Banner>}
        {state === "empty" && <Banner tone="neutral" title="No episodes in your list yet">New episodes will appear here. Meanwhile, try Listen for guided clips.</Banner>}
        {state === "offline" && (
          <Banner tone="warning" title="Showing episode details saved on this device">
            <span className="row"><CloudOff aria-hidden width={16} height={16} /> You’re offline (simulated). Titles and positions are cached; audio needs a connection.</span>
          </Banner>
        )}
        {(state === "ok" || state === "offline") && (
          <>
            {cont && (
              <section className="panel stack gap-3" aria-labelledby="cont-h">
                <h2 id="cont-h" className="t-label">Continue listening</h2>
                <p lang="fr" className="t-section">{cont.title}</p>
                <p className="t-support num">Stopped at {fmtClock(pos(cont.id))} of {fmtClock(cont.durationSeconds)}</p>
                <div className="btn-row">
                  <Button kind="primary" icon={<Play aria-hidden />} onClick={() => go(`practice/episodes/${cont.id}`)} disabledReason={state === "offline" ? "Audio needs a connection." : undefined}>Continue</Button>
                </div>
              </section>
            )}
            <ul className="list">
              {list.map((e) => {
                const p = pos(e.id);
                const status = !e.available ? "Unavailable" : p >= e.durationSeconds ? "Finished" : p > 0 ? `Continue at ${fmtClock(p)}` : "Not started";
                return (
                  <li key={e.id}>
                    <button className="list-btn" onClick={() => go(`practice/episodes/${e.id}`)}>
                      <span className="grow stack gap-1">
                        <span className="row"><span lang="fr" className="t-strong">{e.title}</span><Pill>{e.level}</Pill></span>
                        <span className="t-support">{e.desc}</span>
                        <span className="t-meta num">{Math.round(e.durationSeconds / 60)} min · {status}</span>
                      </span>
                      <ChevronRight aria-hidden className="chev" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* SCR-EPI-02 */
export function EpisodePlayer({ id }: { id: string }) {
  const e = EPISODES.find((x) => x.id === id) ?? EPISODES[0];
  const forced = useApp((s) => s.ss["SCR-EPI-02"]);
  const offline = useApp((s) => s.offline);
  const p = useApp((s) => s.player);
  const saved = useApp((s) => s.episodePositions[e.id]);
  const start0 = saved ?? e.position;
  const mine = p?.owner.episodeId === e.id ? p : null;
  const [restore, setRestore] = useState<"ask" | "failed" | "done">(start0 > 0 && start0 < e.durationSeconds ? "ask" : "done");
  const [sync, setSync] = useState<"ok" | "failed" | "retrying">("ok");
  const [demoCount, setDemoCount] = useState<string | null>(null);
  useEffect(() => {
    if (forced === "restore-failed") setRestore("failed");
    if (forced === "sync-failed") setSync("failed");
    if (forced === "buffering" && mine) updatePlayer({ status: "buffering" });
  }, [forced]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (from: number) => startPlayback({ kind: "episode", label: `Episode: ${e.title}`, route: `practice/episodes/${e.id}`, episodeId: e.id }, e.durationSeconds, { position: from });
  const statusText = mine ? { loading: "Loading…", playing: "Playing", paused: "Paused", ended: "Ended", error: "Couldn’t play", buffering: "Buffering… (not counted)" }[mine.status] : "Not playing";

  if (!e.available)
    return (
      <div className="page">
        <PageHead back={<BackTo label="Episodes" to="practice/episodes" />} title={e.title} />
        <Banner tone="warning" title="This episode isn’t available">Its audio isn’t included in this demo. Your other episodes and positions are unaffected.</Banner>
      </div>
    );
  return (
    <div className="page">
      <PageHead back={<BackTo label="Episodes" to="practice/episodes" />} eyebrow={`Episode · ${e.level} · ${Math.round(e.durationSeconds / 60)} min`} title={e.title} desc={e.desc} />
      <div className="stack gap-5">
        {restore === "ask" && !mine && (
          <Banner tone="info" title={`Continue from ${fmtClock(start0)}?`} actions={<><Button kind="primary" onClick={() => { setRestore("done"); play(start0); }}>Continue from {fmtClock(start0)}</Button><Button kind="secondary" onClick={() => { setRestore("done"); play(0); }}>Start from the beginning</Button></>}>
            Your listening position was restored.
          </Banner>
        )}
        {restore === "failed" && (
          <Banner tone="error" title="Couldn’t restore your position" live="assertive" actions={<><Button kind="secondary" onClick={() => setRestore("ask")}>Retry</Button><Button kind="tertiary" onClick={() => { setRestore("done"); play(0); }}>Start from 0:00</Button></>}>
            Your listening time so far is safe.
          </Banner>
        )}
        <section className="player" aria-label={`Episode player: ${e.title}`}>
          <div className="player-main">
            <Button
              kind={restore === "ask" && !mine ? "secondary" : "primary"}
              className="play-btn"
              iconOnly
              aria-label={`${mine?.status === "playing" ? "Pause" : mine?.status === "error" ? "Retry" : "Play"} episode ${e.title}`}
              busy={mine?.status === "loading"}
              disabledReason={offline ? "Audio needs a connection." : undefined}
              icon={mine?.status === "playing" || mine?.status === "buffering" ? <Pause aria-hidden /> : mine?.status === "error" ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
              onClick={() => {
                if (!mine) { setRestore("done"); return play(start0 >= e.durationSeconds ? 0 : start0); }
                if (mine.status === "playing" || mine.status === "buffering") return updatePlayer({ status: "paused" });
                if (mine.status === "error") return retryPlayback();
                updatePlayer({ status: "playing", position: mine.status === "ended" ? 0 : mine.position });
              }}
            />
            <div className="grow stack gap-1" style={{ minWidth: 180 }}>
              <span className="t-strong">{statusText}</span>
              <span className="t-support num">{fmtClock(mine?.position ?? start0)} / {fmtClock(e.durationSeconds)}</span>
              <div className="progress-track" aria-hidden><div className="progress-fill" style={{ width: `${((mine?.position ?? start0) / e.durationSeconds) * 100}%` }} /></div>
            </div>
            <label className="row gap-2">
              <span className="t-support">Speed</span>
              <select className="select" style={{ width: 92 }} value={mine?.speed ?? 1} disabled={!mine} onChange={(ev) => updatePlayer({ speed: Number(ev.target.value) })}>
                {[0.75, 1, 1.25, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
            </label>
            {mine && <Button kind="tertiary" onClick={stopPlayback}>Stop</Button>}
          </div>
          {mine?.status === "error" && <Banner tone="error" title="The episode couldn’t play" live="assertive" actions={<Button kind="secondary" onClick={retryPlayback}>Retry</Button>}>Your position is kept.</Banner>}
          <p className="t-support num">
            Counted toward 1,000 h this session: {fmtClock(mine?.countedSeconds ?? 0)} (wall-clock playing time) · Audio advanced: {fmtClock(mine?.contentSeconds ?? 0)}
          </p>
          <p className="row t-meta">Canadian French · Demo voice <DemoNote>Simulated audio</DemoNote></p>
        </section>

        {sync !== "ok" && (
          <Banner tone="error" title="Your listening position didn’t sync" live="assertive" actions={<Button kind="secondary" busy={sync === "retrying"} onClick={() => { setSync("retrying"); simulate("sync", 900, true).then(() => { setSync("ok"); announce("Position synced."); }).catch(() => setSync("failed")); }}>Retry sync</Button>}>
            It’s saved on this device. Counted time isn’t lost.
          </Banner>
        )}

        <section className="panel stack gap-3" aria-labelledby="count-demo-h">
          <h2 id="count-demo-h" className="t-label">How speed affects counted time</h2>
          <p>10 minutes of audio played at 2× takes 5 minutes of your time, so it counts as 5 minutes.</p>
          <div className="btn-row">
            <Button
              kind="secondary"
              onClick={() => {
                set((s) => ({
                  audioStats: { ...s.audioStats, todaySeconds: s.audioStats.todaySeconds + 300, weekSeconds: s.audioStats.weekSeconds + 300 },
                  history: { ...s.history, audio: [{ id: `u-demo-${Date.now()}`, date: "Mar 4", owner: `Episode · ${e.title}`, contentSeconds: 600, speed: 2, countedSeconds: 300 }, ...s.history.audio] },
                }));
                setDemoCount("Added: 10:00 of audio at 2× → 5:00 counted. See Progress or History.");
                announce("Simulated 10 minutes at 2 times speed. 5 minutes counted.");
              }}
            >
              Simulate 10 min at 2×
            </Button>
            <Button kind="tertiary" onClick={() => go("progress")}>View Progress</Button>
          </div>
          {demoCount && <p className="t-support" role="status">{demoCount}</p>}
          <p className="t-meta">Demo shortcut — it adds a fictional session instead of waiting 5 minutes.</p>
        </section>

        <section className="stack gap-3" aria-labelledby="tr-h">
          <h2 id="tr-h" className="t-section">Transcript</h2>
          <ol className="list">
            {e.transcript.map((t) => (
              <li key={t.at} className="list-row" style={{ alignItems: "flex-start" }}>
                <span className="t-meta num" style={{ width: 44 }}>{fmtClock(t.at)}</span>
                <span className="grow stack">
                  <span lang="fr">{t.fr}</span>
                  <span className="t-support">{t.en}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
