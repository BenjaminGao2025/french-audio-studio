import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Coffee, Pause, Play, Plus, Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, errorMessage } from "@/components/fr/kit-utils";
import { useLogTime } from "@/api/hooks";
import { useT, type TKey } from "@/i18n";
import type { Lane } from "@/api/types";
import {
  PLANS,
  dismiss,
  extend,
  formatClock,
  isRunning,
  markLogged,
  onComplete,
  pause,
  planOf,
  remainingMs,
  resume,
  setPlan,
  startBreak,
  startFocus,
  stop,
  tick,
  useFocusDay,
  useFocusState,
  type FocusState,
} from "@/lib/focus-timer";
import {
  cancelChime,
  notificationPermission,
  notify,
  requestNotifications,
  scheduleChime,
  unlockAudio,
} from "@/lib/focus-alerts";

const LOG_LANES: { lane: Lane; label: TKey }[] = [
  { lane: "listening", label: "laneListening" },
  { lane: "reading", label: "laneReading" },
  { lane: "speaking", label: "laneSpeaking" },
  { lane: "writing", label: "laneWriting" },
];
const LANE_KEY = "1000h.focus.lane";
const TITLE_PREFIX = /^(?:🍅|☕|⏸) \d+:\d\d(?: · |$)/;

function lastLane(): Lane {
  try {
    const v = window.localStorage.getItem(LANE_KEY) as Lane | null;
    return v && LOG_LANES.some((l) => l.lane === v) ? v : "listening";
  } catch {
    return "listening";
  }
}

/** Re-render once a second while a phase runs; returns "now". */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function ProgressRing({
  value,
  size,
  stroke,
  tone,
  children,
}: {
  value: number;
  size: number;
  stroke: number;
  tone: "focus" | "break";
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="fill-none stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          className={cn(
            "fill-none transition-[stroke-dashoffset] duration-1000 ease-linear",
            tone === "focus" ? "stroke-primary" : "stroke-chart-4",
          )}
        />
      </svg>
      {children && <span className="absolute inset-0 grid place-items-center">{children}</span>}
    </span>
  );
}

/**
 * Floating focus timer (pomodoro), on every page of the app. It keeps running across routes,
 * reloads and tabs, shows the countdown in the tab title, and chimes and notifies when a phase
 * ends, so it also works while studying on another site in another tab.
 */
