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
import { AlertCircle, CheckCircle2, ChevronDown, Info, Loader2, Star, TriangleAlert, X, FlaskConical } from "lucide-react";
import { createPortal } from "react-dom";
import { cx } from "../lib/format";
import { importanceFor, importanceLabel } from "../lib/lookup";

/* ---------- App width (container-based responsive logic) ---------- */
export const WidthContext = createContext(1200);
export const useAppWidth = () => useContext(WidthContext);
export const useNarrow = () => useAppWidth() < 640;
export const OverlayRootContext = createContext<HTMLElement | null>(null);

/* ---------- Button: exactly four roles ---------- */
export type ButtonRole = "primary" | "secondary" | "tertiary" | "destructive";
interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  kind?: ButtonRole;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  busy?: boolean;
  /** Visible + announced reason why the action is unavailable. */
  disabledReason?: string;
  /** Put the reason in the layout, not only in a screen-reader span. */
  reasonVisible?: boolean;
  block?: boolean;
  iconOnly?: boolean;
}
export function Button({ kind = "secondary", icon, iconAfter, busy, disabledReason, reasonVisible, block, iconOnly, className, children, onClick, disabled, ...rest }: BtnProps) {
  const reasonId = useId();
  const off = disabled || !!disabledReason || busy;
  return (
    <>
      <button
        type="button"
        {...rest}
        className={cx("btn", `btn--${kind}`, block && "btn--block", iconOnly && "btn--icon", className)}
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
        {busy ? <Loader2 className="spin" aria-hidden /> : icon}
        {children}
        {iconAfter}
      </button>
      {disabledReason && (
        <span id={reasonId} className={reasonVisible ? "btn-reason" : "sr-only"}>
          {disabledReason}
        </span>
      )}
    </>
  );
}

export function DisabledReason({ children }: { children: ReactNode }) {
  return (
    <p className="field-help" role="note">
      {children}
    </p>
  );
}

/* ---------- Status ---------- */
type Tone = "info" | "success" | "error" | "warning" | "neutral";
const TONE_ICON: Record<Tone, ReactNode> = {
  info: <Info aria-hidden />,
  success: <CheckCircle2 aria-hidden />,
  error: <AlertCircle aria-hidden />,
  warning: <TriangleAlert aria-hidden />,
  neutral: <Info aria-hidden />,
};
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
    <div
      id={id}
      tabIndex={tabIndex}
      className={cx("banner", tone !== "neutral" && `banner--${tone}`)}
      role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined}
    >
      {TONE_ICON[tone]}
      <div className="banner-body">
        {title && <p className="banner-title">{title}</p>}
        {children && <div>{children}</div>}
        {actions && <div className="btn-row">{actions}</div>}
      </div>
    </div>
  );
}

export function Pill({ tone, children, icon }: { tone?: "success" | "error" | "warning" | "info" | "demo"; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cx("pill", tone && `pill--${tone}`)}>
      {icon}
      {children}
    </span>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <span className="demo-note">
      <FlaskConical aria-hidden />
      {children}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row t-support" role="status">
      <Loader2 className="spin" aria-hidden width={18} height={18} />
      {label}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack gap-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skel" style={{ height: 16, width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

/* ---------- Page head ---------- */
export function PageHead({ title, eyebrow, desc, actions, back }: { title: string; eyebrow?: ReactNode; desc?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      {back}
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="page-head-row">
        <h1 className="t-page" tabIndex={-1} data-page-title>
          {title}
        </h1>
        {actions && <div className="btn-row">{actions}</div>}
      </div>
      {desc && <div className="t-body muted" style={{ maxWidth: 680 }}>{desc}</div>}
    </header>
  );
}

/* ---------- Form fields ---------- */
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
    <div className="field" style={width ? { maxWidth: width } : undefined}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {help && (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      )}
      <input
        id={id}
        ref={inputRef}
        className="input"
        type={type}
        inputMode={inputMode}
        lang={lang}
        value={value}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete ?? "off"}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(help ? `${id}-help` : undefined, error ? `${id}-err` : undefined) || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p id={`${id}-err`} className="field-error">
          <AlertCircle aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/* ---------- Segmented (radiogroup) ---------- */
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={label} className={cx("seg", block && "seg--block")}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const n = (i + d + options.length) % options.length;
            refs.current[n]?.focus();
            onChange(options[n].value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Tabs ---------- */
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`${idBase}-tab-${t.value}`}
          role="tab"
          type="button"
          className="tab"
          aria-selected={t.value === value}
          aria-controls={`${idBase}-panel`}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const n = (i + d + tabs.length) % tabs.length;
            refs.current[n]?.focus();
            onChange(tabs[n].value);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Focus helpers ---------- */
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

