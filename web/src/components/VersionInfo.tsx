import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { APP_VERSION, RELEASES } from "../data/releases";
import { Dialog, useNarrow } from "./ui";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function VersionInfo() {
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();
  return (
    <>
      <Card aria-labelledby="about-h">
        <CardHeader><CardTitle id="about-h">About</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y overflow-hidden rounded-lg border">
            <dl className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <dt className="font-medium">Version</dt>
              <dd className="text-sm tabular-nums text-muted-foreground">{APP_VERSION}</dd>
            </dl>
            <Button type="button" variant="ghost" aria-haspopup="dialog" className="h-auto min-h-11 w-full justify-between rounded-none px-4 py-3" onClick={() => setOpen(true)}>
              What’s new<ArrowRight aria-hidden />
            </Button>
          </div>
        </CardContent>
      </Card>
      {open && (
        <Dialog title="What’s new" sheet={narrow} onClose={() => setOpen(false)}>
          <div className={`flex flex-col gap-6 ${narrow ? "" : "max-h-[60dvh] overflow-y-auto"}`}>
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
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Close</Button>
        </Dialog>
      )}
    </>
  );
}
