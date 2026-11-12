import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LogOut, ArrowRight, Monitor, Loader2, AlertCircle } from "lucide-react";
import { MAX_SESSION_SIZE, MIN_SESSION_SIZE } from "../data/fixtures";
import { type Device, listDevices, logout, signOutDevice, useSession } from "../api/auth";
import { loginUrl } from "../api/client";
import { saveReviewSettings } from "../api/review";
import { initials } from "../components/Shell";
import { SPEEDS, announce, get, go, routeUrl, set, setDailyNew, setPlaybackPrefs, setSessionSize, stopPlayback, useApp } from "../state/store";
import { fmtWhen } from "../api/history";
import { Checkbox, Dialog, PageHead, Spinner, pageFrame } from "../components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { animationOn, feedbackPrefs, prefersReducedMotion, saveFeedback, subscribeFeedback } from "../lib/feedback";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";

type SaveState = "idle" | "saving" | "saved" | "failed" | "offline";

/* Shared by Settings (SCR-SET-01) and Review (SCR-QUO-01) */
export function DailyLimitField({ compact }: { compact?: boolean }) {
  const dailyNew = useApp((s) => s.dailyNew);
  const newUsed = useApp((s) => s.newUsed);
  const forced = useApp((s) => s.ss["SCR-QUO-01"]);
  const [value, setValue] = useState(String(dailyNew));
  const [state, setState] = useState<SaveState>("idle");
  const [touched, setTouched] = useState(false);
  useEffect(() => setValue(String(dailyNew)), [dailyNew]);
  useEffect(() => {
    if (forced === "invalid") {
      setValue("250");
      setTouched(true);
    }
    if (forced === "saving" || forced === "failed" || forced === "offline" || forced === "saved") setState(forced);
  }, [forced]);
  const n = Number(value);
  const valid = /^\d+$/.test(value.trim()) && n >= 0 && n <= 200;
  const error = touched && !valid ? "Enter a whole number from 0 to 200." : undefined;
  const save = () => {
    setTouched(true);
    if (!valid) {
      announce("Enter a whole number from 0 to 200.", true);
      return;
    }
    if (get().offline) {
      setDailyNew(n);
      set(() => ({ sync: "pending" }));
      setState("offline");
      announce("Saved on this device. It will sync when you’re back online.");
      return;
    }
    setState("saving");
    saveReviewSettings({ new_limit: n })
      .then(() => {
        setDailyNew(n);
        setState("saved");
        announce(`Daily new cards set to ${n}.`);
      })
      .catch(() => {
        setState("failed");
        announce("Couldn’t save the daily limit. Your previous limit is still in use.", true);
      });
  };
  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 520 }}>
      <div className="flex flex-wrap items-start gap-2 gap-3" style={{ alignItems: "flex-end" }}>
        <div style={{ width: 200 }}>
          <div className="grid gap-2"><Label htmlFor="daily-new-cards-daily-new">Daily new cards</Label>{!compact && <p id="daily-new-cards-daily-new-help" className="text-sm text-muted-foreground">0 to 200</p>}<Input id="daily-new-cards-daily-new" value={value} onChange={(e) => { setValue(e.target.value); setState("idle"); }} inputMode="numeric" name="daily-new" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && save()} autoComplete="off" aria-describedby={error ? "daily-new-cards-daily-new-err" : undefined} aria-invalid={error ? true : undefined} />{error ? <p id="daily-new-cards-daily-new-err" className="flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{error}</span></p> : null}</div>
        </div>
        <Button type="button" variant="outline" aria-disabled={(!!(state === "saving")) || undefined} aria-busy={state === "saving" || undefined} style={{ marginBottom: error ? 28 : 0 }} className={cn((!!(state === "saving")) ? "opacity-50" : "")} onClick={(event) => { if (!!(state === "saving")) { event.preventDefault(); return; } (save)(); }}>{state === "saving" ? <Loader2 className="animate-spin" aria-hidden /> : null}{state === "failed" ? "Retry" : "Save limit"}</Button>
      </div>
      {valid && n === 0 && <p className="text-sm text-muted-foreground">0 means no new cards are introduced. Due reviews continue.</p>}
      {valid && n === 200 && <p className="text-sm text-muted-foreground">200 is the highest daily limit.</p>}
      {valid && n < newUsed && <p className="text-sm text-muted-foreground">You’ve already introduced {newUsed} new cards today. They stay; no more will be introduced today.</p>}
      {state === "saving" && <Spinner label="Saving…" />}
      {state === "saved" && <p className="text-sm text-muted-foreground" role="status" style={{ color: "var(--success)" }}>Saved. Daily new cards: {dailyNew}.</p>}
      {state === "failed" && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t save the daily limit</AlertTitle><AlertDescription>Your previous limit ({dailyNew}) is still in use.</AlertDescription></Alert>}
      {state === "offline" && <Alert variant="default" role="status"><AlertTitle>Saved on this device</AlertTitle><AlertDescription>It will sync when you’re back online. New-card allowances can’t be assigned until then.</AlertDescription></Alert>}
    </div>
  );
}