export function FocusTimer() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();
  const s = useFocusState();
  const today = useFocusDay();
  const running = isRunning(s);
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(notificationPermission);
  const root = useRef<HTMLDivElement>(null);

  // Advance a finished phase exactly at its end, and whenever the tab comes back to the front.
  useEffect(() => {
    if (!running || s.endsAt === null) return;
    const id = window.setTimeout(() => tick(), Math.max(0, s.endsAt - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [running, s.endsAt]);
  useEffect(() => {
    tick();
    const wake = () => tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);
  useEffect(() => {
    if (running) tick(now);
  }, [running, now]);

  // Keep the chime in step with the end time (pause, resume, +5 and stop all move it).
  useEffect(() => {
    if (running && s.endsAt !== null)
      scheduleChime(s.endsAt, s.phase === "break" ? "break" : "focus");
    else cancelChime();
  }, [running, s.endsAt, s.phase]);

  const tRef = useRef(t);
  tRef.current = t;
  useEffect(
    () =>
      onComplete((finished) => {
        const tr = tRef.current;
        setOpen(true);
        if (finished === "focus") notify(tr("focusNotifyTitle"), tr("focusNotifyBody"));
        else notify(tr("focusBreakOverTitle"), tr("focusBreakOverBody"));
      }),
    [],
  );

  // Countdown in the tab title, so it is visible from another tab.
  const left = remainingMs(s, now);
  useEffect(() => {
    const base = document.title.replace(TITLE_PREFIX, "");
    if (s.phase === "focus" || s.phase === "break") {
      const icon = s.pausedLeft !== null ? "⏸" : s.phase === "focus" ? "🍅" : "☕";
      document.title = base
        ? `${icon} ${formatClock(left)} · ${base}`
        : `${icon} ${formatClock(left)}`;
    } else if (base !== document.title) {
      document.title = base;
    }
  });

  // Close the panel on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (path.endsWith("/login")) return null;

  const active = s.phase === "focus" || s.phase === "break";
  const tone = s.phase === "break" ? "break" : "focus";
  const progress = s.totalMs ? 1 - left / s.totalMs : 0;
  const paused = s.pausedLeft !== null;

  const begin = (fn: () => void) => () => {
    unlockAudio();
    fn();
    if (permission === "default") void requestNotifications().then((p) => setPermission(p));
  };

  return (
    <div
      ref={root}
      className="fixed right-4 bottom-24 z-50 flex flex-col items-end gap-3 md:right-6 md:bottom-6"
    >
      {open && (
        <section
          role="dialog"
          aria-label={t("focusOpen")}
          className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 shadow-soft animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {s.phase === "idle" && t("focusTitle")}
              {s.phase === "focus" && (paused ? t("focusPaused") : t("focusRunning"))}
              {s.phase === "break" && (paused ? t("focusPaused") : t("focusOnBreak"))}
              {s.phase === "done" && t("focusDoneTitle")}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="-mr-2 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label={t("focusClose")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {s.phase === "idle" && <IdleBody state={s} onStart={begin(() => startFocus())} />}

          {active && (
            <div className="flex flex-col items-center gap-5">
              <ProgressRing value={progress} size={168} stroke={6} tone={tone}>
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "font-serif text-5xl tabular-nums tracking-tight",
                      paused && "text-muted-foreground",
                    )}
                  >
                    {formatClock(left)}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {s.phase === "focus"
                      ? `${planOf(s.planId).focusMin} ${t("focusMinutes")}`
                      : `☕ ${planOf(s.planId).breakMin} ${t("focusMinutes")}`}
                  </span>
                </span>
              </ProgressRing>
              <div className="flex w-full items-center justify-center gap-2">
                <button
                  onClick={paused ? begin(() => resume()) : () => pause()}
                  className={btn.primary}
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? t("focusResume") : t("focusPause")}
                </button>
                <button onClick={() => extend(5)} className={btn.ghost}>
                  <Plus className="h-4 w-4" />
                  {t("focusPlus5")}
                </button>
              </div>
              <button
                onClick={() => stop()}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {s.phase === "break" ? t("focusSkipBreak") : t("focusGiveUp")}
              </button>
            </div>
          )}

          {s.phase === "done" && (
            <DoneBody
              state={s}
              onBreak={begin(() => startBreak())}
              onAgain={begin(() => startFocus())}
              onClose={() => {
                dismiss();
                setOpen(false);
              }}
            />
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t("focusToday")} · {today.count} {t("focusSessions")} · {today.minutes}{" "}
              {t("focusMinutes")}
            </span>
            {permission === "default" && (
              <button
                onClick={() => void requestNotifications().then((p) => setPermission(p))}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Bell className="h-3.5 w-3.5" /> {t("focusNotifyOn")}
              </button>
            )}
          </div>
          {permission === "denied" && (
            <p className="mt-2 text-[11px] text-muted-foreground">{t("focusNotifyBlocked")}</p>
          )}
        </section>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("focusOpen")}
        aria-expanded={open}
        className={cn(
          "group inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card pr-4 pl-2 text-sm shadow-soft transition hover:-translate-y-0.5",
          !active && s.phase !== "done" && "pl-3",
          s.phase === "done" && "border-primary/40",
        )}
      >
        {active ? (
          <>
            <ProgressRing value={progress} size={28} stroke={3} tone={tone}>
              {paused ? (
                <Pause className="h-3 w-3 text-muted-foreground" />
              ) : s.phase === "break" ? (
                <Coffee className="h-3 w-3 text-muted-foreground" />
              ) : null}
            </ProgressRing>
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                paused && "text-muted-foreground",
              )}
            >
              {formatClock(left)}
            </span>
          </>
        ) : (
          <>
            <Timer
              className={cn(
                "h-4 w-4",
                s.phase === "done" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="font-medium">{s.phase === "done" ? "🍅" : t("focus")}</span>
            {today.count > 0 && (
              <span className="rounded-full bg-secondary px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {today.count}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

function IdleBody({ state, onStart }: { state: FocusState; onStart: () => void }) {
  const t = useT();
  const plan = planOf(state.planId);
  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="grid w-full grid-cols-2 gap-1 rounded-full bg-secondary p-1"
        role="radiogroup"
      >
        {PLANS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={p.id === plan.id}
            onClick={() => setPlan(p.id)}
            className={cn(
              "rounded-full py-1.5 text-sm tabular-nums transition",
              p.id === plan.id
                ? "bg-card font-medium text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.focusMin} + {p.breakMin}
          </button>
        ))}
      </div>
      <div className="font-serif text-6xl tabular-nums tracking-tight">{plan.focusMin}:00</div>
      <button onClick={onStart} className={cn(btn.primary, "w-full")}>
        <Play className="h-4 w-4" /> {t("focusStart")}
      </button>
    </div>
  );
}

function DoneBody({
  state,
  onBreak,
  onAgain,
  onClose,
}: {
  state: FocusState;
  onBreak: () => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const logTime = useLogTime();
  const [lane, setLane] = useState<Lane>(lastLane);
  const logged = state.loggedLane;
  const log = (l: Lane) => {
    setLane(l);
    try {
      window.localStorage.setItem(LANE_KEY, l);
    } catch {
      // ignore
    }
    logTime.mutate(
      { lane: l, minutes: state.doneMin, note: `番茄钟 ${state.doneMin} 分钟` },
      { onSuccess: () => markLogged(l) },
    );
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <div className="text-4xl">🍅</div>
        <div className="mt-1 text-sm text-muted-foreground tabular-nums">
          {state.doneMin} {t("focusMinutes")}
        </div>
      </div>

      <div className="rounded-xl bg-secondary/60 p-3">
        <div className="mb-2 text-xs font-medium">{t("focusLogTitle")}</div>
        <div className="flex flex-wrap gap-1.5">
          {LOG_LANES.map(({ lane: l, label }) => {
            const on = logged ? logged === l : false;
            return (
              <button
                key={l}
                onClick={() => log(l)}
                disabled={!!logged || logTime.isPending}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition disabled:cursor-default",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-secondary disabled:opacity-50",
                  !logged && l === lane && "border-primary/50",
                )}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {logged
            ? `${t("focusLogged")} · ${t(LOG_LANES.find((x) => x.lane === logged)?.label ?? "laneListening")} ${state.doneMin} ${t("focusMinutes")}`
            : logTime.error
              ? errorMessage(logTime.error)
              : t("focusLogHint")}
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={onBreak} className={cn(btn.primary, "flex-1")}>
          <Coffee className="h-4 w-4" /> {t("focusTakeBreak")} {planOf(state.planId).breakMin}{" "}
          {t("focusMinutes")}
        </button>
        <button onClick={onAgain} className={btn.ghost}>
          {t("focusAgain")}
        </button>
      </div>
      <button
        onClick={onClose}
        className="-mt-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("focusClose")}
      </button>
    </div>
  );
}
