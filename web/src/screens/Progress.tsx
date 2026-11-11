import { useEffect, useState } from "react";
import { ChevronLeft, Flame, History as HistoryIcon, Info, Trash2 } from "lucide-react";
import { ApiError } from "../api/client";
import {
  LANE_LABEL,
  deleteLog,
  loadGameState,
  loadSummary,
  logTime,
  onTimeSent,
  setFamilyDay,
  type GameState,
  type Lane,
  type StudySummary,
} from "../api/time";
import { fmtDuration, nf, plural } from "../lib/format";
import { announce, go } from "../state/store";
import { Banner, Button, Checkbox, ChoiceSelect, Collapsible, CollapsibleContent, CollapsibleTrigger, Input, PageHead, Pill, Progress, Skeleton, Spinner } from "../components/ui";

export function ProgressScreen({ sub }: { sub?: string }) {
  if (sub === "devices") return <Devices />;
  return <Overview />;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "");

/** Server totals, refreshed when this device sends new study time (at most every 30 s). */
function useProgress() {
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([loadSummary(), loadGameState()])
      .then(([s, g]) => {
        if (!live) return;
        setSummary(s);
        setGame(g);
        setState("ok");
      })
      .catch((e) => {
        if (!live) return;
        setError(errText(e));
        setState((st) => (st === "ok" ? "ok" : "error"));
      });
    return () => {
      live = false;
    };
  }, [n]);
  useEffect(() => {
    let last = 0;
    return onTimeSent(() => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      setN((x) => x + 1);
    });
  }, []);
  return { summary, game, setGame, state, error, reload: () => setN((x) => x + 1) };
}

const LANES: Lane[] = ["listening", "car", "reading", "speaking", "writing", "review"];

