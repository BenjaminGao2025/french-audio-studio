import { useEffect, useRef, useState } from "react";
import { LogOut, ArrowRight } from "lucide-react";
import { DEMO_USER, MAX_SESSION_SIZE, MIN_SESSION_SIZE } from "../data/fixtures";
import { announce, get, go, set, setDailyNew, setSessionSize, simulate, stopPlayback, syncChange, useApp } from "../state/store";
import { Banner, Button, Dialog, FieldText, PageHead, Pill, Spinner } from "../components/ui";

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
    simulate("settings", 800, true)
      .then(() => {
        setDailyNew(n);
        setState("saved");
        announce(`Daily new cards set to ${n}.`);
        syncChange();
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
    simulate("settings", 800, true)
      .then(() => {
        setSessionSize(n);
        setState("saved");
        announce(`Cards per review session set to ${n}. It applies from your next session.`);
        syncChange();
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
    <div className="page">
      <PageHead title="Settings" desc="Learning preferences, your account and how this prototype handles syncing and devices." />
      <div className="stack gap-7">
        <Preferences />
        <TimeSettings />
        <DictionaryCache />
        <section ref={accountRef} className="stack gap-5" aria-labelledby="acct-h" style={{ scrollMarginTop: 16 }}>
          <SyncSection />
          <Account onSignOut={() => setSignOut(true)} />
        </section>
        <section className="stack gap-3" aria-labelledby="dev-h">
          <h2 id="dev-h" className="t-section">Proposed device support</h2>
          <p className="t-support">Background playback, lock-screen controls and counting on iPhone and Mac are proposals. Nothing here has been tested on a device.</p>
          <Button kind="secondary" iconAfter={<ArrowRight aria-hidden />} onClick={() => go("progress/devices")} style={{ alignSelf: "flex-start" }}>
            View device support
          </Button>
        </section>
        <section className="stack gap-3">
          <h2 className="t-section">For reviewers</h2>
          <Button kind="tertiary" onClick={() => go("design")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>Design reference and coverage</Button>
        </section>
      </div>
      {signOut && <SignOutDialog onClose={() => { setSignOut(false); if (get().route.includes("signout")) history.replaceState(null, "", "#/settings/account"); }} />}
    </div>
  );
}

function Preferences() {
  const settings = useApp((s) => s.settings);
  const forced = useApp((s) => s.ss["SCR-SET-01"]);
  const [speed, setSpeed] = useState(settings.speed);
  const [repeat, setRepeat] = useState(settings.repeat);
  const [state, setState] = useState<SaveState | "conflict">("idle");
  useEffect(() => {
    if (forced) setState(forced as SaveState | "conflict");
  }, [forced]);
  const save = () => {
    if (get().offline) {
      set((s) => ({ settings: { ...s.settings, speed, repeat }, sync: "pending" }));
      setState("offline");
      return;
    }
    setState("saving");
    simulate("settings", 800, true)
      .then(() => {
        set((s) => ({ settings: { ...s.settings, speed, repeat } }));
        setState("saved");
        announce("Preferences saved.");
        syncChange();
      })
      .catch(() => {
        setState("failed");
        announce("Couldn’t save preferences.", true);
      });
  };
  return (
    <section className="stack gap-5" aria-labelledby="pref-h">
      <h2 id="pref-h" className="t-section">Learning preferences</h2>
      <DailyLimitField />
      <SessionSizeField />
      <hr className="divider" />
      <div className="stack gap-2">
        <p className="field-label">Voice</p>
        <p>Canadian French · Demo voice <Pill tone="demo">Simulated</Pill></p>
        <p className="t-support">The same demo voice is used every time, including when you repeat audio. It doesn’t represent the quality of a real voice.</p>
      </div>
      <div className="row gap-4" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ width: 200 }}>
          <span className="field-label">Default playback speed</span>
          <select className="select" value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); setState("idle"); }}>
            {[0.75, 1, 1.25, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => { setRepeat(e.target.checked); setState("idle"); }} /> Repeat audio by default</label>
      </div>
      <div className="stack gap-3" style={{ maxWidth: 560 }}>
        <div className="btn-row">
          <Button kind="secondary" busy={state === "saving"} onClick={save}>{state === "failed" ? "Retry" : "Save preferences"}</Button>
        </div>
        {state === "saving" && <Spinner label="Saving preferences…" />}
        {state === "saved" && <p role="status" className="t-support" style={{ color: "var(--success)" }}>Preferences saved.</p>}
        {state === "failed" && <Banner tone="error" title="Couldn’t save preferences" live="assertive">Your previous preferences are still in use.</Banner>}
        {state === "offline" && <Banner tone="warning" title="Saved on this device">Your preferences will sync when you’re back online (simulated).</Banner>}
        {state === "conflict" && (
          <Banner
            tone="warning"
            title="This setting changed on another device"
            actions={
              <>
                <Button kind="secondary" onClick={() => { setState("saved"); announce("Kept this device’s setting."); }}>Keep {speed}× (this device)</Button>
                <Button kind="tertiary" onClick={() => { setSpeed(1.25); set((s) => ({ settings: { ...s.settings, speed: 1.25 } })); setState("saved"); }}>Use 1.25× (other device)</Button>
              </>
            }
          >
            Default speed was set to 1.25× on another device (simulated) while you changed it here. Choose which to keep.
          </Banner>
        )}
      </div>
    </section>
  );
}

