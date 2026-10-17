import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  X,
  Sun,
  Clock,
  Flag,
  Library,
  LayoutGrid,
  BookOpen,
  Mic,
  Headphones,
  Layers,
  User,
  GraduationCap,
  Settings,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, navTo, withBlock } from "@/components/fr/kit-utils";
import { useBlockActions, useToday, nextBlock } from "@/api/hooks";
import { BlockTimer, SkipReasonSelect } from "@/components/fr/widgets";
import { useT } from "@/i18n";
import type { Lane, SkipReason } from "@/api/types";

export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn" | "bad";
}) {
  const t = {
    muted: "bg-secondary text-muted-foreground",
    accent: "bg-accent text-accent-foreground",
    warn: "bg-warn/15 text-foreground",
    bad: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        t,
      )}
    >
      {children}
    </span>
  );
}

export function Ring({
  value,
  size = 44,
  label,
}: {
  value: number;
  size?: number | undefined;
  label?: string;
}) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={4}
          className="fill-none stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, value))}
          className="fill-none stroke-primary transition-all duration-500"
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums">
        {label ?? `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}

const legacyLinks = [
  { href: "/study", label: "Intensive study" },
  { href: "/review", label: "Legacy review" },
  { href: "/listen", label: "Episodes (legacy)" },
  { href: "/write", label: "Legacy writing" },
  { href: "/speak", label: "Legacy speaking" },
  { href: "/coach", label: "Coach" },
  { href: "/", label: "Audio workbench" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();
  const item = (to: string, label: string, Icon: typeof Sun) => (
    <Link
      key={to}
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
        path === to
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-secondary",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
  const tabs = [
    { to: "/", label: t("today"), icon: Sun },
    { to: "/episodes", label: t("listen"), icon: Headphones },
    { to: "/cards", label: t("cards"), icon: Layers },
    { to: "/shadow", label: t("speak"), icon: Mic },
    { to: "/me", label: t("me"), icon: User },
  ] as const;
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-5 md:flex">
        <div className="mb-8 px-3">
          <div className="fr text-2xl font-semibold">1000H</div>
          <div className="text-xs text-muted-foreground">French · TCF Canada · NCLC 7</div>
        </div>
        <nav className="space-y-1">
          {item("/", t("today"), Sun)}
          {item("/hours", t("hours"), Clock)}
          {item("/decisions", t("decisions"), Flag)}
          {item("/items", t("itemBank"), Library)}
        </nav>
        <div className="mt-8 mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("modules")}
        </div>
        <nav className="space-y-1">
          {item("/reading", t("intensiveReading"), BookOpen)}
          {item("/speaking", t("speakingExam"), Mic)}
          {item("/writing", t("writingExam"), LayoutGrid)}
          {item("/tutor", t("tutor"), GraduationCap)}
          {item("/episodes", t("listen"), Headphones)}
        </nav>
        <div className="mt-8 mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("more")}
        </div>
        <nav className="space-y-1">
          {legacyLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary"
            >
              <MoreHorizontal className="h-3.5 w-3.5" /> {l.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto">{item("/settings", t("settings"), Settings)}</div>
      </aside>
      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card px-2 pb-[env(safe-area-inset-bottom)] pt-2 md:hidden">
        {tabs.map(({ to, label, icon: I }) => {
          const on = to === "/" ? path === "/" : path.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center gap-1 py-1 text-[10px]",
                on ? "text-primary" : "text-muted-foreground",
              )}
            >
              <I className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Shared lifecycle for focused pages and the Cards header. */
// eslint-disable-next-line react-refresh/only-export-components
export function useBlockFlow(blockId?: string, fallbackNext = "/") {
  const navigate = useNavigate();
  const today = useToday();
  const actions = useBlockActions();
  const startBlock = actions.start.mutate;
  // The server times a block from start to finish, so opening its page starts it (planned only).
  useEffect(() => {
    if (blockId) startBlock(blockId);
  }, [blockId, startBlock]);
  const destination = () => {
    // Opened from the sidebar, not from a plan block: do not jump into the plan.
    if (!blockId) return "/";
    const blocks = today.data?.blocks;
    if (!blocks) return fallbackNext;
    const next = nextBlock(blocks, blockId);
    return next ? withBlock(next.route, next.id) : "/";
  };
  const finish = () => {
    const dest = destination();
    if (blockId) actions.finish.mutate(blockId, { onSettled: () => navTo(navigate, dest) });
    else navTo(navigate, dest);
  };
  const skip = (reason: SkipReason) => {
    const dest = destination();
    if (blockId)
      actions.skip.mutate({ id: blockId, reason }, { onSettled: () => navTo(navigate, dest) });
    else navTo(navigate, dest);
  };
  return { finish, skip, pending: actions.finish.isPending || actions.skip.isPending };
}

export function BlockControls({
  blockId,
  next,
  nextLabel,
  finishDisabled = false,
}: {
  blockId?: string | undefined;
  next?: string | undefined;
  nextLabel?: string | undefined;
  finishDisabled?: boolean;
}) {
  const t = useT();
  const flow = useBlockFlow(blockId, next);
  const [showSkip, setShowSkip] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {showSkip ? (
        <SkipReasonSelect onPick={flow.skip} onCancel={() => setShowSkip(false)} />
      ) : (
        <button onClick={() => setShowSkip(true)} className={btn.ghost} disabled={flow.pending}>
          {t("skipLogged")}
        </button>
      )}
      <button
        onClick={flow.finish}
        className={btn.primary}
        disabled={flow.pending || finishDisabled}
      >
        {nextLabel ?? t("finishBlock")}
      </button>
      <Link
        to="/"
        className="ml-1 rounded-full p-2 text-muted-foreground hover:bg-secondary"
        aria-label={t("exitBlock")}
      >
        <X className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Focused block: only this block's ring, no sidebar, no totals. */
export function BlockShell({
  title,
  kicker,
  progress,
  next,
  nextLabel,
  blockId,
  lane,
  finishDisabled = false,
  children,
}: {
  title: string;
  kicker: string;
  progress: number;
  /** Fallback destination when no Today plan is available. */
  next?: string | undefined;
  nextLabel?: string | undefined;
  /** When set, Finish/Skip call the Today API and follow the plan order. */
  blockId?: string | undefined;
  lane?: Lane;
  finishDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {lane && <BlockTimer lane={lane} active={!!blockId} />}
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Ring value={progress} />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{kicker}</div>
            <h1 className="truncate text-lg font-semibold">{title}</h1>
          </div>
        </div>
        <BlockControls
          blockId={blockId}
          next={next}
          nextLabel={nextLabel}
          finishDisabled={finishDisabled}
        />
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-16 md:px-8">{children}</div>
    </div>
  );
}

/** Link for dynamic route strings from the Today plan (path may carry ?query). */
export function RouteLink({
  route,
  className,
  onClick,
  children,
}: {
  route: string;
  className?: string | undefined;
  onClick?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={route}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
        navTo(navigate, route);
      }}
    >
      {children}
    </a>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Bar({ value, tone = "primary" }: { value: number; tone?: "primary" | "bad" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          tone === "bad" ? "bg-destructive" : "bg-primary",
        )}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  );
}

/** Non-blocking notice for desktop-first pages on narrow screens. */
export function BestOnDesktop({ items }: { items: string[] }) {
  const t = useT();
  return (
    <div className="space-y-2">
      {items.map((text) => (
        <div
          key={text}
          className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm"
        >
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{text}</span>
          <span className="text-xs text-muted-foreground">{t("bestOnDesktop")}</span>
        </div>
      ))}
    </div>
  );
}
