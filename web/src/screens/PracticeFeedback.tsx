/* Feedback blocks shared by Write and Speak: round 1 (hints only) and round 2 (corrections). */
import { useState } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import type { Feedback2 } from "../api/practice";
import { saveNote } from "../api/srs";
import { announce } from "../state/store";
import { Button, Pill } from "../components/ui";

export function AiLabel() {
  return (
    <span className="ai-label">
      <Sparkles aria-hidden width={12} height={12} /> AI feedback · Not an official assessment · No score or level
    </span>
  );
}

export function Checklist({ items }: { items?: { point: string; covered: boolean; note: string }[] }) {
  if (!items?.length) return null;
  return (
    <div className="stack gap-2">
      <p className="t-strong">Task checklist</p>
      <ul className="list">
        {items.map((c, i) => (
          <li key={i} className="list-row row--top">
            <Pill tone={c.covered ? "success" : "warning"} icon={c.covered ? <Check aria-hidden width={12} height={12} /> : <X aria-hidden width={12} height={12} />}>
              {c.covered ? "Covered" : "Missing"}
            </Pill>
            <span className="grow stack">
              <span>{c.point}</span>
              {c.note && <span className="t-support">{c.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Round 1 never gives the fix: the learner finds it from the hint. */
export function ErrorHints({ errors }: { errors?: { span: string; type: string; hint: string }[] }) {
  if (!errors?.length) return <p className="t-support">No specific errors were flagged.</p>;
  return (
    <div className="stack gap-2">
      <p className="t-strong">Find and fix ({errors.length})</p>
      <ol className="stack gap-2" style={{ paddingLeft: 20 }}>
        {errors.map((e, i) => (
          <li key={i}>
            <span lang="fr" className="t-strong">“{e.span}”</span> <span className="t-meta">· {e.type}</span>
            <br />
            <span className="t-support">{e.hint}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Round2({ fb, correctedLabel }: { fb: Feedback2; correctedLabel: string }) {
  const corrected = fb.corrected_text || fb.corrected_transcript || "";
  return (
    <div className="stack gap-4">
      {!!fb.fixed_errors?.length && (
        <div className="stack gap-2">
          <p className="t-strong">Your fixes</p>
          <ul className="list">
            {fb.fixed_errors.map((e, i) => (
              <li key={i} className="list-row row--top">
                <Pill tone={e.fixed ? "success" : "warning"}>{e.fixed ? "Fixed" : "Not yet"}</Pill>
                <span className="grow stack">
                  <span lang="fr">{e.span}</span>
                  {e.comment && <span className="t-support">{e.comment}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!fb.remaining_errors?.length && (
        <div className="stack gap-2">
          <p className="t-strong">Still to fix</p>
          <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
            {fb.remaining_errors.map((e, i) => (
              <li key={i}>
                <span lang="fr">“{e.span}”</span> → <span lang="fr" className="t-strong">{e.correction}</span>
                <span className="t-meta"> · {e.type}</span>
                {e.hint && <><br /><span className="t-support">{e.hint}</span></>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {corrected && (
        <div className="stack gap-1">
          <span className="def-label">{correctedLabel}</span>
          <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{corrected}</p>
        </div>
      )}
      {!!fb.sentences?.length && (
        <div className="stack gap-2">
          <p className="t-strong">Sentences worth keeping</p>
          <ul className="list">
            {fb.sentences.map((s, i) => (
              <SentenceRow key={i} s={s} />
            ))}
          </ul>
        </div>
      )}
      {!!fb.structures?.length && (
        <div className="stack gap-2">
          <p className="t-strong">Structures to reuse</p>
          <ul className="stack gap-2" style={{ paddingLeft: 20 }}>
            {fb.structures.map((s, i) => (
              <li key={i}>
                <span lang="fr" className="t-strong">{s.french}</span> — {s.english}
                {s.usage && <><br /><span className="t-support">{s.usage}</span></>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Saves a corrected sentence to Review: listen + speak cards and a cloze on the corrected chunk. */
function SentenceRow({ s }: { s: { original: string; corrected: string; explanation: string; chunk: string } }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const add = async () => {
    setState("saving");
    try {
      const chunk = s.chunk && s.corrected.includes(s.chunk) ? s.chunk : "";
      await saveNote({
        sentence: s.corrected,
        translation_en: s.explanation,
        translation_zh: "",
        modes: ["listen", "speak"],
        targets: chunk ? [{ text: chunk, mode: "cloze", importance: 3, meta: { hint: s.explanation } }] : [],
      });
      setState("saved");
      announce("Added to Review.");
    } catch {
      setState("failed");
      announce("Couldn’t add to Review.", true);
    }
  };
  return (
    <li className="list-row row--top">
      <span className="grow stack gap-1">
        {s.original && s.original !== s.corrected && <span lang="fr" className="t-support" style={{ textDecoration: "line-through" }}>{s.original}</span>}
        <span lang="fr" className="t-strong">{s.corrected}</span>
        {s.explanation && <span className="t-support">{s.explanation}</span>}
        {state === "failed" && <span className="field-error" role="alert">Couldn’t add it. Try again.</span>}
      </span>
      {state === "saved" ? (
        <Pill tone="success" icon={<Check aria-hidden width={12} height={12} />}>In Review</Pill>
      ) : (
        <Button kind="secondary" icon={<Plus aria-hidden />} busy={state === "saving"} onClick={() => void add()}>Add to review</Button>
      )}
    </li>
  );
}
