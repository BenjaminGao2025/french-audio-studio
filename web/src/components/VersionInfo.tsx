import { useState } from "react";
import { APP_VERSION, RELEASES } from "../data/releases";
import { Dialog, useNarrow } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function VersionInfo({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  return (
    <>
      <Button type="button" variant="ghost" aria-label={`Version ${APP_VERSION} — What’s new`} aria-haspopup="dialog" className={`h-8 px-2 text-xs text-muted-foreground ${className}`} onClick={() => setOpen(true)}>v{APP_VERSION}</Button>
      {open && (
        <Dialog title="What’s new" sheet={narrow} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-6">
            {RELEASES.map((release, index) => (
              <section className="flex flex-col gap-2" key={release.version} aria-labelledby={`release-${release.version}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-balance" id={`release-${release.version}`}>v{release.version}</h3>
                  {index === 0 && <Badge variant="outline">Current version</Badge>}
                </div>
                <time className="text-xs leading-4 text-muted-foreground" dateTime={release.date}>{release.date}</time>
                <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {release.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              </section>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </Dialog>
      )}
    </>
  );
}