let shellInertCount = 0;
function useInertShell(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const shell = document.querySelector<HTMLElement>("#app-root > .shell");
    if (!shell) return;
    shellInertCount += 1;
    shell.setAttribute("inert", "");
    return () => {
      shellInertCount = Math.max(0, shellInertCount - 1);
      if (shellInertCount === 0) shell.removeAttribute("inert");
    };
  }, [active]);
}

/* ---------- Modal dialog / sheet ---------- */
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
  /** Keep the title for assistive tech when the card already shows its own heading. */
  titleHidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const portal = typeof document !== "undefined" ? document.getElementById("app-root") : null;
  useInertShell(!!portal);
  useRestoreFocus();
  useEffect(() => {
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);
  const node = (
    <div
      className={cx("overlay", sheet && "overlay--sheet")}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        className={cx(sheet ? "sheet" : "dialog", wide && "dialog--wide")}
        onKeyDown={(e) => {
          if (e.key === "Escape" && dismissible) {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== "Tab") return;
          const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {sheet && <div className="sheet-grip" aria-hidden />}
        <div className={cx("dialog-head", titleHidden && "dialog-head--tools")}>
          <h2 id={titleId} className={cx("t-section", titleHidden && "sr-only")}>
            {title}
          </h2>
          {dismissible && (
            <Button kind="tertiary" iconOnly aria-label={closeLabel} icon={<X aria-hidden />} onClick={onClose} />
          )}
        </div>
        {children}
        {footer && <div className="btn-row btn-row--end">{footer}</div>}
      </div>
    </div>
  );
  return portal ? createPortal(node, portal) : node;
}

/* ---------- Anchored popover (non-modal, desktop) ---------- */
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
      let clearance = 0;
      for (const el of root.querySelectorAll<HTMLElement>(".player, .study-nav")) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        clearance = Math.max(clearance, r.bottom - c.top);
      }
      let top = a.bottom - c.top + 8;
      // A word in the sentence sits above the player and the tabs. Open the card under them.
      if (clearance > 0 && top < clearance + 8 && a.top - c.top < clearance) top = clearance + 8;
      let maxHeight = Math.min(480, Math.max(160, c.height - top - 8));
      if (top + 160 > c.height - 8) {
        top = Math.max(8, c.height - 8 - 220);
        maxHeight = Math.min(480, c.height - top - 8);
      }
      setPos({ top, left, maxHeight });
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
      className="popover"
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
            onClose(); // focus returns to the trigger
          }
        }
      }}
    >
      {children}
    </div>,
    root,
  );
}

/* ---------- Importance (read-only) ---------- */
export function Importance({ count, lookups = "inline" }: { count: number; lookups?: "inline" | "muted" }) {
  const n = importanceFor(count);
  const times = `${count} ${count === 1 ? "lookup" : "lookups"}`;
  return (
    <p className={cx("row gap-2", lookups === "muted" && "importance--muted")} style={{ flexWrap: "nowrap" }}>
      <span className="stars" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={i <= n ? "" : "off"} fill={i <= n ? "currentColor" : "none"} />
        ))}
      </span>
      <span className="t-support">
        <span className="sr-only">{importanceLabel(count)}</span>
        <span aria-hidden>
          {lookups === "muted" ? times : `Importance ${n}/5 · ${times}`}
        </span>
      </span>
    </p>
  );
}

/* ---------- Disclosure ---------- */
export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disc" open={defaultOpen}>
      <summary>
        <span>{summary}</span>
        <ChevronDown aria-hidden width={18} height={18} />
      </summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="t-support">{label}</span>
      <span className="t-section num">{value}</span>
      {sub && <span className="t-meta">{sub}</span>}
    </div>
  );
}