/* Cards per review session (SCR-QUO-02). Same save states as the daily limit. */
export function SessionSizeField() {
  const sessionSize = useApp((s) => s.sessionSize);
  const lockedSize = useApp((s) => (s.review.phase === "active" ? (s.review.sessionCards?.length ?? null) : null));
  const forced = useApp((s) => s.ss["SCR-QUO-02"]);
  const [value, setValue] = useState(String(sessionSize));
  const [state, setState] = useState<SaveState>("idle");
  const [touched, setTouched] = useState(false);
  useEffect(() => setValue(String(sessionSize)), [sessionSize]);
  useEffect(() => {
    if (forced === "invalid") {
      setValue("5");
      setTouched(true);
    }
    if (forced === "saving" || forced === "failed" || forced === "offline" || forced === "saved") setState(forced);
  }, [forced]);
  const n = Number(value);
  const valid = /^\d+$/.test(value.trim()) && n >= MIN_SESSION_SIZE && n <= MAX_SESSION_SIZE;
  const range = `Enter a whole number from ${MIN_SESSION_SIZE} to ${MAX_SESSION_SIZE}.`;
  const error = touched && !valid ? range : undefined;
  const save = () => {
    setTouched(true);
    if (!valid) {
      announce(range, true);
      return;
    }
    if (get().offline) {
      setSessionSize(n);
      set(() => ({ sync: "pending" }));
      setState("offline");
      announce("Saved on this device. It will sync when you’re back online.");
      return;
    }
    setState("saving");
    saveReviewSettings({ session_size: n })
      .then(() => {
        setSessionSize(n);
        setState("saved");
        announce(`Cards per review session set to ${n}. It applies from your next session.`);
      })
      .catch(() => {
        setState("failed");
        announce("Couldn’t save the session size. Your previous size is still in use.", true);
      });
  };
  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 520 }}>
      <div className="flex flex-wrap items-start gap-2 gap-3" style={{ alignItems: "flex-end" }}>
        <div style={{ width: 200 }}>
          <div className="grid gap-2"><Label htmlFor="cards-per-review-session-session-size">Cards per review session</Label><p id="cards-per-review-session-session-size-help" className="text-sm text-muted-foreground">{MIN_SESSION_SIZE} to {MAX_SESSION_SIZE}</p><Input id="cards-per-review-session-session-size" value={value} onChange={(e) => { setValue(e.target.value); setState("idle"); }} inputMode="numeric" name="session-size" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && save()} autoComplete="off" aria-describedby={error ? "cards-per-review-session-session-size-err" : "cards-per-review-session-session-size-help"} aria-invalid={error ? true : undefined} />{error ? <p id="cards-per-review-session-session-size-err" className="flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{error}</span></p> : null}</div>
        </div>
        <Button type="button" variant="outline" aria-disabled={(!!(state === "saving")) || undefined} aria-busy={state === "saving" || undefined} style={{ marginBottom: error ? 28 : 0 }} className={cn((!!(state === "saving")) ? "opacity-50" : "")} onClick={(event) => { if (!!(state === "saving")) { event.preventDefault(); return; } (save)(); }}>{state === "saving" ? <Loader2 className="animate-spin" aria-hidden /> : null}{state === "failed" ? "Retry" : "Save size"}</Button>
      </div>
      {valid && n === MIN_SESSION_SIZE && <p className="text-sm text-muted-foreground">{MIN_SESSION_SIZE} is the smallest session.</p>}
      {valid && n === MAX_SESSION_SIZE && <p className="text-sm text-muted-foreground">{MAX_SESSION_SIZE} is the largest session.</p>}
      {lockedSize !== null && (
        <p className="text-sm text-muted-foreground">Your session in progress stays at {lockedSize} cards. A new size applies from your next session.</p>
      )}
      {state === "saving" && <Spinner label="Saving…" />}
      {state === "saved" && <p className="text-sm text-muted-foreground" role="status" style={{ color: "var(--success)" }}>Saved. Cards per review session: {sessionSize}. Applies from your next session.</p>}
      {state === "failed" && <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t save the session size</AlertTitle><AlertDescription>Your previous size ({sessionSize}) is still in use.</AlertDescription></Alert>}
      {state === "offline" && <Alert variant="default" role="status"><AlertTitle>Saved on this device</AlertTitle><AlertDescription>It will sync when you’re back online.</AlertDescription></Alert>}
    </div>
  );
}

