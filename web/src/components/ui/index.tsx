import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Loader2, Star, X } from "lucide-react";
import { cn } from "cn";
import { MIN_CHOSEN_IMPORTANCE, importanceFor, importanceLabel } from "../../lib/lookup";
import { Button } from "./button";
import {
  Dialog as ShadDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./breadcrumb";
import { Card, CardHeader, CardTitle } from "./card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./sheet";
import { Skeleton as ShadSkeleton } from "./skeleton";

export const WidthContext = createContext(1200);
export const useAppWidth = () => useContext(WidthContext);
export const useNarrow = () => useAppWidth() < 640;
export const OverlayRootContext = createContext<HTMLElement | null>(null);

export function DisabledReason({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground" role="note">
      {children}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <ShadSkeleton key={i} className="h-4" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => (
          <span key={`${item.label}-${i}`} className="contents">
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {item.onClick ? (
                <BreadcrumbLink asChild>
                  <Button type="button" variant="link" className="h-auto p-0 text-sm font-normal text-muted-foreground" onClick={item.onClick}>
                    {item.label}
                  </Button>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function EntryCard({
  title,
  description,
  onClick,
  icon,
}: {
  title: string;
  description?: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <Card className="py-0 transition-colors hover:bg-accent">
      <Button type="button" variant="ghost" className="h-auto w-full justify-between gap-3 whitespace-normal rounded-xl px-4 py-4 text-left" onClick={onClick}>
        <span className="flex min-w-0 flex-col gap-1">
          <CardHeader className="w-full p-0">
            <CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle>
          </CardHeader>
          {description && <span className="text-sm font-normal text-muted-foreground">{description}</span>}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Button>
    </Card>
  );
}

/** Centered page column. Wide is for tables and the sentence workspace. */
export function pageFrame(extra?: string, wide = false) {
  return cn("mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6", wide && "max-w-6xl", extra);
}

export function PageHead({ title, eyebrow, desc, actions, back }: { title: string; eyebrow?: ReactNode; desc?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight" tabIndex={-1} data-page-title>
            {title}
          </h1>
          {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function useRestoreFocus() {
  const trigger = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    trigger.current = document.activeElement as HTMLElement;
    return () => {
      const t = trigger.current;
      if (t && document.contains(t)) requestAnimationFrame(() => t.focus());
    };
  }, []);
}

function focusAutofocus(event: Event) {
  const root = event.currentTarget as HTMLElement | null;
  const el = root?.querySelector<HTMLElement>("[data-autofocus]");
  if (!el) return;
  event.preventDefault();
  el.focus();
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  sheet,
  wide,
  closeLabel = "Close",
  dismissible = true,
  describedBy,
  titleHidden = false,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  sheet?: boolean;
  wide?: boolean;
  closeLabel?: string;
  dismissible?: boolean;
  describedBy?: string;
  titleHidden?: boolean;
}) {
  useRestoreFocus();
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissible, onClose]);
  const close = (
    dismissible ? (
      <Button type="button" variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}><X aria-hidden /></Button>
    ) : null
  );
  if (sheet) {
    return (
      <Sheet open onOpenChange={(open) => { if (!open && dismissible) onClose(); }}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn("overlay--sheet sheet max-h-[85vh] overflow-y-auto", wide && "sm:max-w-3xl")}
          onOpenAutoFocus={focusAutofocus}
          aria-describedby={describedBy}
        >
          <SheetHeader className="flex-row items-start justify-between gap-3">
            <SheetTitle className={cn(titleHidden && "sr-only")}>{title}</SheetTitle>
            {close}
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-4">
            {children}
            {footer && <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>}
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <ShadDialog open onOpenChange={(open) => { if (!open && dismissible) onClose(); }}>
      <DialogContent
        className={cn("dialog", wide && "sm:max-w-3xl")}
        showCloseButton={false}
        onOpenAutoFocus={focusAutofocus}
        aria-describedby={describedBy}
      >
        <DialogHeader className="flex-row items-start justify-between gap-3">
          <DialogTitle className={cn(titleHidden && "sr-only")}>{title}</DialogTitle>
          {close}
        </DialogHeader>
        {describedBy ? null : <DialogDescription className="sr-only">{title}</DialogDescription>}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </ShadDialog>
  );
}

export function WordDock({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useRestoreFocus();
  useEffect(() => {
    const auto = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    (auto ?? ref.current)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.(".fr-word, .fr-text")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="popover word-dock sticky top-3 z-10 max-h-[min(72dvh,640px)] overflow-auto rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </aside>
  );
}

export function Popover({
  anchor,
  onClose,
  label,
  children,
}: {
  anchor: HTMLElement | null;
  container?: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const root = typeof document !== "undefined" ? document.getElementById("app-root") : null;
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({ top: -9999, left: 0, maxHeight: 480 });
  useRestoreFocus();
  useLayoutEffect(() => {
    if (!anchor || !root) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const c = root.getBoundingClientRect();
      const width = Math.min(440, c.width - 16);
      const left = Math.max(8, Math.min(a.left - c.left, c.width - width - 8));
      const below = c.bottom - a.bottom - 16;
      const above = a.top - c.top - 16;
      if (below < 280 && above > below) {
        const maxHeight = Math.min(480, above);
        setPos({ top: a.top - c.top - 8 - Math.min(maxHeight, ref.current?.offsetHeight ?? maxHeight), left, maxHeight });
      } else setPos({ top: a.bottom - c.top + 8, left, maxHeight: Math.min(480, below) });
    };
    place();
    const main = document.getElementById("main");
    main?.addEventListener("scroll", place, { passive: true });
    const ro = new ResizeObserver(place);
    ro.observe(root);
    if (ref.current) ro.observe(ref.current);
    return () => {
      main?.removeEventListener("scroll", place);
      ro.disconnect();
    };
  }, [anchor, root]);
  useEffect(() => {
    const auto = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    (auto ?? ref.current)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);
  if (!root) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="popover absolute z-40 flex w-[min(440px,calc(100%-16px))] flex-col gap-3 overflow-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-md"
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key === "Tab") {
          const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE));
          const last = items[items.length - 1];
          if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            onClose();
          }
        }
      }}
    >
      {children}
    </div>,
    root,
  );
}

