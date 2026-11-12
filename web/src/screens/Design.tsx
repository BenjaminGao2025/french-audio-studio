import { Bookmark, BookmarkCheck, Loader2, AlertCircle, Star } from "lucide-react";
import { grade } from "../lib/grading";
import { countLookup, lookupKey, type LookupCounter } from "../lib/lookup";
import { Importance, PageHead, pageFrame } from "../components/ui";
import { REGISTRY } from "./registry";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";

function lum(hex: string) {
  const c = hex.replace("#", "").match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string, string, number][] = [
  ["Primary text on canvas", "#2A2622", "#F3EFE6", 4.5],
  ["Primary text on surface", "#2A2622", "#FBF8F2", 4.5],
  ["Secondary text on canvas", "#5C5348", "#F3EFE6", 4.5],
  ["Secondary text on surface", "#5C5348", "#FBF8F2", 4.5],
  ["Cream on primary", "#F7F4EE", "#2F4634", 4.5],
  ["Link on surface", "#3D5C56", "#FBF8F2", 4.5],
  ["Primary on primary-weak (selected)", "#243628", "#E5EFE6", 4.5],
  ["Success text on success bg", "#1D6B45", "#E5F2EA", 4.5],
  ["Error text on error bg", "#8F3B32", "#F8EBE8", 4.5],
  ["Warning text on warning bg", "#8A5A12", "#F8F0DC", 4.5],
  ["Info text on info bg", "#5C4630", "#F1E6D4", 4.5],
  ["White on destructive", "#FFFFFF", "#8F3B32", 4.5],
  ["Disabled primary label", "#3D3832", "#D9D0C2", 4.5],
  ["Control border on surface", "#8A8172", "#FBF8F2", 3],
  ["Focus ring on surface", "#8A5A2B", "#FBF8F2", 3],
  ["Focus ring on canvas", "#8A5A2B", "#F3EFE6", 3],
  ["Importance dots on surface", "#2F4634", "#FBF8F2", 3],
  ["Divider on surface (decorative only)", "#E3DACB", "#FBF8F2", 0],
];

const TYPE: [string, string, string][] = [
  ["Metadata", "12/16 · 400", "t-meta"],
  ["Supporting", "14/20 · 400", "t-support"],
  ["Body and controls", "16/24 · 400/500", "t-body"],
  ["Section title", "20/28 · 600", "t-section"],
  ["Page title", "24/32 · 600", "t-page"],
  ["Main progress figure", "32/40 · 600", "t-figure"],
];

const DEFAULTS = [
  "Whole-interface simple English; French only for learning content.",
  "Dictionary lookups count at most once per 5 seconds, measured from the last counted lookup.",
  "Mastery Undo window: 6 seconds, measured from the action.",
  "Daily new cards: whole numbers 0–200 (default 40).",
  "Grading tolerates œ/oe; accents are otherwise strict.",
  "Hyphen and space are equivalent in grading (consistent with ignoring punctuation).",
  "Input modes keep separate drafts; switching never discards or starts analysis.",
  "Weeks start on Monday in this prototype.",
];