export function SettingsScreen({ sub }: { sub?: string }) {
  const route = useApp((s) => s.route);
  const [signOut, setSignOut] = useState(route.includes("signout"));
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sub === "account") requestAnimationFrame(() => accountRef.current?.scrollIntoView({ block: "start" }));
    if (route.includes("signout")) setSignOut(true);
  }, [sub, route]);
  return (
    <div className={pageFrame()}>
      <PageHead title="Settings" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle id="pref-h">Review</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <DailyLimitField />
            <SessionSizeField />
          </CardContent>
        </Card>
        <Playback />
        <FeedbackSettings />
        <Card ref={accountRef} className="scroll-mt-4" aria-labelledby="acct-h">
          <CardHeader><CardTitle id="acct-h">Account</CardTitle></CardHeader>
          <CardContent>
            <Account onSignOut={() => setSignOut(true)} />
          </CardContent>
        </Card>
        <Devices />
        <Card>
          <CardHeader><CardTitle id="dev-h">Background listening</CardTitle></CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => go("progress/devices")}>Devices and background listening{<ArrowRight aria-hidden />}</Button>
          </CardContent>
        </Card>
      </div>
      {signOut && <SignOutDialog onClose={() => { setSignOut(false); if (get().route.includes("signout")) history.replaceState(null, "", routeUrl("settings/account")); }} />}
    </div>
  );
}

