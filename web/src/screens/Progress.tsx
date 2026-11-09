import { ChevronLeft, History as HistoryIcon, Info } from "lucide-react";
import { REFERENCE_DATE } from "../data/fixtures";
import { fmtDate, fmtDuration, nf } from "../lib/format";
import { GOAL_HOURS, countedMinutesFor, pace } from "../lib/progress";
import { go, syncChange, useApp } from "../state/store";
import { Banner, Button, DemoNote, PageHead, Pill } from "../components/ui";

export function ProgressScreen({ sub }: { sub?: string }) {
  if (sub === "devices") return <Devices />;
  return <Overview />;
}

function Overview() {
  const stats = useApp((s) => s.audioStats);
  const forced = useApp((s) => s.ss["SCR-PRO-01"]);
  const sync = useApp((s) => s.sync);
  const state = forced || (sync === "error" ? "syncfail" : "active");

  let lifetime = stats.lifetimeHours;
  let last28 = stats.last28Hours;
  let todayMin = stats.todaySeconds / 60;
  let weekMin = stats.weekSeconds / 60;
  if (state === "nodata") [lifetime, last28, todayMin, weekMin] = [0, 0, 0, 0];
  if (state === "nopace") [last28, todayMin, weekMin] = [0, 0, 0];
  if (state === "reached") lifetime = 1003.5;
  const p = pace(lifetime, last28, REFERENCE_DATE);
  const pct = Math.min(100, (lifetime / GOAL_HOURS) * 100);

  return (
    <div className="page">
      <PageHead
        title="Progress"
        desc="Your listening time toward 1,000 hours. Only time while audio is actually playing counts."
        actions={<Button kind="tertiary" icon={<HistoryIcon aria-hidden />} onClick={() => go("progress/history?tab=audio")}>History</Button>}
      />
      <div className="stack gap-6">
        <p className="row t-support"><DemoNote>All numbers on this page are simulated for the prototype.</DemoNote></p>

        {state === "unavailable" && (
          <Banner tone="error" title="Statistics are unavailable right now" live="assertive" actions={<Button kind="secondary" onClick={() => go("progress")}>Retry</Button>}>
            Your listening time is safe. This is a simulated loading problem.
          </Banner>
        )}
        {state === "pending" && (
          <Banner tone="info" title="Recent listening is still syncing" live="polite">Today’s numbers may go up once your other device syncs (simulated). Totals never go down because of a delay.</Banner>
        )}
        {state === "syncfail" && (
          <Banner tone="error" title="Couldn’t sync recent listening" actions={<Button kind="secondary" onClick={syncChange}>Retry sync</Button>}>
            Time from this device is kept and will be added after sync.
          </Banner>
        )}

        {state !== "unavailable" && (
          <>
            <section className="stack gap-4" aria-labelledby="goal-h">
              <h2 id="goal-h" className="sr-only">Goal</h2>
              <div className="stack gap-1">
                <span className="t-support">Lifetime audio time</span>
                <span className="t-figure">{lifetime === 0 ? "0 h" : fmtDuration(lifetime * 60)}</span>
                <span className="t-support">of {nf.format(GOAL_HOURS)} hours</span>
              </div>
              <div className="goal-bar" role="img" aria-label={`${pct.toFixed(1)} percent of the 1,000-hour goal`}><div style={{ width: `${pct}%` }} /></div>
              {state === "reached" && (
                <Banner tone="success" title="You’ve reached 1,000 hours">Your lifetime total keeps counting — it isn’t reset.</Banner>
              )}
              {state === "nodata" && (
                <Banner tone="neutral" title="No listening time yet" actions={<Button kind="secondary" onClick={() => go("practice/episodes")}>Open Episodes</Button>}>
                  Play an episode or a sentence and your time will appear here.
                </Banner>
              )}
            </section>

            <dl className="figure-grid">
              {[
                ["Today", fmtDuration(todayMin), "Since local midnight"],
                ["This week", fmtDuration(weekMin), "Since Monday"],
                ["Remaining to 1,000 hours", p.remainingHours === 0 ? "0 h" : fmtDuration(p.remainingHours * 60), "Goal minus lifetime"],
                ["Four-week daily average", fmtDuration(p.dailyAverageMinutes), `${fmtDuration(last28 * 60)} in the last 28 calendar days`],
              ].map(([k, v, sub]) => (
                <div key={k} className="stat">
                  <dt className="t-support">{k}</dt>
                  <dd className="t-section num" style={{ margin: 0 }}>{v}</dd>
                  <dd className="t-meta" style={{ margin: 0 }}>{sub}</dd>
                </div>
              ))}
            </dl>

            <section className="panel stack gap-2" aria-labelledby="eta-h">
              <h2 id="eta-h" className="t-label">Estimated completion</h2>
              {p.remainingHours === 0 ? (
                <p>Goal reached. No estimate needed.</p>
              ) : p.etaDays === null ? (
                <p>No estimate yet — there’s no listening in the last 28 days to base a pace on.</p>
              ) : (
                <>
                  <p className="t-section">About {nf.format(p.etaDays)} days at this pace</p>
                  <p className="t-support">Around {fmtDate(p.etaDate!)}, counting from the prototype’s reference date ({fmtDate(REFERENCE_DATE)}). This is an estimate, not a promise.</p>
                </>
              )}
            </section>
          </>
        )}

        <section className="stack gap-3" aria-labelledby="rules-h">
          <h2 id="rules-h" className="t-section">What counts</h2>
          <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
            <li>Only wall-clock time while audio is playing. 10 minutes of audio at 2× counts as {countedMinutesFor(10, 2)} minutes.</li>
            <li>Paused, buffering, stopped or closed audio counts as zero.</li>
            <li>Reading, typing, reviewing and waiting don’t add time. An open page alone never counts.</li>
            <li>Replays count the new time you actually play. Overlapping playback on your account counts once.</li>
            <li>Days split at local midnight; weeks start on Monday. A time zone change affects future days only.</li>
          </ul>
        </section>

        <section className="stack gap-2" aria-labelledby="fg-h">
          <h2 id="fg-h" className="t-section">Background listening</h2>
          <Banner tone="warning" title="Foreground only">
            On this device, only foreground playback is counted (while this tab is hidden, playback keeps its position and 0 seconds are counted). Background and lock-screen counting are not yet supported.
          </Banner>
          <p className="row t-support">
            <DemoNote>Proposed capability states only; device support has not been verified.</DemoNote>
            <Button kind="tertiary" className="btn--sm-text" onClick={() => go("progress/devices")}>Device support</Button>
          </p>
        </section>
      </div>
    </div>
  );
}

