import { useState } from "react";
import { APP_VERSION, RELEASES } from "../data/releases";
import { Button, Dialog, Pill, useNarrow } from "./ui";

export function VersionInfo({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  return (
    <>
      <button
        type="button"
        className={`version-link t-meta ${className}`}
        aria-label={`Version ${APP_VERSION} — What’s new`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        v{APP_VERSION}
      </button>
      {open && (
        <Dialog title="What’s new" sheet={narrow} onClose={() => setOpen(false)}>
          <div className="stack gap-5">
            {RELEASES.map((release, index) => (
              <section className="stack gap-2" key={release.version} aria-labelledby={`release-${release.version}`}>
                <div className="row gap-2">
                  <h3 className="t-section" id={`release-${release.version}`}>v{release.version}</h3>
                  {index === 0 && <Pill>Current version</Pill>}
                </div>
                <time className="t-meta" dateTime={release.date}>{release.date}</time>
                <ul className="release-changes t-support">
                  {release.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              </section>
            ))}
          </div>
          <Button kind="secondary" onClick={() => setOpen(false)}>Close</Button>
        </Dialog>
      )}
    </>
  );
}
