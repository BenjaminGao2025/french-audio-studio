import { useCallback, useEffect, useState } from "react";
import { flexRender } from "@tanstack/react-table";
import { getCoreRowModel, useLegacyTable, type LegacyColumnDef } from "@tanstack/react-table/legacy";
import { Trash2, Loader2 } from "lucide-react";
import {
  attemptKind,
  canReopen,
  clearAttempts,
  clearStudyRecords,
  fmtWhen,
  listAttempts,
  listStudyRecords,
  sentenceCount,
  sourceLabel,
  type AttemptRecord,
  type StudyRecord,
} from "../api/history";
import { LANE_LABEL, loadDays, type DayTime, type Lane } from "../api/time";
import { fmtDuration, plural } from "../lib/format";
import { openAnalysisInStudy } from "../state/study";
import { announce, clearAttemptHistory, go, patchStudy, set, useApp } from "../state/store";
import { Crumbs, Dialog, DisabledReason, PageHead, Skeleton, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "cn";

type Tab = "analyses" | "time" | "attempts";
const TABS: Tab[] = ["analyses", "time", "attempts"];

/** Loads one list from the server; `reload` fetches it again. */
function useList<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; data?: T }>({ status: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: "loading", data: s.data }));
    load()
      .then((data) => live && setState({ status: "ok", data }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function HistoryScreen() {
  const route = useApp((s) => s.route);
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const asked = params.get("tab") as Tab;
  const tab: Tab = TABS.includes(asked) ? asked : "analyses";
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHead
        back={<Crumbs items={[{ label: "Progress", onClick: () => go("progress") }, { label: "History" }]} />}
        title="History"
      />
      <div className="flex flex-col gap-6">
        <Tabs value={tab} onValueChange={(next) => ((t) => go(`progress/history?tab=${t}`, { focus: false }))(next)}><TabsList aria-label={"History type"} className="h-auto max-w-full flex-wrap justify-start">{([
            { value: "analyses", label: "Study analyses" },
            { value: "time", label: "Study time" },
            { value: "attempts", label: "Recall & Dictation" },
          ]).map((t) => (<TabsTrigger key={t.value} id={`hist-tab-${t.value}`} value={t.value}>{t.label}</TabsTrigger>))}</TabsList></Tabs>
        <div id="hist-panel" role="tabpanel" aria-labelledby={`hist-tab-${tab}`} className="flex flex-col gap-4">
          {tab === "analyses" ? <Analyses /> : tab === "time" ? <Time /> : <Attempts />}
        </div>
      </div>
    </div>
  );
}

function Loading({ status, what, onRetry }: { status: "loading" | "error"; what: string; onRetry: () => void }) {
  return status === "loading" ? (
    <>
      <Spinner label={`Loading ${what}…`} />
      <Skeleton lines={4} />
    </>
  ) : (
    <Alert variant="destructive" role="alert"><AlertTitle>{`${what[0].toUpperCase()}${what.slice(1)} didn’t load`}</AlertTitle><AlertDescription>Your records are safe. Check your connection and try again.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={onRetry}>Retry</Button></div></AlertDescription></Alert>
  );
}

function DataTable<T extends Record<string, any>>({ data, columns }: { data: T[]; columns: LegacyColumnDef<T>[] }) {
  const table = useLegacyTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={cell.column.id === "text" || cell.column.id === "sentence" ? "align-top whitespace-normal" : "align-top whitespace-nowrap"}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const BackButton = ({ onBack }: { onBack: () => void }) => (
  <Crumbs items={[{ label: "History", onClick: onBack }, { label: "Detail" }]} />
);

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text);

/* ---------------- Study analyses ---------------- */

function Analyses() {
  const list = useList(() => listStudyRecords());
  const [src, setSrc] = useState("all");
  const [detail, setDetail] = useState<string | null>(null);
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="analyses" onRetry={list.reload} />;
  const all = list.data ?? [];
  const open = detail ? all.find((r) => r.id === detail) : undefined;
  if (open) return <AnalysisDetail r={open} onBack={() => setDetail(null)} />;
  const shown = all.filter((r) => src === "all" || sourceLabel(r) === src);
  return (
    <>
      <label className="grid gap-2" style={{ width: 220 }}>
        <span className="text-sm font-medium">Source</span>
        <Select value={src} onValueChange={setSrc}><SelectTrigger aria-label={"Source"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{([
            { value: "all", label: "All sources" },
            { value: "Pasted text", label: "Pasted text" },
            { value: "Photo import", label: "Photo import" },
            { value: "My own idea", label: "My own idea" },
          ]).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
      </label>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {plural(all.length, "Study analysis", "Study analyses")}
        {shown.length !== all.length ? ` · Showing ${shown.length}` : ""}
      </p>
      {all.length === 0 ? (
        <Alert variant="default"><AlertTitle>No Study analyses yet</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/new")}>Analyse a text</Button></div></AlertDescription></Alert>
      ) : shown.length === 0 ? (
        <Alert variant="default"><AlertTitle>No analyses match this filter</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => setSrc("all")}>Show all sources</Button></div></AlertDescription></Alert>
      ) : (
        <DataTable
          data={shown}
          columns={[
            { id: "text", header: "Text", cell: ({ row }) => <span lang="fr" className="font-serif whitespace-normal">{preview(row.original.text)}</span> },
            { header: "When", cell: ({ row }) => fmtWhen(row.original.created_at) },
            { header: "Source", cell: ({ row }) => sourceLabel(row.original) },
            { header: "Sentences", cell: ({ row }) => plural(sentenceCount(row.original), "sentence") },
            { id: "open", header: "", cell: ({ row }) => <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setDetail(row.original.id)}>Open</Button> },
          ]}
        />
      )}
      <ClearAction kind="analyses" count={all.length} onCleared={list.reload} />
    </>
  );
}

function AnalysisDetail({ r, onBack }: { r: StudyRecord; onBack: () => void }) {
  const study = useApp((s) => s.study);
  const isOpen = study.analysis.status === "done" && study.analysis.input === r.text;
  const n = sentenceCount(r);
  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <h2 className="text-lg font-semibold text-balance" tabIndex={-1} data-autofocus>Study analysis · {fmtWhen(r.created_at)}</h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Source</dt><dd style={{ margin: 0 }}>{sourceLabel(r)}</dd></div>
        <div className="flex flex-col gap-0.5"><dt className="text-sm text-muted-foreground">Sentences</dt><dd style={{ margin: 0 }}>{n}</dd></div>
      </dl>
      <p lang="fr" style={{ whiteSpace: "pre-wrap" }}>{r.text}</p>
      {canReopen(r) ? null : (
        <DisabledReason>This entry was saved without its analysed sentences, so it can’t be opened.</DisabledReason>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canReopen(r) ? (
          <Button type="button" variant="default" onClick={() => openAnalysisInStudy(r)}>{isOpen ? "Open in Study" : "Open this analysis in Study"}</Button>
        ) : (
          <Button type="button" variant="default" onClick={() => {
              patchStudy({ drafts: { ...study.drafts, text: r.text } });
              go("study/new");
            }}>Put the text in Study</Button>
        )}
        <Button type="button" variant="outline" onClick={() => go("review/saved")}>Saved cards</Button>
      </div>
    </div>
  );
}

/* ---------------- Study time per day ---------------- */

const LANES: Lane[] = ["reading", "listening", "car", "speaking", "writing", "review"];

function Time() {
  const list = useList(() => loadDays(60));
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="study time" onRetry={list.reload} />;
  const days = list.data ?? [];
  const total = days.reduce((a, d) => a + d.seconds, 0);
  return (
    <>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {plural(days.length, "day")} with study time · {fmtDuration(total / 60)} in all (last 60 study days)
      </p>
      {days.length === 0 ? (
        <Alert variant="default"><AlertTitle>No study time yet</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/new")}>Start studying</Button></div></AlertDescription></Alert>
      ) : (
        <DataTable
          data={days}
          columns={[
            { header: "Day", cell: ({ row }) => dayLabel(row.original.day) },
            { header: "Time", cell: ({ row }) => <span className="tabular-nums">{fmtDuration(row.original.seconds / 60)}</span> },
            { header: "Lanes", cell: ({ row }) => laneLine(row.original) },
          ]}
        />
      )}

    </>
  );
}

function dayLabel(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function laneLine(d: DayTime) {
  const parts = LANES.filter((l) => (d.lanes[l] ?? 0) >= 30).map((l) => `${LANE_LABEL[l]} ${fmtDuration((d.lanes[l] ?? 0) / 60)}`);
  if (d.manual_seconds >= 30) parts.push(`${fmtDuration(d.manual_seconds / 60)} logged by hand`);
  return parts.join(" · ") || "Less than a minute";
}

/* ---------------- Recall & Dictation attempts ---------------- */

function Attempts() {
  const list = useList(() => listAttempts(500));
  const [kind, setKind] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [detail, setDetail] = useState<string | null>(null);
  if (list.status !== "ok" && !list.data) return <Loading status={list.status as "loading" | "error"} what="attempts" onRetry={list.reload} />;
  const all = list.data?.attempts ?? [];
  const total = list.data?.total ?? all.length;
  const open = detail ? all.find((a) => a.id === detail) : undefined;
  if (open) return <AttemptDetail a={open} onBack={() => setDetail(null)} />;
  const shown = all.filter(
    (a) => (kind === "all" || attemptKind(a) === kind) && (outcome === "all" || (outcome === "correct") === a.correct),
  );
  const correct = shown.filter((a) => a.correct).length;
  const avg = shown.length ? Math.round(shown.reduce((s, a) => s + a.accuracy, 0) / shown.length) : 0;
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2" style={{ width: 230 }}>
          <span className="text-sm font-medium">Practice</span>
          <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label={"Practice"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{([
              { value: "all", label: "Recall and Dictation" },
              { value: "Recall", label: "Recall" },
              { value: "Dictation", label: "Dictation" },
            ]).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
        </label>
        <label className="grid gap-2" style={{ width: 180 }}>
          <span className="text-sm font-medium">Outcome</span>
          <Select value={outcome} onValueChange={setOutcome}><SelectTrigger aria-label={"Outcome"} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{([
              { value: "all", label: "All outcomes" },
              { value: "correct", label: "Correct" },
              { value: "incorrect", label: "Not yet correct" },
            ]).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent></Select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {plural(total, "practice attempt")}
        {total > all.length ? ` · Showing the newest ${all.length}` : ""}
        {shown.length !== all.length ? ` · ${shown.length} match the filters` : ""}
      </p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ["Attempts", shown.length],
          ["Correct", correct],
          ["Average accuracy", `${avg}%`],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="text-lg font-semibold text-balance tabular-nums" style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {all.length === 0 ? (
        <Alert variant="default"><AlertTitle>No practice attempts</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => go("study/recall")}>Start Recall</Button></div></AlertDescription></Alert>
      ) : shown.length === 0 ? (
        <Alert variant="default"><AlertTitle>No attempts match these filters</AlertTitle><AlertDescription><div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => { setKind("all"); setOutcome("all"); }}>Clear filters</Button></div></AlertDescription></Alert>
      ) : (
        <DataTable
          data={shown}
          columns={[
            { header: "Practice", cell: ({ row }) => attemptKind(row.original) },
            { header: "Outcome", cell: ({ row }) => <Badge variant={row.original.correct ? "secondary" : "destructive"}>{row.original.correct ? "Correct" : "Not yet"}</Badge> },
            { header: "Accuracy", cell: ({ row }) => <span className="tabular-nums">{row.original.accuracy}%</span> },
            { id: "sentence", header: "Sentence", cell: ({ row }) => <span lang="fr" className="whitespace-normal">{preview(row.original.sentence)}</span> },
            { header: "When", cell: ({ row }) => `${fmtWhen(row.original.created_at)}${row.original.step ? ` · step ${row.original.step}` : ""}` },
            { id: "open", header: "", cell: ({ row }) => <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setDetail(row.original.id)}>Open</Button> },
          ]}
        />
      )}

      <ClearAction kind="attempts" count={total} onCleared={list.reload} />
    </>
  );
}

function AttemptDetail({ a, onBack }: { a: AttemptRecord; onBack: () => void }) {
  const kind = attemptKind(a);
  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <h2 className="text-lg font-semibold text-balance" tabIndex={-1} data-autofocus>{kind} attempt · {fmtWhen(a.created_at)}</h2>
      <dl className="flex flex-col gap-3">
        <div><dt className="text-sm font-medium text-muted-foreground">Sentence</dt><dd lang="fr" style={{ margin: 0 }}>{a.sentence}</dd></div>
        {a.expected && a.expected !== a.sentence && <div><dt className="text-sm font-medium text-muted-foreground">Expected{a.step ? ` (step ${a.step})` : ""}</dt><dd lang="fr" style={{ margin: 0 }}>{a.expected}</dd></div>}
        <div><dt className="text-sm font-medium text-muted-foreground">Your answer</dt><dd lang="fr" style={{ margin: 0 }}>{a.answer || "—"}</dd></div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Result</dt>
          <dd style={{ margin: 0 }}>{a.correct ? "Correct" : "Not yet correct"} · {a.accuracy}% accuracy</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => { set((s) => ({ libFilters: { ...s.libFilters, q: a.sentence } })); go("review/saved"); }}>Find saved card</Button>
        <Button type="button" variant="ghost" onClick={() => { patchStudy({ tab: kind === "Recall" ? "recall" : "dictation" }); go(kind === "Recall" ? "study/recall" : "study/dictation"); }}>Practise again</Button>
      </div>
    </div>
  );
}

