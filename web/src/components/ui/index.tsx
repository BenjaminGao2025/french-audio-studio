import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronDown, Loader2, Star, X } from "lucide-react";
import { cn } from "cn";
import { importanceFor, importanceLabel } from "../../lib/lookup";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Button as ShadButton } from "./button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import {
  Dialog as ShadDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./sheet";
import { Skeleton as ShadSkeleton } from "./skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Tabs as ShadTabs, TabsList, TabsTrigger } from "./tabs";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

export const WidthContext = createContext(1200);
export const useAppWidth = () => useContext(WidthContext);
export const useNarrow = () => useAppWidth() < 640;
export const OverlayRootContext = createContext<HTMLElement | null>(null);

export type ButtonRole = "primary" | "secondary" | "tertiary" | "destructive";
interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  kind?: ButtonRole;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  busy?: boolean;
  disabledReason?: string;
  block?: boolean;
  iconOnly?: boolean;
}
const BUTTON_VARIANT = { primary: "default", secondary: "outline", tertiary: "ghost", destructive: "destructive" } as const;

/** Stock Button. `kind` only picks a stock variant. */
export function Button({ kind = "secondary", icon, iconAfter, busy, disabledReason, block, iconOnly, className, children, onClick, disabled, ...rest }: BtnProps) {
  const reasonId = useId();
  const off = disabled || !!disabledReason || busy;
  const label = typeof rest["aria-label"] === "string" ? rest["aria-label"] : undefined;
  const control = (
    <ShadButton
      type="button"
      variant={BUTTON_VARIANT[kind]}
      size={iconOnly ? "icon" : "default"}
      {...rest}
      className={cn(block && "w-full", off && "opacity-50", className)}
      aria-disabled={off || undefined}
      aria-busy={busy || undefined}
      aria-describedby={disabledReason ? reasonId : rest["aria-describedby"]}
      onClick={(e) => {
        if (off) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconAfter}
      {disabledReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </ShadButton>
  );
  if (!iconOnly || !label) return control;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function DisabledReason({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground" role="note">
      {children}
    </p>
  );
}

type Tone = "info" | "success" | "error" | "warning" | "neutral";

export function Banner({
  tone = "neutral",
  title,
  children,
  actions,
  live,
  id,
  tabIndex,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  live?: "polite" | "assertive";
  id?: string;
  tabIndex?: number;
}) {
  return (
    <Alert
      id={id}
      tabIndex={tabIndex}
      variant={tone === "error" ? "destructive" : "default"}
      role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined}
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      {(children || actions) && (
        <AlertDescription>
          {children}
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </AlertDescription>
      )}
    </Alert>
  );
}

export function Pill({ tone, children, icon }: { tone?: "success" | "error" | "warning" | "info" | "demo"; children: ReactNode; icon?: ReactNode }) {
  const variant = tone === "error" ? "destructive" : tone === "success" || tone === "info" ? "secondary" : "outline";
  return (
    <Badge variant={variant}>
      {icon}
      {children}
    </Badge>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
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

export function PageHead({ title, eyebrow, desc, actions, back }: { title: string; eyebrow?: ReactNode; desc?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {back && <div className="self-start">{back}</div>}
      {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-balance" tabIndex={-1} data-page-title>
          {title}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {desc && <div className="max-w-prose text-sm text-muted-foreground">{desc}</div>}
    </header>
  );
}

export function FieldText({
  label,
  help,
  error,
  value,
  onChange,
  type = "text",
  inputMode,
  id: idProp,
  inputRef,
  lang,
  onKeyDown,
  width,
  placeholder,
  autoComplete,
  name,
  spellCheck,
}: {
  label: string;
  help?: ReactNode;
  error?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: "numeric" | "text" | "search";
  id?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  lang?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  width?: number;
  placeholder?: string;
  autoComplete?: string;
  name?: string;
  spellCheck?: boolean;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className="grid gap-2" style={width ? { maxWidth: width } : undefined}>
      <Label htmlFor={id}>{label}</Label>
      {help && (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      <Input
        id={id}
        ref={inputRef}
        type={type}
        inputMode={inputMode}
        lang={lang}
        value={value}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete ?? "off"}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={[help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p id={`${id}-err`} className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  block,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      aria-label={label}
      className={cn(block && "flex w-full")}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={cn(block && "flex-1")}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Tabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  idBase,
}: {
  label: string;
  value: T;
  tabs: { value: T; label: string }[];
  onChange: (v: T) => void;
  idBase: string;
}) {
  return (
    <ShadTabs value={value} onValueChange={(next) => onChange(next as T)}>
      <TabsList aria-label={label} className="h-auto max-w-full flex-wrap justify-start">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} id={`${idBase}-tab-${t.value}`} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
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
  children: ReactNode;
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
      <Button kind="tertiary" iconOnly aria-label={closeLabel} icon={<X aria-hidden />} onClick={onClose} />
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

export function Importance({ count, lookups = "inline" }: { count: number; lookups?: "inline" | "muted" }) {
  const n = importanceFor(count);
  const times = `${count} ${count === 1 ? "lookup" : "lookups"}`;
  return (
    <p className="flex flex-nowrap items-center gap-2">
      <span className="inline-flex text-primary" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn("size-4", i > n && "text-muted-foreground")} fill={i <= n ? "currentColor" : "none"} />
        ))}
      </span>
      <span className="text-sm text-muted-foreground">
        <span className="sr-only">{importanceLabel(count)}</span>
        <span aria-hidden>{lookups === "muted" ? times : `Importance ${n}/5`}</span>
        {lookups !== "muted" && <span className="ml-2 text-xs text-muted-foreground">{times}</span>}
      </span>
    </p>
  );
}

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-t">
      <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium">
        <span>{summary}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 text-sm">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
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
export { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

/** Stock Select with a flat option list. Option values must be non-empty strings. */
export function ChoiceSelect({
  id,
  value,
  onValueChange,
  options,
  disabled,
  describedBy,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  disabled?: boolean;
  describedBy?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-describedby={describedBy} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
