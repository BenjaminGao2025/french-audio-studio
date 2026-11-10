import { useSyncExternalStore } from "react";
import { gradeToast, subscribeToast } from "../lib/feedback";

/** A short praise chip. It does not take focus and does not cover the Next button. */
export function GradeToast() {
  const toast = useSyncExternalStore(subscribeToast, gradeToast, () => null);
  if (!toast) return null;
  return (
    <div className={`grade-toast${toast.glow ? " grade-toast--ok" : ""}${toast.celebrate ? " grade-toast--celebrate" : ""}`} role="status">
      {toast.glow && <span className="grade-check" aria-hidden>✓</span>}
      <span lang="fr">{toast.phrase}</span>
    </div>
  );
}
