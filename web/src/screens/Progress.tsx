import { useEffect, useState } from "react";
import { ChevronLeft, History as HistoryIcon, Trash2, Loader2 } from "lucide-react";
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
import { Card, CardDescription, CardHeader, CardTitle, Checkbox, Input, PageHead, Progress, Skeleton, Spinner } from "../components/ui";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";

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
        actions={<Button type="button" variant="ghost" onClick={() => go("progress/history?tab=time")}>{<HistoryIcon aria-hidden />}History</Button>}
      />
      <div className="flex flex-col gap-8">
        {state === "loading" && (
          <>
            <Spinner label="Loading your progress…" />
            <Skeleton lines={5} />
          </>
        )}
        {state === "error" && (
          <Alert variant="destructive" role="alert"><AlertTitle>Your progress didn’t load</AlertTitle><AlertDescription>{error || "The server didn’t respond."} Your study time is safe.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={reload}>Retry</Button></div></AlertDescription></Alert>
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

        <Button type="button" variant="ghost" className="h-8 self-start px-2 text-sm" onClick={() => go("progress/devices")}>Devices and background listening</Button>
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
        {hours >= s.goal_hours && <Alert variant="default"><AlertTitle>You’ve reached 1,000 hours</AlertTitle></Alert>}
        {s.total_seconds === 0 && (
          <Alert variant="default"><AlertTitle>No study time yet</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/new")}>Start studying</Button></div></AlertDescription></Alert>
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
          <p>More than 20 years away</p>
        ) : finish ? (
          <p className="text-lg font-semibold text-balance">Around {finish.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</p>
        ) : (
          <p>No estimate yet</p>
        )}
      </section>
    </>
  );
}

function Level({ g }: { g: GameState }) {
  const toNext = g.next_level_xp === null ? 0 : g.next_level_xp - g.xp;
  return (
    <>
    {g.streak_days > 0 && (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Streak</CardTitle>
          <CardDescription>{plural(g.streak_days, "weekday")} in a row</CardDescription>
        </CardHeader>
      </Card>
    )}
    <section className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3" aria-labelledby="lvl-h">
      <h2 id="lvl-h" className="text-sm font-medium">Level</h2>
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
    </>
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
        <p className="tabular-nums">{fmtDuration(t.minutes)} today</p>
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
        <span>Family day</span>
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
        {fmtDuration(w.minutes)} of {fmtDuration(w.target)}
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
          <Select value={lane} onValueChange={(v) => setLane(v as Lane)}><SelectTrigger aria-label={"What"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(LANES.map((l) => ({ value: l, label: LANE_LABEL[l] }))).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
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
      {error && <Alert variant="destructive" role="alert"><AlertTitle>Not logged</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" aria-disabled={(!!(busy) || !!(!valid ? "Enter the minutes first." : undefined)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy) || !!(!valid ? "Enter the minutes first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy) || !!(!valid ? "Enter the minutes first." : undefined)) { event.preventDefault(); return; } (() => {
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
          })(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}Log time{(!valid ? "Enter the minutes first." : undefined) ? <span className="sr-only">{!valid ? "Enter the minutes first." : undefined}</span> : null}</Button>
      </div>
      {g.today.logs.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {g.today.logs.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                {LANE_LABEL[l.lane] ?? l.lane} · {fmtDuration(l.minutes)}
                {l.note && <span className="text-sm text-muted-foreground"> · {l.note}</span>}
              </span>
              <Button type="button" variant="ghost" aria-label={`Remove ${l.minutes} minutes of ${LANE_LABEL[l.lane] ?? l.lane}`} className="h-8 px-2 text-sm" onClick={() =>
                  deleteLog(l.id)
                    .then((next) => {
                      onChange(next);
                      announce("Log removed.");
                    })
                    .catch(() => announce("Couldn’t remove the log.", true))}>{<Trash2 aria-hidden />}Remove</Button>
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
        back={<Button type="button" variant="ghost" className="h-8 self-start px-2 text-sm md:-ml-3" onClick={() => go("progress")}>{<ChevronLeft aria-hidden />}Progress</Button>}
        title="Devices and background listening"
      />
    </div>
  );
}