function TimeSettings() {
  const tz = useApp((s) => s.settings.timezone);
  return (
    <section className="stack gap-3" aria-labelledby="time-h">
      <h2 id="time-h" className="t-section">Time zone and week</h2>
      <label className="field" style={{ maxWidth: 320 }}>
        <span className="field-label">Account time zone</span>
        <select className="select" value={tz} onChange={(e) => { set((s) => ({ settings: { ...s.settings, timezone: e.target.value } })); announce("Time zone changed. Totals already counted stay the same."); syncChange(); }}>
          {["America/Toronto", "America/Vancouver", "America/Halifax", "Europe/Paris", "Asia/Shanghai"].map((z) => <option key={z}>{z}</option>)}
        </select>
      </label>
      <p className="t-support" style={{ maxWidth: 640 }}>
        Days start at local midnight in this time zone. Weeks start on Monday in this prototype. Changing the time zone affects future day boundaries only — audio time you already have stays the same.
      </p>
    </section>
  );
}

function DictionaryCache() {
  const count = useApp((s) => Object.keys(s.snapshots).length);
  return (
    <section className="stack gap-3" aria-labelledby="dict-h">
      <h2 id="dict-h" className="t-section">Dictionary on this device</h2>
      <ul className="list">
        <li className="list-row"><span className="grow">Saved definitions</span><span className="num">{count} (simulated)</span></li>
        <li className="list-row"><span className="grow">Full offline dictionary package</span><span className="t-support">Not available in this prototype</span></li>
      </ul>
      <p className="t-support">Saved definitions can be shown offline. They don’t include audio, AI explanations or exams.</p>
    </section>
  );
}

function SyncSection() {
  const sync = useApp((s) => s.sync);
  const offline = useApp((s) => s.offline);
  const forced = useApp((s) => s.ss["SCR-SET-02"]);
  const state = forced || sync;
  return (
    <div className="stack gap-3">
      <h2 id="acct-h" className="t-section">Account and sync</h2>
      {state === "synced" && <Banner tone="success" title="Everything is synced (simulated)">Your demo changes are up to date.</Banner>}
      {state === "pending" && (
        <Banner tone="info" title={offline ? "Waiting for a connection" : "Syncing your changes…"} live="polite">
          {offline ? "Some changes are saved on this device and will sync automatically when you’re back online." : "This usually takes a moment."}
        </Banner>
      )}
      {state === "error" && (
        <Banner tone="error" title="Sync didn’t finish" live="assertive" actions={<Button kind="secondary" onClick={syncChange}>Retry sync</Button>}>
          Your changes are kept on this device. Nothing was lost.
        </Banner>
      )}
      {state === "conflict" && (
        <Banner tone="warning" title="A change conflicts with another device" actions={<Button kind="secondary" onClick={() => go("settings")}>Review the setting</Button>}>
          Your default playback speed was changed on another device at the same time (simulated). Open Learning preferences to choose which to keep.
        </Banner>
      )}
      <p className="t-meta">Cross-device sync is simulated in this prototype. There is no real server.</p>
    </div>
  );
}

function Account({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="stack gap-3">
      <ul className="list">
        <li className="list-row">
          <span className="brand-mark" style={{ background: "#475569", borderRadius: "50%", width: 40, height: 40 }} aria-hidden>{DEMO_USER.initials}</span>
          <span className="grow stack">
            <span className="t-strong">{DEMO_USER.name}</span>
            <span className="t-support">{DEMO_USER.label}</span>
          </span>
        </li>
        <li className="list-row">
          <span className="grow stack">
            <span className="t-strong">Access</span>
            <span className="t-support">Shared with you by a friend. Your existing data and access stay as they are.</span>
          </span>
          <Pill tone="success">Free · Unlimited access</Pill>
        </li>
      </ul>
      <Button kind="secondary" icon={<LogOut aria-hidden />} onClick={onSignOut} style={{ alignSelf: "flex-start" }}>Sign out</Button>
    </div>
  );
}

/* SCR-AUTH-02 */
function SignOutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Sign out of the demo account?"
      onClose={onClose}
      footer={
        <>
          <Button kind="secondary" onClick={onClose} data-autofocus>Cancel</Button>
          <Button
            kind="primary"
            icon={<LogOut aria-hidden />}
            onClick={() => {
              stopPlayback();
              set(() => ({ auth: "out", signIn: "idle", menuOpen: false }));
              announce("Signed out. Your demo data is kept for when you sign in again.");
              go("review");
            }}
          >
            Sign out
          </Button>
        </>
      }
    >
      <p>Your fictional demo data stays saved — cards, history, progress, settings and friend access come back when you sign in again.</p>
    </Dialog>
  );
}