/** Importance stars. `value` is the stored level (else derived from lookups); `onChange` makes 2-5 choosable. */
export function Importance({ count, saved = false, value, onChange, lookups = "inline" }: { count: number; saved?: boolean; value?: number; onChange?: (level: number) => void; lookups?: "inline" | "muted" }) {
  const n = value ?? importanceFor(count, saved);
  const times = `${count} ${count === 1 ? "lookup" : "lookups"}`;
  const star = (i: number) => <Star data-filled={i <= n} className={cn(onChange ? "size-5" : "size-4", i <= n ? "fill-current text-foreground" : "text-muted-foreground")} />;
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {onChange ? (
        <span role="radiogroup" aria-label="Importance" className="inline-flex items-center">
          {[1, 2, 3, 4, 5].map((i) => i < MIN_CHOSEN_IMPORTANCE ? (
            <span key={i} className="inline-flex h-11 w-7 items-center justify-center" aria-hidden>{star(i)}</span>
          ) : (
            <Button key={i} type="button" variant="ghost" size="icon" role="radio" aria-checked={i === n} aria-label={`Importance ${i} out of 5`}
              className="h-11 w-7 hover:bg-transparent dark:hover:bg-transparent" onClick={() => i !== n && onChange(i)}>{star(i)}</Button>
          ))}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => <span key={i}>{star(i)}</span>)}
        </span>
      )}
      <span className="text-sm text-muted-foreground">
        <span className="sr-only">{importanceLabel(count, saved, value)}</span>
        <span aria-hidden>{lookups === "muted" ? times : `Importance ${n}/5`}</span>
        {lookups !== "muted" && <span className="ml-2 text-xs text-muted-foreground">{times}</span>}
      </span>
    </div>
  );
}

/** Label above a tabular value. The value stays the label's next sibling. */
export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-end gap-1", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums leading-tight">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

export { Input } from "./input";
export { Textarea } from "./textarea";
export { Checkbox } from "./checkbox";
export { Label } from "./label";
export { RadioGroup, RadioGroupItem } from "./radio-group";
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
export { Progress } from "./progress";
export { Toggle } from "./toggle";
export { Separator } from "./separator";
export { Badge } from "./badge";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