/* ---------------- clearing (two separate, scoped operations) ---------------- */

function ClearAction({ kind, count, onCleared }: { kind: "analyses" | "attempts"; count: number; onCleared: () => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"confirm" | "clearing" | "failed">("confirm");
  const [done, setDone] = useState(false);
  const label = kind === "analyses" ? "Clear Study analysis list" : "Clear practice attempt history";
  const run = () => {
    setPhase("clearing");
    (kind === "analyses" ? clearStudyRecords() : clearAttempts())
      .then(() => {
        // Session summaries on this page start counting again from zero too.
        if (kind === "attempts") clearAttemptHistory();
        setOpen(false);
        setPhase("confirm");
        setDone(true);
        onCleared();
        announce(kind === "analyses" ? "Study analysis list cleared." : "Practice attempt history cleared.");
      })
      .catch(() => {
        setPhase("failed");
        announce("Clearing didn’t finish. Nothing was removed.", true);
      });
  };
  return (
    <div className="flex flex-col gap-2" style={{ marginTop: 16 }}>
      {done && count === 0 && (
        <Alert variant="default" role="status"><AlertTitle>Cleared</AlertTitle></Alert>
      )}
      <Button type="button" variant="ghost" aria-disabled={(!!(count === 0 ? "There’s nothing to clear." : undefined)) || undefined} style={{ color: count ? "var(--error)" : undefined }} className={cn("self-start md:-ml-3", (!!(count === 0 ? "There’s nothing to clear." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(count === 0 ? "There’s nothing to clear." : undefined)) { event.preventDefault(); return; } (() => { setPhase("confirm"); setOpen(true); })(); }}>{<Trash2 aria-hidden />}{label}{(count === 0 ? "There’s nothing to clear." : undefined) ? <span className="sr-only">{count === 0 ? "There’s nothing to clear." : undefined}</span> : null}</Button>
      {count === 0 && <DisabledReason>There’s nothing to clear.</DisabledReason>}
      {open && (
        <Dialog
          title={`${label}?`}
          onClose={() => phase !== "clearing" && setOpen(false)}
          dismissible={phase !== "clearing"}
          footer={
            <>
              <Button type="button" variant="outline" aria-disabled={(!!(phase === "clearing")) || undefined} data-autofocus className={cn((!!(phase === "clearing")) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "clearing")) { event.preventDefault(); return; } (() => setOpen(false))(); }}>Cancel</Button>
              <Button type="button" variant="destructive" aria-disabled={(!!(phase === "clearing")) || undefined} aria-busy={phase === "clearing" || undefined} className={cn((!!(phase === "clearing")) ? "opacity-50" : "")} onClick={(event) => { if (!!(phase === "clearing")) { event.preventDefault(); return; } (run)(); }}>{phase === "clearing" ? <Loader2 className="animate-spin" aria-hidden /> : null}{phase === "failed" ? "Retry" : phase === "clearing" ? "Clearing…" : kind === "analyses" ? "Clear analysis list" : "Clear attempt history"}</Button>
            </>
          }
        >
          <p>
            {kind === "analyses"
              ? `This removes ${plural(count, "entry", "entries")} from your Study analysis list. It can’t be undone.`
              : `This removes ${plural(count, "attempt")} from your practice history. It can’t be undone.`}
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-medium">These stay exactly the same:</p>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground" style={{ paddingLeft: 20, color: "var(--text)" }}>
              <li>Saved cards and saved definition snapshots</li>
              <li>Lookup counts and importance</li>
              <li>Review scheduling and mastered cards</li>
              <li>Study time and 1,000-hour progress</li>
              <li>{kind === "analyses" ? "Practice attempt history" : "Study analysis list"}</li>
            </ul>
          </div>
          {phase === "failed" && <Alert variant="destructive" role="alert"><AlertTitle>Clearing didn’t finish</AlertTitle><AlertDescription>Nothing was removed. Try again.</AlertDescription></Alert>}
        </Dialog>
      )}
    </div>
  );
}
