import { Bookmark, BookmarkCheck } from "lucide-react";
import { grade } from "../lib/grading";
import { countLookup, importanceFor, lookupKey, type LookupCounter } from "../lib/lookup";
import { Banner, Button, DemoNote, FieldText, Importance, PageHead, Pill } from "../components/ui";
import { REGISTRY } from "./registry";

function lum(hex: string) {
  const c = hex.replace("#", "").match(/.{2}/g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string, string, number][] = [
  ["Primary text on canvas", "#172033", "#F7F8FA", 4.5],
  ["Primary text on surface", "#172033", "#FFFFFF", 4.5],
  ["Secondary text on canvas", "#475569", "#F7F8FA", 4.5],
  ["Secondary text on surface", "#475569", "#FFFFFF", 4.5],
  ["White on primary", "#FFFFFF", "#1D4ED8", 4.5],
  ["Primary as text/link on surface", "#1D4ED8", "#FFFFFF", 4.5],
  ["Primary on primary-weak (selected)", "#1E40AF", "#EEF3FF", 4.5],
  ["Success text on success bg", "#166534", "#F0FDF4", 4.5],
  ["Error text on error bg", "#B91C1C", "#FEF2F2", 4.5],
  ["Warning text on warning bg", "#92400E", "#FFFBEB", 4.5],
  ["White on destructive", "#FFFFFF", "#B91C1C", 4.5],
  ["Disabled primary label", "#334155", "#CBD5E1", 4.5],
  ["Control border on surface", "#64748B", "#FFFFFF", 3],
  ["Focus ring on surface", "#1D4ED8", "#FFFFFF", 3],
  ["Focus ring on canvas", "#1D4ED8", "#F7F8FA", 3],
  ["Importance stars on surface", "#B45309", "#FFFFFF", 3],
  ["Divider on surface (decorative only)", "#E2E8F0", "#FFFFFF", 0],
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
    <div className="page page--wide">
      <PageHead title="Design reference" eyebrow="SCR-DSN-01 · for reviewers" desc="Tokens, component roles, accessibility specifications, adopted defaults and screen coverage for this prototype. Part of the same project as the app." />
      <div className="stack gap-7">
        <section className="stack gap-3" aria-labelledby="dsn-color">
          <h2 id="dsn-color" className="t-section">Colour and contrast</h2>
          <p className="t-support">Ratios are calculated live from the token values. Normal text needs 4.5:1; controls and state indicators need 3:1.</p>
          <div className="table-wrap">
            <table className="matrix">
              <caption className="sr-only">Colour pairings and contrast ratios</caption>
              <thead><tr><th scope="col">Pairing</th><th scope="col">Sample</th><th scope="col">Ratio</th><th scope="col">Requirement</th></tr></thead>
              <tbody>
                {PAIRS.map(([name, fg, bg, need]) => {
                  const r = contrast(fg, bg);
                  return (
                    <tr key={name}>
                      <th scope="row" style={{ fontWeight: 500 }}>{name}<br /><span className="code muted">{fg} on {bg}</span></th>
                      <td><span style={{ background: bg, color: fg, padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", fontWeight: 500 }}>Aa Ég œ</span></td>
                      <td className="num">{r.toFixed(2)}:1</td>
                      <td>{need ? <Pill tone={r >= need ? "success" : "error"}>{r >= need ? `Pass ≥ ${need}:1` : `Fails ${need}:1`}</Pill> : <Pill>Decorative, no requirement</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="stack gap-3" aria-labelledby="dsn-type">
          <h2 id="dsn-type" className="t-section">Type</h2>
          <p className="t-support">System sans-serif. French renders accents, curly apostrophes and œ: <span lang="fr" className="t-strong" style={{ color: "var(--text)" }}>« Où est l’œuvre ? Ça s’écrit déjà. »</span></p>
          <ul className="list">
            {TYPE.map(([name, spec, cls]) => (
              <li key={name} className="list-row"><span className={cls} style={{ flex: 1 }}>{name}</span><span className="code muted">{spec}</span></li>
            ))}
          </ul>
        </section>

        <section className="grid-3" aria-label="Spacing, radius and elevation">
          <div className="stack gap-2">
            <h2 className="t-section">Spacing</h2>
            {[4, 8, 12, 16, 24, 32, 48, 64].map((s) => (
              <div key={s} className="row"><span className="code" style={{ width: 36 }}>{s}</span><span style={{ width: s, height: 12, background: "var(--primary)", borderRadius: 2 }} /></div>
            ))}
          </div>
          <div className="stack gap-2">
            <h2 className="t-section">Radius</h2>
            {[["Controls", 8], ["Panels", 12], ["Mobile sheets", 16]].map(([k, r]) => (
              <div key={k} className="row"><span style={{ width: 44, height: 32, border: "2px solid var(--border-strong)", borderRadius: r as number }} /><span>{k} · {r} px</span></div>
            ))}
            <p className="t-support">Pills only for small status labels.</p>
          </div>
          <div className="stack gap-2">
            <h2 className="t-section">Elevation</h2>
            <div className="panel">Ordinary content · none</div>
            <div className="panel" style={{ boxShadow: "var(--shadow-pop)" }}>Anchored popover · subtle</div>
            <div className="panel" style={{ boxShadow: "var(--shadow-modal)" }}>Modal overlay · strong</div>
          </div>
        </section>

        <section className="stack gap-3" aria-labelledby="dsn-btn">
          <h2 id="dsn-btn" className="t-section">Button roles</h2>
          <p className="t-support">Exactly four roles. Each screen or dialog has at most one Primary action. Show answer and Try again are never Primary next to Check, Next or Done.</p>
          <div className="btn-row">
            <Button kind="primary">Primary</Button>
            <Button kind="secondary">Secondary</Button>
            <Button kind="tertiary">Tertiary</Button>
            <Button kind="destructive">Destructive</Button>
          </div>
          <div className="btn-row">
            <Button kind="primary" disabledReason="Example disabled reason.">Primary disabled</Button>
            <Button kind="primary" busy>Busy</Button>
          </div>
          <p className="t-support">Disabled buttons stay focusable and announce their reason. Minimum target 44 × 44 px.</p>
        </section>

        <section className="stack gap-3" aria-labelledby="dsn-comp">
          <h2 id="dsn-comp" className="t-section">Components</h2>
          <div className="grid-2">
            <div className="stack gap-2">
              <Banner tone="success" title="Success">Text plus icon, never colour alone.</Banner>
              <Banner tone="error" title="Error">Announced assertively; always offers a recovery.</Banner>
              <Banner tone="warning" title="Warning">Offline, partial or limited states.</Banner>
              <Banner tone="info" title="Info">Neutral guidance and pending sync.</Banner>
            </div>
            <div className="stack gap-3">
              <FieldText label="Field label" help="Help text sits between label and input." value="" onChange={() => {}} />
              <FieldText label="Field with error" value="250" onChange={() => {}} error="Enter a whole number from 0 to 200." />
              <div className="row"><Pill>Neutral</Pill><Pill tone="success">Success</Pill><Pill tone="warning">Warning</Pill><Pill tone="error">Error</Pill><Pill tone="demo">Demo</Pill></div>
              <DemoNote>Simulated capability label</DemoNote>
            </div>
          </div>
          <div className="panel stack gap-2">
            <p className="t-strong">Favorite vs importance — two separate controls</p>
            <div className="row gap-4">
              <Button kind="tertiary" aria-pressed={false} icon={<Bookmark aria-hidden />}>Favorite</Button>
              <Button kind="tertiary" aria-pressed icon={<BookmarkCheck aria-hidden />}>Favorited</Button>
            </div>
            {[0, 4, 5, 6, 9, 10].map((n) => <Importance key={n} count={n} />)}
            <p className="t-support">Importance is read-only: 0–4 lookups → {importanceFor(4)}/5, 5–9 → {importanceFor(5)}/5, 10+ → {importanceFor(10)}/5. Favorite never changes it.</p>
          </div>
        </section>

        <section className="stack gap-3" aria-labelledby="dsn-a11y">
          <h2 id="dsn-a11y" className="t-section">Accessibility specifications</h2>
          <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
            <li>Focus ring: 3 px #1D4ED8 with a 2 px light offset, on every interactive element.</li>
            <li>Skip link first; then navigation, page heading, instructions, input, primary action, secondary actions.</li>
            <li>Submitting moves focus to the result summary; nothing auto-advances.</li>
            <li>Closing a popover or sheet returns focus to its trigger. Modal dialogs trap focus and close with Escape.</li>
            <li>Polite announcements for loading, saving and completion; assertive for errors; timer ticks are never announced.</li>
            <li>Enter follows focus and state and never triggers two actions; Shift+Enter adds a line in answers.</li>
            <li>Sticky submit areas stay above the mobile keyboard; player, bottom navigation and sheets respect safe areas.</li>
            <li>Layouts use container queries, so the 320/390/768/desktop widths, the Mac window and 200% zoom all reflow without horizontal page scrolling.</li>
            <li>Targets are at least 44 × 44 px. Importance reads “Importance, 4 out of 5, based on 5 lookups.”</li>
            <li>Exercise targets are never rendered — in text, accessible names, titles, URLs or notifications — before Check or Show answer.</li>
          </ul>
        </section>

        <section className="grid-2" aria-label="Adopted defaults and rule checks">
          <div className="stack gap-3">
            <h2 className="t-section">Adopted defaults</h2>
            <p className="t-support">Prototype or product defaults, not quotations from the user.</p>
            <ul className="stack gap-2" style={{ paddingLeft: 20 }}>{DEFAULTS.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <div className="stack gap-3">
            <h2 className="t-section">Live rule checks</h2>
            <p className="t-support">Lookup events at 0, 4, 4.999, 5.000, 6, 9, 11 s → counts {seq.map(([, n]) => n).join(", ")}.</p>
            <ul className="list">
              {checks.map(([k, ok]) => (
                <li key={k} className="list-row"><span className="grow" lang="fr">{k}</span><Pill tone={ok ? "success" : "error"}>{ok ? "Holds" : "Fails"}</Pill></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="stack gap-3" aria-labelledby="dsn-cov">
          <h2 id="dsn-cov" className="t-section">Coverage inventory</h2>
          <p className="t-support">{REGISTRY.length} stable screen IDs · {REGISTRY.reduce((n, r) => n + r.states.length, 0)} navigable states. IDs stay the same across responsive variants; states use suffixes such as SCR-REC-01/techfail.</p>
          <div className="table-wrap">
            <table className="matrix">
              <caption className="sr-only">Screen coverage</caption>
              <thead><tr><th scope="col">Screen ID</th><th scope="col">Screen</th><th scope="col">States (select to open)</th></tr></thead>
              <tbody>
                {REGISTRY.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="code">{r.id}</th>
                    <td>{r.title}<br /><span className="t-meta">{r.area}</span></td>
                    <td>
                      <div className="dn-states">
                        {r.states.map((s) => (
                          <button key={s.key} type="button" className="dn-state" aria-label={`Open ${r.id}/${s.key}: ${s.label}`} onClick={() => s.apply()}>
                            <span className="code">/{s.key}</span>&nbsp;{s.label}
                          </button>
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
