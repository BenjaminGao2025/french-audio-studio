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
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
} from "lucide-react";
import { useSession } from "../api/auth";
import { cx, fmtClock } from "../lib/format";
import {
  UNDO_MS,
  expireMastery,
  nowMs,
  get,
  go,
  retryPlayback,
  routeUrl,
  set,
  stopPlayback,
  syncChange,
  undoMastery,
  updatePlayer,
  useApp,
} from "../state/store";
import { Banner, Button, Pill, WidthContext } from "./ui";

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
                  href={routeUrl(n.key)}
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
          <p className="t-meta">Only sign-in is connected so far</p>
        </div>
      </nav>
      <Header />
      <main className="main" id="main" tabIndex={-1}>
        <div className="demo-banner">
          <Banner tone="warning" title="Demo data — not connected yet">
            You are signed in for real, but the screens below still show sample data. Nothing you do here is saved to your account yet.
          </Banner>
        </div>
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
  const user = useSession().user;
  const email = user?.email ?? "";
  return (
    <header className="header">
      <span className="header-brand" aria-hidden>
        <span className="brand-mark">1000</span>
        <span className="hide-narrow">1000H French</span>
      </span>
      {offline && <Pill tone="warning" icon={<CloudOff aria-hidden />}>Offline · simulated</Pill>}
      {auth === "in" && <SyncIndicator sync={sync} offline={offline} />}
      {auth === "in" ? (
        <button
          ref={menuBtn}
          type="button"
          className="btn btn--tertiary btn--icon"
          aria-label={`Account menu, ${email}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => set((s) => ({ menuOpen: !s.menuOpen }))}
        >
          <span className="brand-mark" style={{ background: "#475569", borderRadius: "50%" }} aria-hidden>
            {initials(email)}
          </span>
        </button>
      ) : (
        <Pill>Signed out</Pill>
      )}
      {menuOpen && <AccountMenu email={email} onClose={() => { set(() => ({ menuOpen: false })); menuBtn.current?.focus(); }} />}
    </header>
  );
}

export function initials(email: string): string {
  return (email.trim()[0] ?? "?").toUpperCase();
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

function AccountMenu({ email, onClose }: { email: string; onClose: () => void }) {
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
        <p className="t-strong">{email}</p>
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

/* ---------- Mastery Undo toast: 6 s measured from each action ---------- */
export function MasteryToast() {
  const mastery = useApp((s) => s.mastery);
  const cards = useApp((s) => s.cards);
  const offline = useApp((s) => s.offline);
  const [now, setNow] = useState(nowMs());
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!mastery.length) return;
    const tickNow = () => {
      const t = nowMs();
      expireMastery(t);
      setNow(t);
    };
    tickNow();
    const timer = setInterval(tickNow, 200);
    return () => clearInterval(timer);
  }, [mastery.length]);

  // Auto-hide settled toasts ("undone" / "expired") 6 seconds after they settle.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const m of mastery) {
      if (m.state === "undone" || m.state === "expired") {
        const key = `${m.id}:${m.state}`;
        if (!dismissed[key]) {
          timers.push(setTimeout(() => setDismissed((d) => ({ ...d, [key]: true })), 6000));
        }
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [mastery, dismissed]);

  // Most recent first, at most 3 visible.
  const visible = [...mastery]
    .reverse()
    .filter((m) => !dismissed[`${m.id}:${m.state}`])
    .slice(0, 3);

  if (!visible.length) return null;

  return (
    <>
      {visible.map((m, idx) => {
        const left = Math.max(0, Math.ceil((UNDO_MS - (now - m.at)) / 1000));
        const card = cards.find((c) => c.id === m.cardId);
        const kindLabel = card ? `${card.kind} card` : "Card";
        const cardName = card ? `${card.kind} card${card.word ? ` · ${card.word}` : ""}` : "card";
        let body: ReactNode;
        if (m.state === "active")
          body = (
            <>
              <span className="toast-text">
                {kindLabel} marked mastered · hidden from your default review. Nothing was deleted.{" "}
                <span aria-hidden className="num">({left} s to undo)</span>
              </span>
              <Button
                kind="tertiary"
                aria-label={`Undo mastered: ${cardName}`}
                onClick={() => undoMastery(m.id)}
                data-autofocus={idx === 0 || undefined}
              >
                Undo
              </Button>
            </>
          );
        else if (m.state === "undone")
          body = <span className="toast-text">Undo applied ({kindLabel.toLowerCase()}). The card is back in your default review.</span>;
        else if (m.state === "expired")
          body = (
            <>
              <span className="toast-text">The 6-second Undo window has ended ({kindLabel.toLowerCase()}). You can restore this card from Mastered at any time.</span>
              <Button kind="tertiary" onClick={() => go("review/mastered")}>Open Mastered</Button>
            </>
          );
        else if (m.state === "queued")
          body = (
            <span className="toast-text">
              Undo saved on this device at {(((m.undoAt ?? m.at) - m.at) / 1000).toFixed(1)} s — on time.{" "}
              {offline ? "It will sync when you are back online." : "Syncing…"}
            </span>
          );
        else if (m.state === "syncing") body = <span className="toast-text">Syncing your on-time Undo… (simulated delay)</span>;
        else
          body = (
            <>
              <span className="toast-text">
                Your Undo was on time, but this card was marked mastered again later on another device (simulated). The later decision is kept.
              </span>
              <Button kind="tertiary" onClick={() => go("review/mastered")}>Review card</Button>
              <Button kind="tertiary" onClick={() => setDismissed((d) => ({ ...d, [`${m.id}:${m.state}`]: true }))}>Dismiss</Button>
            </>
          );
        return (
          <div key={m.id} className="toast" role="group" aria-label={`Mastery update ${m.cardId}`}>
            {body}
          </div>
        );
      })}
    </>
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