function Overview() {
  const { summary, game, setGame, state, error, reload } = useProgress();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead
        title="Progress"
        actions={<Button kind="tertiary" icon={<HistoryIcon aria-hidden />} onClick={() => go("progress/history?tab=time")}>History</Button>}
      />
      <div className="flex flex-col gap-8">
        {state === "loading" && (
          <>
            <Spinner label="Loading your progress…" />
            <Skeleton lines={5} />
          </>
        )}
        {state === "error" && (
          <Banner tone="error" title="Your progress didn’t load" live="assertive" actions={<Button kind="secondary" onClick={reload}>Retry</Button>}>
            {error || "The server didn’t respond."} Your study time is safe.
          </Banner>
        )}
        {state === "ok" && summary && game && (
          <>
            <Goal s={summary} />
            <Level g={game} />
            <Today g={game} onChange={setGame} />
            <Week g={game} />
            <LogTime g={game} onChange={setGame} />
          </>
        )}

        <Collapsible>
          <CollapsibleTrigger id="rules-h" className="flex min-h-11 w-full items-center text-left text-sm font-medium">What counts</CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pb-2">
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
              <li>Study and Review count while you use them (the page is visible and you did something in the last 2 minutes). Leaving a page open doesn’t count.</li>
              <li>Audio counts while it really plays, also with the screen locked: 10 minutes of audio at 2× counts as 5 minutes.</li>
              <li>A second is only counted once, even when audio plays while you study.</li>
              <li>Study away from the app (a class, a book) can be logged by hand below.</li>
              <li>Days roll over at 4:00 and weeks start on Monday (Vancouver time).</li>
              <li>Your level is one per hour of study (60 XP); listening on the go counts at half weight there, and correct review answers add a little XP.</li>
            </ul>
            <Button kind="tertiary" className="h-8 px-2 text-sm" onClick={() => go("progress/devices")}>Devices and background listening</Button>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function Goal({ s }: { s: StudySummary }) {
  const hours = s.total_seconds / 3600;
  const pct = Math.min(100, s.progress * 100);
  const finish = s.projected_finish ? new Date(`${s.projected_finish}T12:00:00Z`) : null;
  return (
    <>
      <section className="journey flex flex-col gap-2" aria-labelledby="goal-h">
        <h2 id="goal-h" className="text-xs font-medium text-muted-foreground">1,000-hour journey</h2>
        <p className="text-lg font-semibold tabular-nums">{s.total_seconds < 60 ? "0 h" : fmtDuration(s.total_seconds / 60)}</p>
        <dl className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Goal</dt><dd className="text-sm font-medium tabular-nums">{nf.format(s.goal_hours)} h</dd></div>
          <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Done</dt><dd className="text-sm font-medium tabular-nums">{pct.toFixed(1)}%</dd></div>
        </dl>
        <Progress value={pct} aria-label={`${pct.toFixed(1)} percent of the ${nf.format(s.goal_hours)}-hour goal`} />
        {hours >= s.goal_hours && <Banner tone="success" title="You’ve reached 1,000 hours">Your total keeps counting — it isn’t reset.</Banner>}
        {s.total_seconds === 0 && (
          <Banner tone="neutral" title="No study time yet" actions={<Button kind="secondary" onClick={() => go("study/new")}>Start studying</Button>}>
            Analyse a text, review your cards or play an episode, and your time appears here.
          </Banner>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Today", fmtDuration(s.today_seconds / 60), "Since 4:00"],
          ["This week", fmtDuration(s.week_seconds / 60), "Since Monday"],
          ["Remaining to 1,000 hours", s.remaining_seconds === 0 ? "0 h" : fmtDuration(s.remaining_seconds / 60), "Goal minus total"],
          ["Weekly average", fmtDuration(s.average_week_seconds / 60), "Over the last 4 weeks"],
        ].map(([k, v, sub]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{v}</dd>
            <dd className="text-xs leading-4 text-muted-foreground" style={{ margin: 0 }}>{sub}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2" aria-labelledby="eta-h">
        <h2 id="eta-h" className="text-sm font-medium">Estimated finish</h2>
        {s.remaining_seconds === 0 ? (
          <p>Goal reached. No estimate needed.</p>
        ) : finish && finish.getUTCFullYear() > new Date().getUTCFullYear() + 20 ? (
          <p>More than 20 years away at your pace of the last 4 weeks. The estimate moves closer as your weekly time grows.</p>
        ) : finish ? (
          <>
            <p className="text-lg font-semibold text-balance">Around {finish.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</p>
            <p className="text-sm text-muted-foreground">At your pace of the last 4 weeks. An estimate, not a promise.</p>
          </>
        ) : (
          <p>No estimate yet — there’s no study time in the last 4 weeks to base a pace on.</p>
        )}
      </section>
    </>
  );
}

function Level({ g }: { g: GameState }) {
  const toNext = g.next_level_xp === null ? 0 : g.next_level_xp - g.xp;
  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-labelledby="lvl-h">
      <div className="flex flex-wrap items-center gap-2" style={{ justifyContent: "space-between" }}>
        <h2 id="lvl-h" className="text-sm font-medium">Level</h2>
        {g.streak_days > 0 && (
          <Pill tone="success" icon={<Flame aria-hidden width={14} height={14} />}>
            {plural(g.streak_days, "weekday")} in a row
          </Pill>
        )}
      </div>
      <p>
        <span className="text-lg font-semibold tabular-nums">{nf.format(g.level)}</span> <span className="text-sm text-muted-foreground">of {nf.format(g.max_level)}</span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(g.progress * 100)} percent of the way to level ${g.level + 1}`}>
        <div className="h-full bg-primary" style={{ width: `${g.progress * 100}%` }} />
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {g.next_level_xp === null ? "Top level reached." : `${nf.format(toNext)} XP to level ${nf.format(g.level + 1)}`} · {nf.format(g.xp)} XP in all · studied on {g.days_studied_7d} of the last 7 days
      </p>
      {(g.today.kills > 0 || g.today.best_combo > 1) && (
        <p className="text-sm text-muted-foreground tabular-nums">Today’s review: {plural(g.today.kills, "correct answer")} · best run {g.today.best_combo}</p>
      )}
    </section>
  );
}

function Today({ g, onChange }: { g: GameState; onChange: (g: GameState) => void }) {
  const [busy, setBusy] = useState(false);
  const t = g.today;
  const pct = t.target ? Math.min(100, (t.minutes / t.target) * 100) : 100;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="today-h">
      <h2 id="today-h" className="text-lg font-semibold text-balance">Today</h2>
      {t.family_day ? (
        <p>Family day: no target today, and your streak is kept.</p>
      ) : t.target ? (
        <>
          <p className="tabular-nums">
            <span className="font-medium">{fmtDuration(t.minutes)}</span> of today’s {fmtDuration(t.target)}
            {t.minutes >= t.target ? " — done for today." : "."}
          </p>
          <Progress value={pct} aria-label={`${Math.round(pct)} percent of today’s target`} />
        </>
      ) : (
        <p className="tabular-nums">{fmtDuration(t.minutes)} today. No target today{t.weekend ? " (weekend)" : ""}.</p>
      )}
      <label className="flex items-start gap-3 py-2">
        <Checkbox
          checked={t.family_day}
          disabled={busy}
          onCheckedChange={(checked) => {
            setBusy(true);
            setFamilyDay(checked === true)
              .then((next) => {
                onChange(next);
                announce(next.today.family_day ? "Family day on: no target today." : "Family day off.");
              })
              .catch(() => announce("Couldn’t save the family day. Nothing changed.", true))
              .finally(() => setBusy(false));
          }}
        />
        <span className="flex flex-col">
          <span>Family day</span>
          <span className="text-sm text-muted-foreground">Family comes first: today’s target becomes 0 and the streak is kept.</span>
        </span>
      </label>
    </section>
  );
}

function Week({ g }: { g: GameState }) {
  const w = g.week;
  const rows = LANES.filter((l) => (w.lane_targets[l] ?? 0) > 0 || (w.by_lane[l] ?? 0) > 0);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="week-h">
      <h2 id="week-h" className="text-lg font-semibold text-balance">{w.number > 0 ? `Week ${w.number}` : "This week"}</h2>
      <p className="text-sm text-muted-foreground tabular-nums">
        {fmtDuration(w.minutes)} of {fmtDuration(w.target)} planned{w.maintenance ? " (maintenance weeks: a lighter plan)" : ""}. Listening on the go counts half here.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet this week.</p>
      ) : (
        <ul className="flex flex-col gap-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((l) => {
            const done = w.by_lane[l] ?? 0;
            const target = w.lane_targets[l] ?? 0;
            return (
              <li key={l} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2" style={{ justifyContent: "space-between" }}>
                  <span>{LANE_LABEL[l]}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">{fmtDuration(done)}{target ? ` / ${fmtDuration(target)}` : ""}</span>
                </span>
                {target > 0 && (
                  <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {w.focus_skill?.target > 0 && w.focus_skill.minutes < w.focus_skill.target && (
        <p className="text-sm text-muted-foreground">Furthest behind this week: {SKILL_NAME[w.focus_skill.skill] ?? w.focus_skill.skill}.</p>
      )}
    </section>
  );
}

const SKILL_NAME: Record<string, string> = { CO: "listening (CO)", CE: "reading (CE)", EE: "writing (EE)", EO: "speaking (EO)" };

function LogTime({ g, onChange }: { g: GameState; onChange: (g: GameState) => void }) {
  const [lane, setLane] = useState<Lane>("speaking");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Number(minutes);
  const valid = Number.isInteger(n) && n >= 1 && n <= 300;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="log-h">
      <h2 id="log-h" className="text-lg font-semibold text-balance">Log study away from the app</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2" style={{ width: 200 }}>
          <span className="text-sm font-medium">What</span>
          <ChoiceSelect
            ariaLabel="What"
            value={lane}
            onValueChange={(v) => setLane(v as Lane)}
            options={LANES.map((l) => ({ value: l, label: LANE_LABEL[l] }))}
          />
        </label>
        <label className="grid gap-2" style={{ width: 120 }}>
          <span className="text-sm font-medium">Minutes</span>
          <Input inputMode="numeric" value={minutes} aria-invalid={minutes !== "" && !valid} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="grid gap-2 min-w-0 flex-1" style={{ minWidth: 180 }}>
          <span className="text-sm font-medium">Note (optional)</span>
          <Input maxLength={200} value={note} placeholder="Note" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {minutes !== "" && !valid && <p className="text-sm text-muted-foreground" style={{ color: "var(--error)" }}>Enter 1 to 300 minutes.</p>}
      {error && <Banner tone="error" title="Not logged" live="assertive">{error}</Banner>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          kind="secondary"
          busy={busy}
          disabledReason={!valid ? "Enter the minutes first." : undefined}
          onClick={() => {
            setBusy(true);
            setError("");
            logTime(lane, n, note.trim())
              .then((next) => {
                onChange(next);
                setMinutes("");
                setNote("");
                announce(`Logged ${n} minutes of ${LANE_LABEL[lane].toLowerCase()}.`);
              })
              .catch((e) => setError(errText(e) || "The server didn’t respond. Nothing was logged."))
              .finally(() => setBusy(false));
          }}
        >
          Log time
        </Button>
      </div>
      {g.today.logs.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {g.today.logs.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                {LANE_LABEL[l.lane] ?? l.lane} · {fmtDuration(l.minutes)}
                {l.note && <span className="text-sm text-muted-foreground"> · {l.note}</span>}
              </span>
              <Button
                kind="tertiary"
                className="h-8 px-2 text-sm"
                icon={<Trash2 aria-hidden />}
                aria-label={`Remove ${l.minutes} minutes of ${LANE_LABEL[l.lane] ?? l.lane}`}
                onClick={() =>
                  deleteLog(l.id)
                    .then((next) => {
                      onChange(next);
                      announce("Log removed.");
                    })
                    .catch(() => announce("Couldn’t remove the log.", true))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* SCR-PRO-02 */
function Devices() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHead
        back={<Button kind="tertiary" className="h-8 px-2 text-sm" icon={<ChevronLeft aria-hidden />} onClick={() => go("progress")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Progress</Button>}
        title="Devices and background listening"
        desc="What this web app can count on each kind of device."
      />
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2" style={{ paddingLeft: 20 }}>
          <li>Audio time is read from how far the audio really moved, so it still counts when the browser pauses the page in the background, as long as the audio keeps playing.</li>
          <li>Whether audio keeps playing with the screen locked depends on the phone and the browser. If the audio stops, the time stops too.</li>
          <li>Time is sent to the server about every 30 seconds and when you leave the page. If the connection drops, it is kept on this device and sent later.</li>
          <li>Time from several devices adds up; nothing is counted twice on one device.</li>
        </ul>
        <p className="flex items-start gap-2 text-sm text-muted-foreground"><Info aria-hidden /> Not tested on every device. If a locked phone doesn’t count, check History → Study time the next day.</p>
      </div>
    </div>
  );
}
