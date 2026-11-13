import { useExplanationLanguage } from "../lib/explanationLanguage";
import { useTheme } from "../lib/theme";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, BookOpen, CloudOff, Dumbbell, Layers, LogOut, Pause, Play, RefreshCw, RotateCcw, Settings as SettingsIcon, Square, CheckCircle2, AlertCircle, Clock, User, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "../api/auth";
import { undoMastered } from "../api/review";
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
  updatePlayer,
  useApp,
} from "../state/store";
import { WidthContext } from "./ui";
import { Brand } from "./Brand";
import { VersionInfo } from "./VersionInfo";
import { Progress } from "./ui/progress";
import { Toaster } from "./ui/sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "./ui/breadcrumb";
import { Separator } from "./ui/separator";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { cn } from "cn";

export const NAV = [
  { key: "study", label: "Study", icon: BookOpen },
  { key: "review", label: "Review", icon: Layers },
  { key: "practice", label: "Practice", icon: Dumbbell },
  { key: "progress", label: "Progress", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;

export function Frame({ children }: { children: ReactNode }) {
  const frame = useApp((s) => s.frame);
  if (frame === "fluid") return <div className="h-full">{children}</div>;
  if (frame === "iphone")
    return (
      <div className="flex min-h-full flex-col items-center gap-3 overflow-auto p-6">
        <p className="max-w-xl text-center text-sm text-muted-foreground">iPhone-sized layout (390 × 844). Browser simulation.</p>
        <div className="h-[844px] w-[390px] max-w-full overflow-hidden rounded-[2.5rem] border bg-background p-3">{children}</div>
      </div>
    );
  return (
    <div className="flex min-h-full flex-col items-center gap-3 overflow-auto p-6">
      <p className="max-w-xl text-center text-sm text-muted-foreground">Resizable window. Browser simulation.</p>
      <div className="flex h-[720px] w-[1080px] max-w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">{children}</div>
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
      <div className="relative h-full bg-background" ref={ref} id="app-root">
        {children}
      </div>
    </WidthContext.Provider>
  );
}

const isConnected = (route: string) => ["study", "review", "login", "progress", "practice", "settings", "moved"].some((r) => route === r || route.startsWith(`${r}/`) || route.startsWith(`${r}?`));
const pathOf = (route: string) => route.split("?")[0];

function AppSidebar() {
  const route = useApp((s) => s.route);
  const top = pathOf(route).split("/")[0];
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pt-[calc(0.5rem+var(--safe-top))]">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => {
                const Icon = n.icon;
                const active = top === n.key;
                return (
                  <SidebarMenuItem key={n.key}>
                    <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                      <a
                        href={routeUrl(n.key)}
                        aria-current={active ? "page" : undefined}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                          e.preventDefault();
                          go(n.key);
                        }}
                      >
                        <Icon aria-hidden />
                        <span>{n.label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="pb-safe">
        <VersionInfo />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function FocusBar() {
  const route = useApp((s) => s.route);
  const review = useApp((s) => s.review);
  const activeRun = useApp((s) => s.activeRun);
  const kind = useApp((s) => (activeRun ? s.exercises[activeRun]?.kind : undefined));
  const path = pathOf(route);
  if (path === "review/session") {
    const total = review.sessionCards?.length ?? 0;
    const n = total > 0 ? Math.min(total, review.index + 1) : 0;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button type="button" variant="ghost" onClick={() => go("review")}>Exit</Button>
        <span className="shrink-0 font-medium">Review</span>
        {total > 0 && (
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Progress value={(n / total) * 100} aria-label="Session progress" className="h-1.5 w-20 sm:w-48" />
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{n} / {total}</span>
          </div>
        )}
      </div>
    );
  }
  const back = kind === "Dictation" ? "study/dictation" : kind === "Recall" ? "study/recall" : "study";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Button type="button" variant="ghost" onClick={() => go(back)}>Exit</Button>
      <span className="font-medium">{kind ?? "Practice"}</span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const path = pathOf(route);
  const focused = path === "review/session" || path === "study/run";
  const top = path.split("/")[0];
  const section = NAV.find((n) => n.key === top)?.label ?? "1000H French";
  // On a studied text, starting a new one is a visible action, not something hidden in a menu.
  const studying = useApp((s) => pathOf(s.route) === "study" && s.study.analysis.status === "done" && s.study.sentences.length > 0);
  return (
    <TooltipProvider>
      <SidebarProvider className="pl-[var(--safe-left)] pr-[var(--safe-right)]">
        {!focused && <AppSidebar />}
        <SidebarInset id="main" tabIndex={-1} className="main flex h-svh min-w-0 flex-col overflow-y-auto bg-background">
          <a
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
            href="#main"
            onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}
          >
            Skip to main content
          </a>
          <header className="sticky top-0 z-20 flex min-h-[calc(3.5rem+var(--safe-top))] shrink-0 items-center gap-2 border-b bg-background px-3 pt-safe">
            {focused ? <FocusBar /> : (
              <>
                <SidebarTrigger />
                <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-auto" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>{section}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              {studying && !focused && <Button type="button" variant="ghost" onClick={() => go("study/new")}><Plus aria-hidden />New text</Button>}
              {focused && path !== "review/session" && <VersionInfo />}
              <AccountSlot />
            </div>
          </header>
          {!isConnected(route) && (
            <div className="mx-auto w-full max-w-3xl mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert variant="default"><AlertTitle>Demo data — not connected yet</AlertTitle><AlertDescription>You are signed in for real, but this screen still shows sample data. Nothing you do here is saved to your account yet.</AlertDescription></Alert>
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col px-4 pt-4 md:px-0 md:pt-6">{children}</div>
          <GlobalPlayer />
        </SidebarInset>
        <Toaster
          offset={{ top: "calc(2rem + var(--safe-top))", bottom: "calc(2rem + var(--safe-bottom))", left: "calc(2rem + var(--safe-left))", right: "calc(2rem + var(--safe-right))" }}
          mobileOffset={{ top: "calc(1rem + var(--safe-top))", bottom: "calc(1rem + var(--safe-bottom))", left: "calc(1rem + var(--safe-left))", right: "calc(1rem + var(--safe-right))" }}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AccountSlot() {
  const [theme, chooseTheme] = useTheme();
  const [language, chooseLanguage] = useExplanationLanguage();
  const auth = useApp((s) => s.auth);
  const offline = useApp((s) => s.offline);
  const sync = useApp((s) => s.sync);
  const menuOpen = useApp((s) => s.menuOpen);
  const route = useApp((s) => s.route);
  const user = useSession().user;
  const email = user?.email ?? "";
  return (
    <>
      {offline && <Badge variant="outline">{<CloudOff aria-hidden />}Offline, simulated</Badge>}
      {auth === "in" && !isConnected(route) && <SyncIndicator sync={sync} offline={offline} />}
      {auth === "in" ? (
        <DropdownMenu open={menuOpen} onOpenChange={(open) => set(() => ({ menuOpen: open }))}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`Account menu, ${email}`}><span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground" aria-hidden>
                {initials(email)}
              </span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme} aria-label="Theme">
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Explanation language</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={language} onValueChange={chooseLanguage} aria-label="Explanation language">
              <DropdownMenuRadioItem value="en">Simple English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh">中文</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => go("settings/account")}>
              <User aria-hidden />
              Account and sync
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go("settings/account?signout")}>
              <LogOut aria-hidden />
              Sign out…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Badge variant="outline">Signed out</Badge>
      )}
    </>
  );
}

export function initials(email: string): string {
  return (email.trim()[0] ?? "?").toUpperCase();
}

function SyncIndicator({ sync, offline }: { sync: string; offline: boolean }) {
  if (sync === "synced")
    return (
      <span className="hidden items-center gap-1 md:inline-flex">
        <Badge variant="secondary">{<CheckCircle2 aria-hidden />}Synced · simulated</Badge>
      </span>
    );
  if (sync === "pending")
    return (
      <Button type="button" variant="ghost" onClick={() => go("settings/account")}><Clock aria-hidden /> {offline ? "Changes waiting for connection" : "Sync pending"}</Button>
    );
  return (
    <Button type="button" variant="destructive" onClick={() => syncChange()}><AlertCircle aria-hidden /> Sync failed · Retry</Button>
  );
}

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
  const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  return (
    <section className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-background px-4 py-2 pb-[calc(0.5rem+var(--safe-bottom))]" aria-label={`Player: ${p.owner.label}`}>
      {p.status === "error" ? (
        <Button type="button" variant="outline" size="icon" aria-label={`Retry ${p.owner.label}`} onClick={retryPlayback}>{<RotateCcw aria-hidden />}</Button>
      ) : p.status === "playing" || p.status === "buffering" ? (
        <Button type="button" variant="outline" size="icon" aria-label={`Pause ${p.owner.label}`} onClick={() => updatePlayer({ status: "paused" })}>{<Pause aria-hidden />}</Button>
      ) : (
        <Button type="button" variant="outline" size="icon" aria-disabled={(!!(p.status === "loading")) || undefined} aria-busy={p.status === "loading" || undefined} aria-label={`Play ${p.owner.label}`} className={cn((!!(p.status === "loading")) ? "opacity-50" : "")} onClick={(event) => { if (!!(p.status === "loading")) { event.preventDefault(); return; } (() => updatePlayer(p.status === "ended" ? { status: "playing", position: 0 } : { status: "playing" }))(); }}>{p.status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : (<Play aria-hidden />)}</Button>
      )}
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium">{p.owner.label}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {statusText[p.status]} · {fmtClock(p.position)} / {fmtClock(p.duration)} · {p.speed}×{p.texts ? "" : " · Simulated audio"}
        </p>
        <Progress value={pct} className="mt-1" />
      </div>
      <Button type="button" variant="ghost" onClick={() => go(p.owner.route)}>{p.owner.kind === "episode" ? "Return to episode" : p.owner.kind === "exercise" ? "Return to practice" : "Return to source"}</Button>
      <Button type="button" variant="ghost" size="icon" aria-label={`Stop ${p.owner.label}`} onClick={stopPlayback}>{<Square aria-hidden />}</Button>
    </section>
  );
}

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

  const visible = [...mastery]
    .reverse()
    .filter((m) => !dismissed[`${m.id}:${m.state}`])
    .slice(0, 3);

  if (!visible.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-[calc(1rem+var(--safe-bottom))] left-1/2 z-50 flex w-[min(32rem,calc(100%-1.5rem-var(--safe-left)-var(--safe-right)))] -translate-x-1/2 flex-col gap-2">
      {visible.map((m, idx) => {
        const left = Math.max(0, Math.ceil((UNDO_MS - (now - m.at)) / 1000));
        const card = cards.find((c) => c.id === m.cardId);
        const kindLabel = card ? `${card.kind} card` : "Card";
        const cardName = card ? `${card.kind} card${card.word ? ` · ${card.word}` : ""}` : "card";
        let body: ReactNode;
        if (m.state === "active")
          body = (
            <>
              <span className="min-w-0 flex-1 text-sm">
                {kindLabel} marked mastered · hidden from your default review. Nothing was deleted.{" "}
                <span aria-hidden className="tabular-nums">({left} s to undo)</span>
              </span>
              <Button type="button" variant="ghost" aria-label={`Undo mastered: ${cardName}`} data-autofocus={idx === 0 || undefined} onClick={() => undoMastered(m.id)}>Undo</Button>
            </>
          );
        else if (m.state === "undone")
          body = <span className="text-sm">Undo applied ({kindLabel.toLowerCase()}). The card is back in your default review.</span>;
        else if (m.state === "expired")
          body = (
            <>
              <span className="min-w-0 flex-1 text-sm">The 6-second Undo window has ended ({kindLabel.toLowerCase()}). You can restore this card from Mastered at any time.</span>
              <Button type="button" variant="ghost" onClick={() => go("review/mastered")}>Open Mastered</Button>
            </>
          );
        else if (m.state === "queued")
          body = (
            <span className="text-sm">
              Undo saved on this device at {(((m.undoAt ?? m.at) - m.at) / 1000).toFixed(1)} s — on time.{" "}
              {offline ? "It will sync when you are back online." : "Syncing…"}
            </span>
          );
        else if (m.state === "syncing") body = <span className="text-sm">Syncing your on-time Undo… (simulated delay)</span>;
        else
          body = (
            <>
              <span className="min-w-0 flex-1 text-sm">
                Your Undo was on time, but this card was marked mastered again later on another device (simulated). The later decision is kept.
              </span>
              <Button type="button" variant="ghost" onClick={() => go("review/mastered")}>Review card</Button>
              <Button type="button" variant="ghost" onClick={() => setDismissed((d) => ({ ...d, [`${m.id}:${m.state}`]: true }))}>Dismiss</Button>
            </>
          );
        return (
          <div key={m.id} className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm" role="group" aria-label={`Mastery update ${m.cardId}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const t of toasts) {
      const id = String(t.id);
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      toast(t.text);
    }
  }, [toasts]);
  return <MasteryToast />;
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