export function DesignReference() {
  let c: LookupCounter = { count: 0, lastCounted: null };
  const seq = [0, 4, 4.999, 5, 6, 9, 11].map((t) => {
    c = countLookup(c, t).next;
    return [t, c.count] as const;
  });
  const T = "J’ai oublié mon rendez-vous.";
  const checks: [string, boolean][] = [
    ["rendez-vous = rendez vous", grade(T, "J'ai oublié mon rendez vous").correct],
    ["j’ai = j'ai", grade("J’ai faim.", "j'ai faim").correct],
    ["jai ≠ j’ai", !grade("J’ai faim.", "jai faim").correct],
    ["été ≠ ete", !grade("L’été.", "l’ete").correct],
    ["ça ≠ ca", !grade("Ça va.", "ca va").correct],
    ["sœur = soeur (grading only)", grade("Ma sœur.", "ma soeur").correct],
    ["Lookup keys keep sœur ≠ soeur", lookupKey("sœur") !== lookupKey("soeur")],
    ["Lookup keys keep failli ≠ faillir", lookupKey("failli") !== lookupKey("faillir")],
  ];
  return (
    <div className={pageFrame(undefined, true)}>
      <PageHead title="Design reference" eyebrow="SCR-DSN-01 · for reviewers" desc="Tokens, component roles, accessibility specifications, adopted defaults and screen coverage for this prototype. Part of the same project as the app." />
      <div className="flex flex-col gap-12">
        <section className="flex flex-col gap-3" aria-labelledby="dsn-color">
          <h2 id="dsn-color" className="text-lg font-semibold text-balance">Colour and contrast</h2>
          <p className="text-sm text-muted-foreground">Ratios are calculated live from the token values. Normal text needs 4.5:1; controls and state indicators need 3:1.</p>
          <div className="w-full overflow-x-auto">
            <table className="matrix">
              <caption className="sr-only">Colour pairings and contrast ratios</caption>
              <thead><tr><th scope="col">Pairing</th><th scope="col">Sample</th><th scope="col">Ratio</th><th scope="col">Requirement</th></tr></thead>
              <tbody>
                {PAIRS.map(([name, fg, bg, need]) => {
                  const r = contrast(fg, bg);
                  return (
                    <tr key={name}>
                      <th scope="row" style={{ fontWeight: 500 }}>{name}<br /><span className="code text-muted-foreground">{fg} on {bg}</span></th>
                      <td><span style={{ background: bg, color: fg, padding: "4px 10px", borderRadius: 6, border: "1px solid #E3DACB", fontWeight: 500 }}>Aa Ég œ</span></td>
                      <td className="tabular-nums">{r.toFixed(2)}:1</td>
                      <td>{need ? <Badge variant={r >= need ? "secondary" : "destructive"}>{r >= need ? `Pass ≥ ${need}:1` : `Fails ${need}:1`}</Badge> : <Badge variant="outline">Decorative, no requirement</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="dsn-type">
          <h2 id="dsn-type" className="text-lg font-semibold text-balance">Type</h2>
          <p className="text-sm text-muted-foreground">System sans-serif. French renders accents, curly apostrophes and œ: <span lang="fr" className="font-medium" style={{ color: "var(--text)" }}>« Où est l’œuvre ? Ça s’écrit déjà. »</span></p>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {TYPE.map(([name, spec, cls]) => (
              <li key={name} className="flex flex-wrap items-center gap-3 px-4 py-3"><span className={cls} style={{ flex: 1 }}>{name}</span><span className="code text-muted-foreground">{spec}</span></li>
            ))}
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Spacing, radius and elevation">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-balance">Spacing</h2>
            {[4, 8, 12, 16, 24, 32, 48, 64].map((s) => (
              <div key={s} className="flex flex-wrap items-center gap-2"><span className="code" style={{ width: 36 }}>{s}</span><span style={{ width: s, height: 12, background: "var(--primary)", borderRadius: 2 }} /></div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-balance">Radius</h2>
            {[["Controls", 8], ["Panels", 12], ["Mobile sheets", 16]].map(([k, r]) => (
              <div key={k} className="flex flex-wrap items-center gap-2"><span style={{ width: 44, height: 32, border: "2px solid var(--border-strong)", borderRadius: r as number }} /><span>{k} · {r} px</span></div>
            ))}
            <p className="text-sm text-muted-foreground">Pills only for small status labels.</p>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-balance">Elevation</h2>
            <div className="rounded-lg border bg-card p-4 text-card-foreground">Ordinary content · none</div>
            <div className="rounded-lg border bg-card p-4 text-card-foreground" style={{ boxShadow: "var(--shadow-pop)" }}>Anchored popover · subtle</div>
            <div className="rounded-lg border bg-card p-4 text-card-foreground" style={{ boxShadow: "var(--shadow-modal)" }}>Modal overlay · strong</div>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="dsn-btn">
          <h2 id="dsn-btn" className="text-lg font-semibold text-balance">Button roles</h2>
          <p className="text-sm text-muted-foreground">Exactly four roles. Each screen or dialog has at most one Primary action. Show answer and Try again are never Primary next to Check, Next or Done.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default">Primary</Button>
            <Button type="button" variant="outline">Secondary</Button>
            <Button type="button" variant="ghost">Tertiary</Button>
            <Button type="button" variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default" aria-disabled className="opacity-50" onClick={(event) => event.preventDefault()}>Primary disabled<span className="sr-only">Example disabled reason.</span></Button>
            <Button type="button" variant="default" aria-disabled aria-busy className="opacity-50" onClick={(event) => event.preventDefault()}><Loader2 className="animate-spin" aria-hidden />Busy</Button>
          </div>
          <p className="text-sm text-muted-foreground">Disabled buttons stay focusable and announce their reason. Minimum target 44 × 44 px.</p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="dsn-comp">
          <h2 id="dsn-comp" className="text-lg font-semibold text-balance">Components</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Alert variant="default"><AlertTitle>Success</AlertTitle><AlertDescription>Text plus icon, never colour alone.</AlertDescription></Alert>
              <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Announced assertively; always offers a recovery.</AlertDescription></Alert>
              <Alert variant="default"><AlertTitle>Warning</AlertTitle><AlertDescription>Offline, partial or limited states.</AlertDescription></Alert>
              <Alert variant="default"><AlertTitle>Info</AlertTitle><AlertDescription>Neutral guidance and pending sync.</AlertDescription></Alert>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-2"><Label htmlFor="field-label">Field label</Label><p id="field-label-help" className="text-sm text-muted-foreground">Help text sits between label and input.</p><Input id="field-label" value="" onChange={() => {}} autoComplete="off" aria-describedby="field-label-help" /></div>
              <div className="grid gap-2"><Label htmlFor="field-with-error">Field with error</Label><Input id="field-with-error" value="250" onChange={() => {}} autoComplete="off" aria-describedby="field-with-error-err" aria-invalid={true} /><p id="field-with-error-err" className="flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Enter a whole number from 0 to 200.</span></p></div>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Neutral</Badge><Badge variant="secondary">Success</Badge><Badge variant="outline">Warning</Badge><Badge variant="destructive">Error</Badge><Badge variant="outline">Demo</Badge></div>
              <Badge variant="outline">Simulated capability label</Badge>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-2">
            <p className="font-medium">Word deck and Importance</p>
            <div className="flex flex-wrap items-center gap-2 gap-4">
              <Button type="button" variant="ghost" aria-pressed={false}>{<Bookmark aria-hidden />}Favorite</Button>
              <Button type="button" variant="ghost" aria-pressed>{<BookmarkCheck aria-hidden />}Favorited</Button>
            </div>
            {[0, 1, 3, 5].map((n) => <div key={n} className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label={n > 0 ? "Saved" : "Save word"} aria-pressed={n > 0}><Star aria-hidden className={n > 0 ? "fill-current" : undefined} /></Button><Importance count={n} saved={n > 0} /></div>)}
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="dsn-a11y">
          <h2 id="dsn-a11y" className="text-lg font-semibold text-balance">Accessibility specifications</h2>
          <ul className="flex flex-col gap-2" style={{ paddingLeft: 20 }}>
            <li>Focus ring: 2 px #8A5A2B with a 2 px offset, on real controls.</li>
            <li>Skip link first; then navigation, page heading, instructions, input, primary action, secondary actions.</li>
            <li>Submitting moves focus to the result summary; nothing auto-advances.</li>
            <li>Closing a popover or sheet returns focus to its trigger. Modal dialogs trap focus and close with Escape.</li>
            <li>Polite announcements for loading, saving and completion; assertive for errors; timer ticks are never announced.</li>
            <li>Enter follows focus and state and never triggers two actions; Shift+Enter adds a line in answers.</li>
            <li>Sticky submit areas stay above the mobile keyboard; player, bottom navigation and sheets respect safe areas.</li>
            <li>Layouts use container queries, so the 320/390/768/desktop widths, the Mac window and 200% zoom all reflow without horizontal page scrolling.</li>
            <li>Targets are at least 44 × 44 px. Importance reads “Importance, 5 out of 5, based on 5 lookups.”</li>
            <li>Exercise targets are never rendered — in text, accessible names, titles, URLs or notifications — before Check or Show answer.</li>
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-2" aria-label="Adopted defaults and rule checks">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-balance">Adopted defaults</h2>
            <p className="text-sm text-muted-foreground">Prototype or product defaults, not quotations from the user.</p>
            <ul className="flex flex-col gap-2" style={{ paddingLeft: 20 }}>{DEFAULTS.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-balance">Live rule checks</h2>
            <p className="text-sm text-muted-foreground">Lookup events at 0, 4, 4.999, 5.000, 6, 9, 11 s → counts {seq.map(([, n]) => n).join(", ")}.</p>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {checks.map(([k, ok]) => (
                <li key={k} className="flex flex-wrap items-center gap-3 px-4 py-3"><span className="min-w-0 flex-1" lang="fr">{k}</span><Badge variant={ok ? "secondary" : "destructive"}>{ok ? "Holds" : "Fails"}</Badge></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="dsn-cov">
          <h2 id="dsn-cov" className="text-lg font-semibold text-balance">Coverage inventory</h2>
          <p className="text-sm text-muted-foreground">{REGISTRY.length} stable screen IDs · {REGISTRY.reduce((n, r) => n + r.states.length, 0)} navigable states. IDs stay the same across responsive variants; states use suffixes such as SCR-REC-01/techfail.</p>
          <div className="w-full overflow-x-auto">
            <table className="matrix">
              <caption className="sr-only">Screen coverage</caption>
              <thead><tr><th scope="col">Screen ID</th><th scope="col">Screen</th><th scope="col">States (select to open)</th></tr></thead>
              <tbody>
                {REGISTRY.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="code">{r.id}</th>
                    <td>{r.title}<br /><span className="text-xs leading-4 text-muted-foreground">{r.area}</span></td>
                    <td>
                      <div className="dn-states">
                        {r.states.map((s) => (
                          <Button type="button" variant="ghost" key={s.key} aria-label={`Open ${r.id}/${s.key}: ${s.label}`} className="h-8 px-2" onClick={() => s.apply()}><span className="font-mono text-xs">/{s.key}</span>&nbsp;{s.label}</Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
