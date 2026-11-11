import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LogOut, ArrowRight, Monitor } from "lucide-react";
import { MAX_SESSION_SIZE, MIN_SESSION_SIZE } from "../data/fixtures";
import { type Device, listDevices, logout, signOutDevice, useSession } from "../api/auth";
import { loginUrl } from "../api/client";
import { saveReviewSettings } from "../api/review";
import { initials } from "../components/Shell";
import { SPEEDS, announce, get, go, routeUrl, set, setDailyNew, setPlaybackPrefs, setSessionSize, stopPlayback, useApp } from "../state/store";
import { fmtWhen } from "../api/history";
import { Banner, Button, Dialog, FieldText, PageHead, Pill, Spinner } from "../components/ui";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { animationOn, feedbackPrefs, prefersReducedMotion, saveFeedback, subscribeFeedback } from "../lib/feedback";

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
    <div className="stack gap-3" style={{ maxWidth: 520 }}>
      <div className="row row--top gap-3" style={{ alignItems: "flex-end" }}>
        <div style={{ width: 200 }}>
          <FieldText
            label="Daily new cards"
            name="daily-new"
            spellCheck={false}
            inputMode="numeric"
            value={value}
            onChange={(v) => {
              setValue(v);
              setState("idle");
            }}
            error={error}
            help={compact ? undefined : "0 to 200 new cards per day."}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <Button kind="secondary" busy={state === "saving"} onClick={save} style={{ marginBottom: error ? 28 : 0 }}>
          {state === "failed" ? "Retry" : "Save limit"}
        </Button>
      </div>
      {valid && n === 0 && <p className="t-support">0 means no new cards are introduced. Due reviews continue.</p>}
      {valid && n === 200 && <p className="t-support">200 is the highest daily limit.</p>}
      {valid && n < newUsed && <p className="t-support">You’ve already introduced {newUsed} new cards today. They stay; no more will be introduced today.</p>}
      {state === "saving" && <Spinner label="Saving…" />}
      {state === "saved" && <p className="t-support" role="status" style={{ color: "var(--success)" }}>Saved. Daily new cards: {dailyNew}.</p>}
      {state === "failed" && <Banner tone="error" title="Couldn’t save the daily limit" live="assertive">Your previous limit ({dailyNew}) is still in use.</Banner>}
      {state === "offline" && <Banner tone="warning" title="Saved on this device" live="polite">It will sync when you’re back online. New-card allowances can’t be assigned until then.</Banner>}
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
    <div className="stack gap-3" style={{ maxWidth: 520 }}>
      <div className="row row--top gap-3" style={{ alignItems: "flex-end" }}>
        <div style={{ width: 200 }}>
          <FieldText
            label="Cards per review session"
            name="session-size"
            spellCheck={false}
            inputMode="numeric"
            value={value}
            onChange={(v) => {
              setValue(v);
              setState("idle");
            }}
            error={error}
            help={`${MIN_SESSION_SIZE} to ${MAX_SESSION_SIZE} cards. Learning and due reviews come first.`}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <Button kind="secondary" busy={state === "saving"} onClick={save} style={{ marginBottom: error ? 28 : 0 }}>
          {state === "failed" ? "Retry" : "Save size"}
        </Button>
      </div>
      {valid && n === MIN_SESSION_SIZE && <p className="t-support">{MIN_SESSION_SIZE} is the smallest session.</p>}
      {valid && n === MAX_SESSION_SIZE && <p className="t-support">{MAX_SESSION_SIZE} is the largest session.</p>}
      {lockedSize !== null && (
        <p className="t-support">Your session in progress stays at {lockedSize} cards. A new size applies from your next session.</p>
      )}
      {state === "saving" && <Spinner label="Saving…" />}
      {state === "saved" && <p className="t-support" role="status" style={{ color: "var(--success)" }}>Saved. Cards per review session: {sessionSize}. Applies from your next session.</p>}
      {state === "failed" && <Banner tone="error" title="Couldn’t save the session size" live="assertive">Your previous size ({sessionSize}) is still in use.</Banner>}
      {state === "offline" && <Banner tone="warning" title="Saved on this device" live="polite">It will sync when you’re back online.</Banner>}
    </div>
  );
}

export function SettingsScreen({ sub }: { sub?: string }) {
  const route = useApp((s) => s.route);
  const [signOut, setSignOut] = useState(route.includes("signout"));
  const accountRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sub === "account") requestAnimationFrame(() => accountRef.current?.scrollIntoView({ block: "start" }));
    if (route.includes("signout")) setSignOut(true);
  }, [sub, route]);
  return (
    <div className="page settings-page">
      <PageHead title="Settings" />
      <div className="stack gap-7">
        <section className="stack gap-5" aria-labelledby="pref-h">
          <h2 id="pref-h" className="t-section">Review</h2>
          <DailyLimitField />
          <SessionSizeField />
        </section>
        <Playback />
        <FeedbackSettings />
        <section ref={accountRef} className="stack gap-5" aria-labelledby="acct-h" style={{ scrollMarginTop: 16 }}>
          <h2 id="acct-h" className="t-section">Account</h2>
          <Account onSignOut={() => setSignOut(true)} />
        </section>
        <Devices />
        <section className="stack gap-3" aria-labelledby="dev-h">
          <h2 id="dev-h" className="t-section">Background listening</h2>
          <p className="t-support">How listening time is counted on phones and computers, and what still needs testing.</p>
          <Button kind="secondary" iconAfter={<ArrowRight aria-hidden />} onClick={() => go("progress/devices")} style={{ alignSelf: "flex-start" }}>
            Devices and background listening
          </Button>
        </section>
      </div>
      {signOut && <SignOutDialog onClose={() => { setSignOut(false); if (get().route.includes("signout")) history.replaceState(null, "", routeUrl("settings/account")); }} />}
    </div>
  );
}

