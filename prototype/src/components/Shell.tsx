import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  CloudOff,
  Dumbbell,
  Layers,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  Ruler,
  User,
} from "lucide-react";
import { DEMO_USER } from "../data/fixtures";
import { cx, fmtClock } from "../lib/format";
import {
  UNDO_MS,
  get,
  go,
  retryPlayback,
  set,
  stopPlayback,
  syncChange,
  undoMastery,
  updatePlayer,
  useApp,
  type MasteryAction,
} from "../state/store";
import { Button, Pill, WidthContext } from "./ui";

export const NAV = [
  { key: "study", label: "Study", icon: BookOpen },
  { key: "review", label: "Review", icon: Layers },
  { key: "practice", label: "Practice", icon: Dumbbell },
  { key: "progress", label: "Progress", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;

export function Frame({ children }: { children: ReactNode }) {
  const frame = useApp((s) => s.frame);
  const macWidth = useApp((s) => s.macWidth);
  const macRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (frame === "mac" && macRef.current) macRef.current.style.width = `${macWidth}px`;
  }, [frame, macWidth]);
  if (frame === "fluid") return <div className="stage stage--fluid"><div className="frame">{children}</div></div>;
  if (frame === "iphone")
    return (
      <div className="stage stage--device">
        <p className="frame-caption">iPhone-sized layout (390 × 844) · browser simulation, not a native app or device test</p>
        <div className="frame--iphone">{children}</div>
      </div>
    );
  return (
    <div className="stage stage--device">
      <p className="frame-caption">Resizable Mac-style window · drag the lower-right corner, or use Demo states → Frame width. Browser simulation only.</p>
      <div className="frame--mac" ref={macRef}>
        <div className="mac-titlebar" aria-hidden>
          <span className="mac-dot" />
          <span className="mac-dot" />
          <span className="mac-dot" />
          <span className="mac-title">1000H French — Demo</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AppRoot({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <WidthContext.Provider value={width}>
      <div className="app" ref={ref} id="app-root">
        {children}
      </div>
    </WidthContext.Provider>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const top = route.split("/")[0];
  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to main content
      </a>
      <nav className="nav" aria-label="Primary">
        <div className="nav-brand" aria-hidden>
          <span className="brand-mark">1000</span>
          <span>1000H French</span>
        </div>
        <ul className="nav-list">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = top === n.key;
            return (
              <li key={n.key}>
                <a
                  href={`#/${n.key}`}
                  className="nav-item"
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(n.key);
                  }}
                >
                  <span className="nav-ind"><Icon aria-hidden /></span>
                  <span>{n.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="nav-foot">
          <p className="t-meta">Fictional demo data · nothing leaves this browser</p>
        </div>
      </nav>
      <Header />
      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>
      <div className="player-slot">
        <GlobalPlayer />
      </div>
    </div>
  );
}

function Header() {
  const auth = useApp((s) => s.auth);
  const offline = useApp((s) => s.offline);
  const sync = useApp((s) => s.sync);
  const menuOpen = useApp((s) => s.menuOpen);
  const menuBtn = useRef<HTMLButtonElement>(null);
  return (
    <header className="header">
      <span className="header-brand" aria-hidden>
        <span className="brand-mark">1000</span>
        <span className="hide-narrow">1000H French</span>
      </span>
      <Pill tone="demo">Demo</Pill>
      {offline && <Pill tone="warning" icon={<CloudOff aria-hidden />}>Offline · simulated</Pill>}
      {auth === "in" && <SyncIndicator sync={sync} offline={offline} />}
      <Button
        kind="tertiary"
        className="btn--sm-text"
        icon={<SlidersHorizontal aria-hidden />}
        onClick={() => set(() => ({ demoOpen: true }))}
        aria-haspopup="dialog"
      >
        <span className="hide-narrow">Demo states</span>
        <span className="sr-only hide-wide">Demo states</span>
      </Button>
      {auth === "in" ? (
        <button
          ref={menuBtn}
          type="button"
          className="btn btn--tertiary btn--icon"
          aria-label={`Account menu, ${DEMO_USER.name}, demo account`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => set((s) => ({ menuOpen: !s.menuOpen }))}
        >
          <span className="brand-mark" style={{ background: "#475569", borderRadius: "50%" }} aria-hidden>
            {DEMO_USER.initials}
          </span>
        </button>
      ) : (
        <Pill>Signed out</Pill>
      )}
      {menuOpen && <AccountMenu onClose={() => { set(() => ({ menuOpen: false })); menuBtn.current?.focus(); }} />}
    </header>
  );
}

function SyncIndicator({ sync, offline }: { sync: string; offline: boolean }) {
  if (sync === "synced")
    return (
      <span className="pill pill--success hide-narrow">
        <CheckCircle2 aria-hidden /> Synced · simulated
      </span>
    );
  if (sync === "pending")
    return (
      <button type="button" className="btn btn--tertiary btn--sm-text" onClick={() => go("settings/account")}>
        <Clock aria-hidden /> {offline ? "Changes waiting for connection" : "Sync pending"}
      </button>
    );
  return (
    <button type="button" className="btn btn--tertiary btn--sm-text" style={{ color: "var(--error)" }} onClick={() => syncChange()}>
      <AlertCircle aria-hidden /> Sync failed · Retry
    </button>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", down));
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);
  const items: [string, ReactNode, () => void][] = [
    ["Account and sync", <User aria-hidden />, () => go("settings/account")],
    ["Design reference", <Ruler aria-hidden />, () => go("design")],
    ["Sign out…", <LogOut aria-hidden />, () => go("settings/account?signout")],
  ];
  return (
    <div
      ref={ref}
      className="popover menu"
      role="menu"
      aria-label="Account"
      onKeyDown={(e) => {
        const list = Array.from(ref.current!.querySelectorAll<HTMLElement>("[role=menuitem]"));
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
        if (e.key === "Tab") onClose();
      }}
    >
      <div style={{ padding: "8px 12px" }}>
        <p className="t-strong">{DEMO_USER.name}</p>
        <p className="t-meta">{DEMO_USER.label} · Free · Unlimited access</p>
      </div>
      <hr className="divider" />
      {items.map(([label, icon, fn]) => (
        <button key={label} role="menuitem" type="button" className="menu-item" tabIndex={-1} onClick={() => { set(() => ({ menuOpen: false })); fn(); }}>
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Compact global player (only during an active session, away from its owner) ---------- */
function GlobalPlayer() {
  const p = useApp((s) => s.player);
  const route = useApp((s) => s.route);
  if (!p) return null;
  const onOwner = route.split("?")[0] === p.owner.route.split("?")[0];
  if (onOwner) return null;
  const statusText: Record<string, string> = {
    loading: "Loading…",
    playing: "Playing",
    paused: "Paused",
    ended: "Ended",
    error: "Couldn't play",
    buffering: "Buffering…",
  };
  return (
    <section className="gplayer" aria-label={`Player: ${p.owner.label}`}>
      {p.status === "error" ? (
        <Button kind="secondary" iconOnly aria-label={`Retry ${p.owner.label}`} icon={<RotateCcw aria-hidden />} onClick={retryPlayback} />
      ) : p.status === "playing" || p.status === "buffering" ? (
        <Button kind="secondary" iconOnly aria-label={`Pause ${p.owner.label}`} icon={<Pause aria-hidden />} onClick={() => updatePlayer({ status: "paused" })} />
      ) : (
        <Button
          kind="secondary"
          iconOnly
          aria-label={`Play ${p.owner.label}`}
          icon={<Play aria-hidden />}
          busy={p.status === "loading"}
          onClick={() => updatePlayer(p.status === "ended" ? { status: "playing", position: 0 } : { status: "playing" })}
        />
      )}
      <div className="gplayer-meta">
        <span className="gplayer-title">{p.owner.label}</span>
        <span className="t-meta num">
          {statusText[p.status]} · {fmtClock(p.position)} / {fmtClock(p.duration)} · {p.speed}× · Simulated audio
        </span>
        <div className="progress-track" aria-hidden>
          <div className="progress-fill" style={{ width: `${Math.min(100, (p.position / p.duration) * 100)}%` }} />
        </div>
      </div>
      <Button kind="tertiary" className="btn--sm-text" onClick={() => go(p.owner.route)}>
        {p.owner.kind === "episode" ? "Return to episode" : p.owner.kind === "exercise" ? "Return to practice" : "Return to source"}
      </Button>
      <Button kind="tertiary" iconOnly aria-label={`Stop ${p.owner.label}`} icon={<Square aria-hidden />} onClick={stopPlayback} />
    </section>
  );
}

/* ---------- Mastery Undo toast: 6 s measured from the action ---------- */
export function MasteryToast() {
  const mastery = useApp((s) => s.mastery);
  const offline = useApp((s) => s.offline);
  const [now, setNow] = useState(Date.now());
  const last: MasteryAction | undefined = mastery[mastery.length - 1];
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  useEffect(() => {
    if (!last) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [last]);
  useEffect(() => {
    if (last?.state === "active" && now - last.at >= UNDO_MS) {
      set((s) => ({ mastery: s.mastery.map((m) => (m.id === last.id && m.state === "active" ? { ...m, state: "expired" } : m)) }));
    }
  }, [now, last]);
  // Hide finished toasts a few seconds after they settle.
  useEffect(() => {
    if (!last || last.state === "active" || last.state === "queued" || last.state === "syncing" || last.state === "conflict") return;
    const t = setTimeout(() => setHiddenId(last.id + last.state), 6000);
    return () => clearTimeout(t);
  }, [last]);
  if (!last || hiddenId === last.id + last.state) return null;
  const left = Math.max(0, Math.ceil((UNDO_MS - (now - last.at)) / 1000));
  let body: ReactNode;
  if (last.state === "active")
    body = (
      <>
        <span className="toast-text">
          Marked mastered · hidden from your default review. Nothing was deleted.{" "}
          <span aria-hidden className="num">({left} s to undo)</span>
        </span>
        <Button kind="tertiary" onClick={() => undoMastery(last.id)} data-autofocus>
          Undo
        </Button>
      </>
    );
  else if (last.state === "undone") body = <span className="toast-text">Undo applied. The card is back in your default review.</span>;
  else if (last.state === "expired")
    body = (
      <>
        <span className="toast-text">The 6-second Undo window has ended. You can restore this card from Mastered at any time.</span>
        <Button kind="tertiary" onClick={() => go("review/mastered")}>Open Mastered</Button>
      </>
    );
  else if (last.state === "queued")
    body = (
      <span className="toast-text">
        Undo saved on this device at {(((last.undoAt ?? last.at) - last.at) / 1000).toFixed(1)} s — on time.{" "}
        {offline ? "It will sync when you are back online." : "Syncing…"}
      </span>
    );
  else if (last.state === "syncing") body = <span className="toast-text">Syncing your on-time Undo… (simulated delay)</span>;
  else
    body = (
      <>
        <span className="toast-text">
          Your Undo was on time, but this card was marked mastered again later on another device (simulated). The later decision is kept.
        </span>
        <Button kind="tertiary" onClick={() => go("review/mastered")}>Review card</Button>
        <Button kind="tertiary" onClick={() => setHiddenId(last.id + last.state)}>Dismiss</Button>
      </>
    );
  return (
    <div className="toast" role="group" aria-label="Mastery update">
      {body}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const hasPlayer = useApp((s) => !!s.player);
  return (
    <div className="toasts" style={{ ["--toast-offset" as string]: hasPlayer ? "150px" : "84px" }}>
      <MasteryToast />
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Announcer() {
  const a = useApp((s) => s.announce);
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  useEffect(() => {
    if (!a.msg) return;
    if (a.assertive) setAssertive(a.msg);
    else setPolite(a.msg);
    const t = setTimeout(() => (a.assertive ? setAssertive("") : setPolite("")), 4000);
    return () => clearTimeout(t);
  }, [a.n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive">{assertive}</div>
    </>
  );
}

export function SyncRetryIcon() {
  return <RefreshCw aria-hidden />;
}

export { cx, get };
