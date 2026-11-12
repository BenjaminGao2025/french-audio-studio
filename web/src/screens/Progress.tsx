import { useEffect, useState } from "react";
import { History as HistoryIcon, Trash2, Loader2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle, Checkbox, Crumbs, Input, PageHead, Progress, Skeleton, Spinner, pageFrame } from "../components/ui";
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
    <div className={pageFrame()}>
      <PageHead
        title="Progress"
        actions={<Button type="button" variant="outline" onClick={() => go("progress/history?tab=time")}>{<HistoryIcon aria-hidden />}History</Button>}
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
          <div className="flex flex-col gap-4">
            <Journey s={summary} />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard title="Today" {...durationParts(summary.today_seconds)} />
              <StatCard title="This week" {...durationParts(summary.week_seconds)} />
              <StatCard title="Remaining" {...(summary.remaining_seconds === 0 ? { value: "0 h" } : durationParts(summary.remaining_seconds))} />
              <StatCard title="Weekly average" {...durationParts(summary.average_week_seconds)} />
            </div>
            <div className={cn("grid gap-4", game.streak_days > 0 && "md:grid-cols-2")}>
              <Estimate s={summary} />
              {game.streak_days > 0 && <StreakCard g={game} />}
            </div>
            <Level g={game} />
            <Today g={game} onChange={setGame} />
            <Week g={game} />
            <LogTime g={game} onChange={setGame} />
          </div>
        )}

        <Button type="button" variant="ghost" className="h-8 self-start px-2 text-sm" onClick={() => go("progress/devices")}>Devices and background listening</Button>
      </div>
    </div>
  );
}

/** Hours on the value line, leftover minutes beside them, so a long total stays one line. */
function durationParts(seconds: number): { value: string; detail?: string } {
  const m = Math.round(seconds / 60);
  if (m < 60) return { value: `${m} min` };
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? { value: `${nf.format(h)} h`, detail: `${r} min` } : { value: `${nf.format(h)} h` };
}

function StatCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-xs! font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-nowrap text-xl font-semibold tabular-nums leading-none">
          {value}
          {detail ? <span className="text-sm font-normal text-muted-foreground"> {detail}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}

function Journey({ s }: { s: StudySummary }) {
  const hours = s.total_seconds / 3600;
  const pct = Math.min(100, s.progress * 100);
  return (
    <Card className="journey" aria-labelledby="goal-h">
      <CardHeader>
        <CardTitle id="goal-h" className="text-sm font-medium">1,000-hour journey</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-2xl font-semibold tabular-nums">{s.total_seconds < 60 ? "0 h" : fmtDuration(s.total_seconds / 60)}</p>
        <div className="flex flex-col gap-2">
          <p className="text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}% of {nf.format(s.goal_hours)} h</p>
          <Progress value={pct} aria-label={`${pct.toFixed(1)} percent of the ${nf.format(s.goal_hours)}-hour goal`} />
        </div>
        {hours >= s.goal_hours && <Alert variant="default"><AlertTitle>You’ve reached 1,000 hours</AlertTitle></Alert>}
        {s.total_seconds === 0 && (
          <Alert variant="default"><AlertTitle>No study time yet</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/new")}>Start studying</Button></div></AlertDescription></Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Estimate({ s }: { s: StudySummary }) {
  const finish = s.projected_finish ? new Date(`${s.projected_finish}T12:00:00Z`) : null;
  const value = s.remaining_seconds === 0
    ? "Goal reached. No estimate needed."
    : finish && finish.getUTCFullYear() > new Date().getUTCFullYear() + 20
      ? "More than 20 years away"
      : finish
        ? `Around ${finish.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}`
        : "No estimate yet";
  return (
    <Card aria-labelledby="eta-h">
      <CardHeader>
        <CardTitle id="eta-h" className="text-sm font-medium">Estimated finish</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-balance">{value}</p>
      </CardContent>
    </Card>
  );
}

function StreakCard({ g }: { g: GameState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Streak</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tabular-nums">{nf.format(g.streak_days)}</p>
        <p className="text-xs text-muted-foreground">{plural(g.streak_days, "weekday")} in a row</p>
      </CardContent>
    </Card>
  );
}

function Level({ g }: { g: GameState }) {
  const toNext = g.next_level_xp === null ? 0 : g.next_level_xp - g.xp;
  return (
    <Card aria-labelledby="lvl-h">
      <CardHeader>
        <CardTitle id="lvl-h" className="text-sm font-medium">Level</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-2xl font-semibold tabular-nums">
          {nf.format(g.level)} <span className="text-sm font-normal text-muted-foreground">of {nf.format(g.max_level)}</span>
        </p>
        <Progress value={g.progress * 100} aria-label={`${Math.round(g.progress * 100)} percent of the way to level ${g.level + 1}`} />
        <p className="text-sm text-muted-foreground tabular-nums">
          {g.next_level_xp === null ? "Top level reached." : `${nf.format(toNext)} XP to level ${nf.format(g.level + 1)}`} · {nf.format(g.xp)} XP in all · studied on {g.days_studied_7d} of the last 7 days
        </p>
        {(g.today.kills > 0 || g.today.best_combo > 1) && (
          <p className="text-sm text-muted-foreground tabular-nums">Today’s review: {plural(g.today.kills, "correct answer")} · best run {g.today.best_combo}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Today({ g, onChange }: { g: GameState; onChange: (g: GameState) => void }) {
  const [busy, setBusy] = useState(false);
  const t = g.today;
  const pct = t.target ? Math.min(100, (t.minutes / t.target) * 100) : 100;
  return (
    <Card aria-labelledby="today-h">
      <CardHeader>
        <CardTitle id="today-h" className="text-sm font-medium">Today</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
    </Card>
  );
}

function Week({ g }: { g: GameState }) {
  const w = g.week;
  const rows = LANES.filter((l) => (w.lane_targets[l] ?? 0) > 0 || (w.by_lane[l] ?? 0) > 0);
  return (
    <Card aria-labelledby="week-h">
      <CardHeader>
        <CardTitle id="week-h" className="text-sm font-medium">{w.number > 0 ? `Week ${w.number}` : "This week"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
      <p className="text-2xl font-semibold tabular-nums">
        {fmtDuration(w.minutes)} <span className="text-sm font-normal text-muted-foreground">of {fmtDuration(w.target)}</span>
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
      </CardContent>
    </Card>
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
    <Card aria-labelledby="log-h">
      <CardHeader>
        <CardTitle id="log-h" className="text-sm font-medium">Log study away from the app</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      {minutes !== "" && !valid && <p className="text-sm text-muted-foreground" style={{ color: "var(--destructive)" }}>Enter 1 to 300 minutes.</p>}
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
      </CardContent>
    </Card>
  );
}

/* SCR-PRO-02 */
function Devices() {
  return (
    <div className={pageFrame()}>
      <PageHead
        back={<Crumbs items={[{ label: "Progress", onClick: () => go("progress") }, { label: "Devices" }]} />}
        title="Devices and background listening"
      />
    </div>
  );
}