/** Saved on this device as soon as it changes. */
function Playback() {
  const settings = useApp((s) => s.settings);
  return (
    <Card>
    <CardHeader><CardTitle id="play-h">Playback on this device</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 gap-4" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="grid gap-2" style={{ width: 200 }}>
          <span className="text-sm font-medium">Default playback speed</span>
          <Select value={String(settings.speed)} onValueChange={(v) => { setPlaybackPrefs({ speed: Number(v) }); announce("Speed saved on this device."); }}><SelectTrigger aria-label={"Default playback speed"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(SPEEDS.map((v) => ({ value: String(v), label: `${v}×` }))).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
        </label>
        <label className="flex items-center gap-3 py-2">
          <Checkbox checked={settings.repeat} onCheckedChange={(v) => { setPlaybackPrefs({ repeat: v === true }); announce("Saved on this device."); }} /> Repeat audio by default
        </label>
      </div>
      <p className="text-sm text-muted-foreground">This device · {settings.timezone}</p>
    </CardContent>
    </Card>
  );
}

function FeedbackSettings() {
  const prefs = useSyncExternalStore(subscribeFeedback, feedbackPrefs, feedbackPrefs);
  const reduced = useSyncExternalStore(
    (fn) => {
      if (typeof matchMedia !== "function") return () => {};
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    prefersReducedMotion,
    () => false,
  );
  const volume = Math.round(prefs.volume * 100);
  return (
    <Card>
    <CardHeader><CardTitle id="feedback-h">Practice feedback</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <ul className="divide-y border-y">
        <li>
          <label className="flex min-h-11 w-full items-center justify-between gap-4 py-2">
            <span>Sound</span>
            <Switch checked={prefs.sound} onCheckedChange={(on) => saveFeedback({ sound: on })} aria-label="Sound" />
          </label>
        </li>
        <li className="flex min-h-11 w-full items-center justify-between gap-4 py-2">
          <label htmlFor="feedback-volume">Volume</label>
          <div className="flex max-w-xs flex-1 items-center gap-3">
            <Slider
              id="feedback-volume"
              min={0}
              max={100}
              value={[volume]}
              aria-valuetext={`${volume} percent`}
              onValueChange={(next) => saveFeedback({ volume: (next[0] ?? 0) / 100 })}
            />
            <span className="tabular-nums" aria-hidden>{volume}</span>
          </div>
        </li>
        <li>
          <label className="flex min-h-11 w-full items-center justify-between gap-4 py-2">
            <span>Spoken praise</span>
            <Switch checked={prefs.spoken} onCheckedChange={(on) => saveFeedback({ spoken: on })} aria-label="Spoken praise" />
          </label>
        </li>
        <li>
          <label className="flex min-h-11 w-full items-center justify-between gap-4 py-2">
            <span>Animation</span>
            <Switch checked={prefs.animation} onCheckedChange={(on) => saveFeedback({ animation: on })} aria-label="Animation" />
          </label>
        </li>
      </ul>
      {reduced && prefs.animation && !animationOn(prefs, reduced) && <p className="text-xs leading-4 text-muted-foreground">Animation stays off while this device asks for reduced motion.</p>}
    </CardContent>
    </Card>
  );
}

function Account({ onSignOut }: { onSignOut: () => void }) {
  const user = useSession().user;
  const email = user?.email ?? "";
  const plan = user?.plan ?? "";
  const access = !user ? "" : !user.is_valid ? "Access ended" : user.trial_expires_at ? `${plan || "Trial"} · ${user.days_left} ${user.days_left === 1 ? "day" : "days"} left` : plan || "Active";
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y overflow-hidden rounded-lg border">
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="brand-mark" style={{ background: "var(--primary)", color: "var(--primary-foreground)", borderRadius: "50%", width: 40, height: 40 }} aria-hidden>{initials(email)}</span>
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="font-medium">{email}</span>
            <span className="text-sm text-muted-foreground">Signed in on this device</span>
          </span>
        </li>
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="font-medium">Access</span>
            <span className="text-sm text-muted-foreground">Your cards, history and hours stay in your account.</span>
          </span>
          {access && <Badge variant={user?.is_valid ? "secondary" : "outline"}>{access}</Badge>}
        </li>
      </ul>
      <Button type="button" variant="outline" style={{ alignSelf: "flex-start" }} onClick={onSignOut}>{<LogOut aria-hidden />}Sign out</Button>
    </div>
  );
}

function Devices() {
  const [list, setList] = useState<{ devices: Device[]; max: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => {
    setError("");
    listDevices()
      .then((r) => setList({ devices: r.devices, max: r.max_devices }))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn’t load your devices."));
  };
  useEffect(load, []);
  const end = async (d: Device) => {
    setBusy(d.id);
    try {
      await signOutDevice(d.id);
      setList((l) => (l ? { ...l, devices: l.devices.filter((x) => x.id !== d.id) } : l));
      announce("Signed out on that device.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t sign that device out.");
    } finally {
      setBusy("");
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle id="devices-h">Signed-in devices</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
      {!list && !error && <Spinner label="Loading devices…" />}
      {error && <Alert variant="destructive" role="alert"><AlertTitle>Something went wrong</AlertTitle><AlertDescription>{error}<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={load}>Retry</Button></div></AlertDescription></Alert>}
      {list && (
        <>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {list.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Monitor aria-hidden width={20} height={20} />
                <span className="min-w-0 flex-1 flex flex-col">
                  <span className="font-medium">{d.device || "Unknown device"}</span>
                  <span className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span>Last active {fmtWhen(d.last_seen_at)}</span><span>Signed in {fmtWhen(d.created_at)}</span></span>
                </span>
                {d.current ? <Badge variant="secondary">This device</Badge> : <Button type="button" variant="ghost" aria-disabled={(!!(busy === d.id)) || undefined} aria-busy={busy === d.id || undefined} className={cn((!!(busy === d.id)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy === d.id)) { event.preventDefault(); return; } (() => void end(d))(); }}>{busy === d.id ? <Loader2 className="animate-spin" aria-hidden /> : null}Sign out</Button>}
              </li>
            ))}
          </ul>
          <p className="text-xs leading-4 text-muted-foreground">Up to {list.max} devices can be signed in at once; signing in on another one signs out the one used least recently.</p>
        </>
      )}
      </CardContent>
    </Card>
  );
}

/* SCR-AUTH-02 */
function SignOutDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Sign out on this device?"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" data-autofocus onClick={onClose}>Cancel</Button>
          <Button type="button" variant="default" aria-disabled={(!!(busy)) || undefined} aria-busy={busy || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => {
              setBusy(true);
              stopPlayback();
              announce("Signing out…");
              void logout().finally(() => location.assign(loginUrl("")));
            })(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : (<LogOut aria-hidden />)}Sign out</Button>
        </>
      }
    >

    </Dialog>
  );
}
