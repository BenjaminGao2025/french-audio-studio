import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { armFailure, resetDemo, set, setOffline, useApp, type Domain, type Frame } from "../state/store";
import { Button, Dialog, FieldText, Segmented } from "../components/ui";
import { REGISTRY } from "./registry";

/* SCR-SYS-02 · outside the main task flow */
export function DemoNavigator() {
  const open = useApp((s) => s.demoOpen);
  const frame = useApp((s) => s.frame);
  const offline = useApp((s) => s.offline);
  const sync = useApp((s) => s.sync);
  const macWidth = useApp((s) => s.macWidth);
  const [q, setQ] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [fail, setFail] = useState<Domain>("analysis");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return REGISTRY.filter((r) => !t || r.id.toLowerCase().includes(t) || r.title.toLowerCase().includes(t) || r.area.toLowerCase().includes(t));
  }, [q]);
  if (!open) return null;
  const close = () => set(() => ({ demoOpen: false }));
  const areas = Array.from(new Set(list.map((r) => r.area)));
  return (
    <Dialog title="Demo states" onClose={close} wide>
      <p className="t-support">Jump to any screen and state of this prototype. These controls simulate conditions only; they are not part of the product. No labels here reveal exercise answers.</p>

      <section className="stack gap-3" aria-labelledby="dn-env">
        <h3 id="dn-env" className="t-strong">Environment</h3>
        <div className="stack gap-2">
          <span className="t-label">Frame</span>
          <Segmented<Frame>
            label="Frame"
            value={frame}
            onChange={(f) => set(() => ({ frame: f }))}
            options={[
              { value: "fluid", label: "Browser (fluid)" },
              { value: "iphone", label: "iPhone 390" },
              { value: "mac", label: "Mac window" },
            ]}
          />
          {frame === "mac" && (
            <div className="row">
              <span className="t-support">Window width</span>
              {[320, 390, 768, 1080, 1280].map((w) => (
                <Button key={w} kind={macWidth === w ? "secondary" : "tertiary"} className="btn--sm-text" aria-pressed={macWidth === w} onClick={() => set(() => ({ macWidth: w }))}>{w}</Button>
              ))}
            </div>
          )}
        </div>
        <div className="row gap-4">
          <label className="check"><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Simulate offline</label>
          <label className="field" style={{ width: 200 }}>
            <span className="field-label">Sync status</span>
            <select className="select" value={sync} onChange={(e) => set(() => ({ sync: e.target.value as typeof sync }))}>
              <option value="synced">Synced</option>
              <option value="pending">Pending (delay)</option>
              <option value="error">Error</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 240 }}>
            <span className="field-label">Make the next request fail</span>
            <select className="select" value={fail} onChange={(e) => setFail(e.target.value as Domain)}>
              {(["analysis", "ocr", "dictionary", "ai", "grammar", "audio", "save", "grading", "history", "settings", "sync", "queue", "restore", "clear", "signin", "exam", "write", "speak", "studio", "episodes"] as Domain[]).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <Button kind="secondary" onClick={() => { armFailure(fail); close(); }}>Arm failure</Button>
        </div>
      </section>

      <hr className="divider" />
      <section className="stack gap-3" aria-labelledby="dn-screens">
        <h3 id="dn-screens" className="t-strong">Screens and states</h3>
        <FieldText label="Filter by ID, name or area" value={q} onChange={setQ} type="search" />
        {areas.map((area) => (
          <div key={area} className="stack">
            <h4 className="t-label" style={{ paddingTop: 8 }}>{area}</h4>
            {list.filter((r) => r.area === area).map((r) => (
              <div key={r.id} className="dn-screen" style={{ borderTop: "1px solid var(--divider)" }}>
                <p><span className="dn-id">{r.id}</span> · {r.title}</p>
                <div className="dn-states">
                  {r.states.map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      className="dn-state"
                      aria-label={`${r.id} ${st.key}: ${st.label}`}
                      onClick={() => {
                        close();
                        st.apply();
                      }}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <hr className="divider" />
      <section className="stack gap-2">
        <h3 className="t-strong">Fictional session data</h3>
        <p className="t-support">Reset demo returns all fictional data in this browser tab to its starting point. It’s a prototype control, not a product feature.</p>
        {!confirmReset ? (
          <Button kind="secondary" icon={<RotateCcw aria-hidden />} onClick={() => setConfirmReset(true)} style={{ alignSelf: "flex-start" }}>Reset demo…</Button>
        ) : (
          <div className="btn-row">
            <Button kind="destructive" onClick={() => { resetDemo(); setConfirmReset(false); close(); }}>Reset fictional session data</Button>
            <Button kind="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
          </div>
        )}
      </section>
    </Dialog>
  );
}