/** Saved on this device as soon as it changes. */
function Playback() {
  const settings = useApp((s) => s.settings);
  return (
    <section className="stack gap-4" aria-labelledby="play-h">
      <h2 id="play-h" className="t-section">Playback on this device</h2>
      <div className="row gap-4" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ width: 200 }}>
          <span className="field-label">Default playback speed</span>
          <select className="select" value={settings.speed} onChange={(e) => { setPlaybackPrefs({ speed: Number(e.target.value) }); announce("Speed saved on this device."); }}>
            {SPEEDS.map((v) => <option key={v} value={v}>{`${v}\u00a0×`}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.repeat} onChange={(e) => { setPlaybackPrefs({ repeat: e.target.checked }); announce("Saved on this device."); }} /> Repeat audio by default
        </label>
      </div>
      <p className="t-support">
        Saved on this device only. Practice listening clips always play once at their own speed. Days are counted in this device’s time zone ({settings.timezone}).
      </p>
    </section>
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
    <section className="stack gap-4" aria-labelledby="feedback-h">
      <h2 id="feedback-h" className="t-section">Practice feedback</h2>
      <ul className="feedback-list">
        <li>
          <label className="feedback-row">
            <span>Sound</span>
            <Switch checked={prefs.sound} onCheckedChange={(on) => saveFeedback({ sound: on })} aria-label="Sound" />
          </label>
        </li>
        <li className="feedback-row">
          <label htmlFor="feedback-volume">Volume</label>
          <div className="feedback-slider">
            <Slider
              id="feedback-volume"
              min={0}
              max={100}
              value={[volume]}
              aria-valuetext={`${volume} percent`}
              onValueChange={(next) => saveFeedback({ volume: (next[0] ?? 0) / 100 })}
            />
            <span className="num" aria-hidden>{volume}</span>
          </div>
        </li>
        <li>
          <label className="feedback-row">
            <span>Spoken praise</span>
            <Switch checked={prefs.spoken} onCheckedChange={(on) => saveFeedback({ spoken: on })} aria-label="Spoken praise" />
          </label>
        </li>
        <li>
          <label className="feedback-row">
            <span>Animation</span>
            <Switch checked={prefs.animation} onCheckedChange={(on) => saveFeedback({ animation: on })} aria-label="Animation" />
          </label>
        </li>
      </ul>
      {reduced && prefs.animation && !animationOn(prefs, reduced) && <p className="t-meta">Animation stays off while this device asks for reduced motion.</p>}
    </section>
  );
}

function Account({ onSignOut }: { onSignOut: () => void }) {
  const user = useSession().user;
  const email = user?.email ?? "";
  const plan = user?.plan ?? "";
  const access = !user ? "" : !user.is_valid ? "Access ended" : user.trial_expires_at ? `${plan || "Trial"} · ${user.days_left} ${user.days_left === 1 ? "day" : "days"} left` : plan || "Active";
  return (
    <div className="stack gap-3">
      <ul className="list">
        <li className="list-row">
          <span className="brand-mark" style={{ background: "var(--text)", borderRadius: "50%", width: 40, height: 40 }} aria-hidden>{initials(email)}</span>
          <span className="grow stack">
            <span className="t-strong">{email}</span>
            <span className="t-support">Signed in on this device</span>
          </span>
        </li>
        <li className="list-row">
          <span className="grow stack">
            <span className="t-strong">Access</span>
            <span className="t-support">Your cards, history and hours stay in your account.</span>
          </span>
          {access && <Pill tone={user?.is_valid ? "success" : "warning"}>{access}</Pill>}
        </li>
      </ul>
      <Button kind="secondary" icon={<LogOut aria-hidden />} onClick={onSignOut} style={{ alignSelf: "flex-start" }}>Sign out</Button>
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
    <section className="stack gap-3" aria-labelledby="devices-h">
      <h2 id="devices-h" className="t-section">Signed-in devices</h2>
      {!list && !error && <Spinner label="Loading devices…" />}
      {error && <Banner tone="error" title="Something went wrong" live="assertive" actions={<Button kind="secondary" onClick={load}>Retry</Button>}>{error}</Banner>}
      {list && (
        <>
          <ul className="list">
            {list.devices.map((d) => (
              <li key={d.id} className="list-row">
                <Monitor aria-hidden width={20} height={20} />
                <span className="grow stack">
                  <span className="t-strong">{d.device || "Unknown device"}</span>
                  <span className="t-support meta-row"><span>Last active {fmtWhen(d.last_seen_at)}</span><span>Signed in {fmtWhen(d.created_at)}</span></span>
                </span>
                {d.current ? <Pill tone="info">This device</Pill> : <Button kind="tertiary" busy={busy === d.id} onClick={() => void end(d)}>Sign out</Button>}
              </li>
            ))}
          </ul>
          <p className="t-meta">Up to {list.max} devices can be signed in at once; signing in on another one signs out the one used least recently.</p>
        </>
      )}
    </section>
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
          <Button kind="secondary" onClick={onClose} data-autofocus>Cancel</Button>
          <Button
            kind="primary"
            icon={<LogOut aria-hidden />}
            busy={busy}
            onClick={() => {
              setBusy(true);
              stopPlayback();
              announce("Signing out…");
              void logout().finally(() => location.assign(loginUrl("")));
            }}
          >
            Sign out
          </Button>
        </>
      }
    >
      <p>Your cards, history and progress stay in your account and come back when you sign in again.</p>
    </Dialog>
  );
}