/* SCR-PRO-02 */
function Devices() {
  const rows: [string, string, string, string, string][] = [
    ["Web browser", "Prototype simulation", "Unverified", "Unverified", "Counted in the foreground only"],
    ["iPhone", "Proposed · unverified", "Proposed · unverified", "Proposed · unverified", "Not yet supported"],
    ["Mac", "Proposed · unverified", "Proposed · unverified", "Proposed · unverified", "Not yet supported"],
  ];
  return (
    <div className="page">
      <PageHead
        back={<Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go("progress")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Progress</Button>}
        title="Device support"
        desc="Playback continuing and time being counted are separate questions. Nothing here has been tested on a real device."
      />
      <div className="stack gap-5">
        <Banner tone="warning" title="Foreground only">On this device, only foreground playback is counted (while this tab is hidden, playback keeps its position and 0 seconds are counted). Background and lock-screen counting are not yet supported.</Banner>
        <div className="table-wrap">
          <table className="matrix">
            <caption className="sr-only">Proposed playback and counting support by platform</caption>
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">Foreground playback</th>
                <th scope="col">Playback continues in background</th>
                <th scope="col">Lock-screen controls</th>
                <th scope="col">Background time counted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  <th scope="row">{r[0]}</th>
                  {r.slice(1).map((c, i) => (
                    <td key={i}>
                      <Pill tone={c.startsWith("Prototype") ? "info" : c.startsWith("Counted") ? "info" : "warning"}>{c}</Pill>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note"><Info aria-hidden /> “Unverified” means not tested — it doesn’t mean supported. The prototype doesn’t choose how the app would be built or distributed.</p>
        <p className="row t-support"><DemoNote>Proposed capability states only; device support has not been verified.</DemoNote></p>
      </div>
    </div>
  );
}
