import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Image as ImageIcon, Mic2, Trash2, X, Loader2 } from "lucide-react";
import { StudyReviewNotice } from "../components/StudyReviewNotice";
import { ApiError } from "../api/client";
import { photoExtract, photoToDataUrl } from "../api/study";
import { canReopen, fmtWhen, listStudyRecords, sentenceCount, type StudyRecord } from "../api/history";
import { EXAMPLE_TEXT, IDEAS_EXAMPLE, OCR_LIMIT } from "../data/fixtures";
import { nf, plural } from "../lib/format";
import { LIMITS, STAGES, cancelAnalysis, openAnalysisInStudy, runAnalysis, validate } from "../state/study";
import { announce, get, go, patchStudy, useApp } from "../state/store";
import { Checkbox, Crumbs, Dialog, DisabledReason, EntryCard, Input, PageHead, Spinner, Textarea, pageFrame } from "../components/ui";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "cn";

/* After a reload nothing is open in Study: offer the newest saved analysis once per visit. */
let lastOffer: { status: "idle" | "loading" | "done"; record?: StudyRecord; dismissed?: boolean } = { status: "idle" };

export function resetLastAnalysisOffer() {
  lastOffer = { status: "idle" };
}

function useLastAnalysis(wanted: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!wanted || lastOffer.status !== "idle") return;
    lastOffer = { status: "loading" };
    listStudyRecords(1)
      .then((r) => (lastOffer = { status: "done", record: r.find(canReopen) }))
      .catch(() => (lastOffer = { status: "done" }))
      .finally(() => force((n) => n + 1));
  }, [wanted]);
  const r = lastOffer.record;
  return {
    record: wanted && !lastOffer.dismissed ? r : undefined,
    dismiss: () => {
      lastOffer = { ...lastOffer, dismissed: true };
      force((n) => n + 1);
    },
  };
}

/* ---------------- SCR-STU-01 + SCR-ANA-01 ---------------- */
export function StudyInput() {
  const study = useApp((s) => s.study);
  const forced = useApp((s) => s.ss["SCR-STU-01"]);
  const [photoError, setPhotoError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (forced === "clear") setConfirmClear(true);
  }, [forced]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mode = study.mode;
  const draft = study.drafts[mode];
  const a = study.analysis;
  const busy = a.status === "running" || a.status === "long";
  const v = validate(draft, mode);
  const limit = LIMITS[mode];
  const source = mode === "ideas" ? "My own idea" : "Pasted text";
  const last = useLastAnalysis(study.sentences.length === 0 && a.status === "idle");

  const importPhoto = (file: File) => {
    if (busy) return;
    try { selectStudyPhoto(file); go("study/photo"); }
    catch (e) { setPhotoError(e instanceof Error ? e.message : "Couldn’t open this image."); }
  };
  const setDraft = (val: string) => {
    patchStudy({ drafts: { ...study.drafts, [mode]: val }, analysis: a.status === "invalid" ? { ...a, status: "idle" } : a });
  };
  const reason =
    v === "over"
      ? `Shorten the text to ${nf.format(limit)} characters or fewer.`
      : busy
        ? "Analysis is in progress."
        : undefined;

  return (
    <div className={pageFrame("study-home")}>
      <PageHead
        title="Study"
        actions={study.sentences.length > 0 && !busy ? <Button type="button" variant="outline" onClick={() => go("study")}>Current sentence</Button> : undefined}
      />
      <div className="flex flex-col gap-4">
        <Card aria-labelledby="start-h">
          <CardHeader>
            <CardTitle id="start-h">Start</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
          <Tabs value={mode} onValueChange={(next) => { if (next === "text" || next === "ideas") patchStudy({ mode: next }); }}>
            <TabsList aria-label="Input mode" className="w-full">
              <TabsTrigger value="text" className="min-w-0 flex-1">French text</TabsTrigger>
              <TabsTrigger value="ideas" className="min-w-0 flex-1">My own ideas</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-2">
            <label htmlFor="study-input" className="text-sm font-medium">
              {mode === "text" ? "French text" : "Your idea"}
            </label>
            <Textarea
              id="study-input"
              name="study-draft"
              autoComplete="off"
              ref={taRef}
              lang={mode === "text" ? "fr" : "en"}
              rows={mode === "text" ? 7 : 5}
              placeholder={mode === "text" ? "e.g. J’ai failli oublier…" : "e.g. I almost forgot the meeting…"}
              value={draft}
              aria-invalid={v === "over" || a.status === "invalid" ? true : undefined}
              aria-describedby={`study-count${a.status === "invalid" ? " study-err" : ""}`}
              onPaste={(e) => {
                const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                if (file) { e.preventDefault(); importPhoto(file); }
              }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
                if (file) importPhoto(file); else setPhotoError("Choose an image file to read its French text.");
              }}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id="study-count" className={v === "over" ? "text-sm font-medium tabular-nums text-destructive" : "text-sm tabular-nums text-muted-foreground"}>
                {nf.format(draft.length)} / {nf.format(limit)}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" aria-disabled={(!!(busy)) || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => setDraft(mode === "text" ? EXAMPLE_TEXT : IDEAS_EXAMPLE))(); }}>Use example</Button>
                <Button type="button" variant="ghost" aria-disabled={(!!(!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined)) || undefined} className={cn((!!(!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined)) { event.preventDefault(); return; } (() => setConfirmClear(true))(); }}>Clear{(!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined) ? <span className="sr-only">{!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined}</span> : null}</Button>
              </span>
            </div>
            {a.status === "invalid" && (
              <p id="study-err" className="text-sm text-destructive" role="alert">
                This text has no letters. Enter French words or sentences to analyse.
              </p>
            )}
            {v === "over" && <p className="text-sm text-destructive">This is longer than {nf.format(limit)} characters. Remove some text to continue.</p>}
          </div>

          {photoError && <Alert variant="destructive"><AlertTitle>Couldn’t import image</AlertTitle><AlertDescription>{photoError}</AlertDescription></Alert>}
          <AnalysisStatus />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" aria-disabled={(!!(v === "empty") || !!(busy) || !!(reason)) || undefined} aria-busy={busy || undefined} className={cn((!!(v === "empty") || !!(busy) || !!(reason)) ? "opacity-50" : "")} onClick={(event) => { if (!!(v === "empty") || !!(busy) || !!(reason)) { event.preventDefault(); return; } (() => runAnalysis(source))(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : null}{busy ? "Analysing…" : mode === "text" ? "Analyse text" : "Create French example"}{(reason) ? <span className="sr-only">{reason}</span> : null}</Button>
              {mode === "text" && (
                <Button type="button" variant="outline" aria-disabled={(!!(busy)) || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => { patchStudy({ ocr: { ...study.ocr, phase: study.ocr.phase === "results" ? "results" : "select" } }); go("study/photo"); })(); }}>{<Camera aria-hidden />}Import from photo</Button>
              )}
            </div>
            {v === "over" && !busy && <DisabledReason>{reason}</DisabledReason>}
          </div>
          </CardContent>
        </Card>

        {last.record && !busy && (
          <Card aria-label="Continue">
            <CardHeader>
              <CardTitle>Continue</CardTitle>
              <CardDescription>{fmtWhen(last.record.created_at)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="font-medium">{plural(sentenceCount(last.record), "sentence")} saved</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => last.record && openAnalysisInStudy(last.record)}>Continue</Button>
                <Button type="button" variant="ghost" onClick={last.dismiss}>Dismiss</Button>
              </div>
            </CardContent>
          </Card>
        )}
        <StudyReviewNotice />
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2"><EntryCard title="History" description="Analyses and practice attempts" onClick={() => go("progress/history?tab=attempts")} /></div>
          <div className="sm:col-span-2"><EntryCard title="Practise my own words" description="Prepare, speak, and archive your own ideas" onClick={() => go("study/personal")} /></div>
          <div className="sm:col-span-2"><EntryCard title="My grammar map" description="Patterns from the sentences you have saved" onClick={() => go("study/grammar")} /></div>
          <div className="sm:col-span-3"><EntryCard title="Recall" description="Saved sentences, from memory" onClick={() => go("study/recall")} /></div>
          <div className="sm:col-span-3"><EntryCard title="Dictation" description="Saved sentences, from audio" onClick={() => go("study/dictation")} /></div>
        </div>
        {(study.restored || forced === "restored") && draft.trim() && (
          <Alert variant="default"><AlertTitle>Draft restored</AlertTitle><AlertDescription>Your earlier text is still here, in “{mode === "ideas" ? "My own ideas" : "French text"}”. Each mode keeps its own draft.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" onClick={() => patchStudy({ restored: false })}>Dismiss</Button></div></AlertDescription></Alert>
        )}
      </div>

      {confirmClear && (
        <Dialog
          title="Clear this draft?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button type="button" variant="outline" data-autofocus onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => {
                  patchStudy({ drafts: { ...get().study.drafts, [mode]: "" }, restored: false });
                  setConfirmClear(false);
                  announce("Draft cleared.");
                  taRef.current?.focus();
                }}>{<Trash2 aria-hidden />}Clear draft</Button>
            </>
          }
        >
          <p>
            This clears the text in “{mode === "ideas" ? "My own ideas" : "French text"}” only. Your other draft, saved cards and history stay the same.
          </p>
        </Dialog>
      )}
    </div>
  );
}

function AnalysisStatus() {
  const a = useApp((s) => s.study.analysis);
  const mode = useApp((s) => s.study.mode);
  if (a.status === "running" || a.status === "long")
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Spinner label={`Analysing · ${STAGES[a.stage]}`} />
          <Button type="button" variant="outline" onClick={cancelAnalysis}>{<X aria-hidden />}Cancel</Button>
        </div>
        <ol className="stage-list" aria-label="Analysis stages">
          {STAGES.map((st, i) => (
            <li key={st} aria-current={i === a.stage ? "step" : undefined} className={i < a.stage ? "done" : undefined}>
              {i < a.stage ? "Done: " : i === a.stage ? "Now: " : "Next: "}
              {st}
            </li>
          ))}
        </ol>
        {a.status === "long" && (
          <Alert variant="default"><AlertTitle>This is taking longer than usual</AlertTitle><AlertDescription>Long texts are analysed a few sentences at a time. You can keep waiting or cancel — your text stays here either way.</AlertDescription></Alert>
        )}
      </div>
    );
  if (a.status === "cancelled")
    return (
      <Alert variant="default" role="status"><AlertTitle>Analysis cancelled</AlertTitle><AlertDescription>Your text is kept. A cancelled result will never replace newer content.</AlertDescription></Alert>
    );
  if (a.status === "failed")
    return (
      <Alert variant="destructive" role="alert"><AlertTitle>Analysis did not finish</AlertTitle><AlertDescription>{a.error ?? "The analysis service didn’t respond."} Your text is kept exactly as you typed it.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => runAnalysis(mode === "ideas" ? "My own idea" : "Pasted text")}>Retry</Button></div></AlertDescription></Alert>
    );
  if (a.status === "nofrench")
    return (
      <Alert variant="default" role="status"><AlertTitle>No usable French sentences found</AlertTitle><AlertDescription>No French sentences were found in this text. Check that it’s in French, or switch to “My own ideas” to start from English.</AlertDescription></Alert>
    );
  return null;
}

/* ---------------- SCR-OCR-01 / SCR-OCR-02 ---------------- */
// The chosen photo lives outside the store: it is a local file the learner picked on this page.
let photoFile: { file: File; url: string } | null = null;

export function selectStudyPhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image smaller than 25\u00a0MB.");
  if (photoFile) URL.revokeObjectURL(photoFile.url);
  photoFile = { file, url: URL.createObjectURL(file) };
  patchStudy({ ocr: { phase: "select", photoId: file.name, lines: [], partial: false } });
}

export function StudyPhoto() {
  const ocr = useApp((s) => s.study.ocr);
  const [photo, setPhoto] = useState(photoFile);
  const [error, setError] = useState("");
  const [photoStage, setPhotoStage] = useState("Preparing image");
  const runRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    runRef.current?.abort();
    if (get().study.ocr.phase === "processing") patchStudy({ ocr: { ...get().study.ocr, phase: "cancelled" } });
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<typeof ocr>) => patchStudy({ ocr: { ...get().study.ocr, ...p } });

  const choose = (file: File | undefined) => {
    if (!file) return;
    try { selectStudyPhoto(file); setPhoto(photoFile); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn’t open this image."); }
  };

  const start = async () => {
    if (!photo) return;
    runRef.current?.abort();
    const ctl = new AbortController();
    runRef.current = ctl;
    patch({ phase: "processing" });
    setError("");
    announce("Reading French text from the photo.");
    try {
      setPhotoStage("Preparing and resizing image");
      const image = await photoToDataUrl(photo.file);
      if (ctl.signal.aborted) return;
      setPhotoStage("Uploading image and reading French text");
      const items = await photoExtract(image, ctl.signal);
      if (ctl.signal.aborted) return;
      const lines = items.map((it, i) => ({ id: `p${i}`, text: it.fr, selected: i < OCR_LIMIT, accentFrom: it.accent_fixed_from }));
      if (!lines.length) {
        patch({ phase: "none" });
        announce("No French text found in this photo.");
        return;
      }
      patch({ phase: "results", partial: false, lines });
      announce(`${plural(lines.length, "sentence")} found. Review them before continuing.`);
      requestAnimationFrame(() => document.getElementById("ocr-results-h")?.focus());
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (e instanceof ApiError && e.code === "photo_no_french") {
        patch({ phase: "none" });
        announce("No French text found in this photo.");
        return;
      }
      setError(e instanceof Error ? e.message : "The image could not be read. Try a PNG or JPEG screenshot.");
      patch({ phase: "failed" });
      announce("The photo could not be read. Your photo is kept.", true);
    }
  };
  const cancel = () => {
    runRef.current?.abort();
    patch({ phase: "cancelled" });
    announce("Import cancelled. Your photo is kept.");
  };

  const back = <Crumbs items={[{ label: "Study", onClick: () => go("study/new") }, { label: "Import from photo" }]} />;

  if (ocr.phase === "results") return <OcrResults back={back} photoTitle={photo?.file.name ?? "your photo"} />;

  const busy = ocr.phase === "processing";
  return (
    <div className={pageFrame()}>
      <PageHead
        back={back}
        title="Import from photo"
      />
      <div className="flex flex-col gap-6">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {photo ? (
          <div className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-3">
            <img src={photo.url} alt="The photo you chose" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, alignSelf: "flex-start" }} />
            <div className="flex flex-wrap items-center gap-2 gap-2">
              <span className="text-sm text-muted-foreground min-w-0 flex-1">{photo.file.name}</span>
              <Button type="button" variant="ghost" aria-disabled={(!!(busy)) || undefined} className={cn((!!(busy)) ? "opacity-50" : "", "h-8 px-2 text-sm")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => inputRef.current?.click())(); }}>{<ImageIcon aria-hidden />}Choose another photo</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-auto flex-col items-start gap-2 p-3 text-left" onClick={() => inputRef.current?.click()}><span className="grid aspect-4/3 w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground" aria-hidden>
              <Camera width={28} height={28} />
            </span>
            Take or choose a photo</Button>
        )}

        {busy && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Spinner label={`${photoStage}…`} />
            <Button type="button" variant="outline" onClick={cancel}>{<X aria-hidden />}Cancel</Button>
          </div>
        )}
        {error && ocr.phase !== "failed" && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {ocr.phase === "cancelled" && (
          <Alert variant="default" role="status"><AlertTitle>Import cancelled</AlertTitle><AlertDescription>Nothing was lost. Your photo is still selected — read it again, or choose another one.</AlertDescription></Alert>
        )}
        {ocr.phase === "failed" && (
          <Alert variant="destructive" role="alert"><AlertTitle>This photo couldn’t be read</AlertTitle><AlertDescription>{error || "The text reader didn’t respond."} Your photo is kept; try again.</AlertDescription></Alert>
        )}
        {ocr.phase === "none" && (
          <Alert variant="default" role="status"><AlertTitle>No French text found</AlertTitle><AlertDescription>No French was found in this photo. Try a sharper, closer photo.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" onClick={() => go("study/new")}>Type text instead</Button></div></AlertDescription></Alert>
        )}

        {!busy && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="default" aria-disabled={(!!(!photo ? "Choose a photo first." : undefined)) || undefined} className={cn((!!(!photo ? "Choose a photo first." : undefined)) ? "opacity-50" : "")} onClick={(event) => { if (!!(!photo ? "Choose a photo first." : undefined)) { event.preventDefault(); return; } (start)(); }}>{ocr.phase === "failed" || ocr.phase === "cancelled" ? "Try again" : "Read text from photo"}{(!photo ? "Choose a photo first." : undefined) ? <span className="sr-only">{!photo ? "Choose a photo first." : undefined}</span> : null}</Button>
            </div>

          </div>
        )}
        <p className="flex items-start gap-2 text-sm text-muted-foreground"><Mic2 aria-hidden /> The photo is sent to the AI text reader only to find its words. This app doesn’t keep it.</p>
      </div>
    </div>
  );
}

function OcrResults({ back, photoTitle }: { back: React.ReactNode; photoTitle: string }) {
  const ocr = useApp((s) => s.study.ocr);
  const forced = useApp((s) => s.ss["SCR-OCR-02"]);
  const [removed, setRemoved] = useState<{ line: (typeof ocr.lines)[number]; index: number } | null>(null);
  const lines = ocr.lines;
  const selected = lines.filter((l) => l.selected && l.text.trim());
  const over = selected.length > OCR_LIMIT;
  const textOver = selected.map((l) => l.text.trim()).join("\n").length > LIMITS.text;
  const patchLines = (next: typeof lines) => patchStudy({ ocr: { ...get().study.ocr, lines: next } });
  const move = (i: number, d: number) => {
    const next = [...lines];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    patchLines(next);
    announce(`Moved to position ${i + d + 1} of ${lines.length}.`);
    requestAnimationFrame(() => document.getElementById(`ocr-move-${x.id}-${d < 0 ? "up" : "down"}`)?.focus());
  };
  const reason = !selected.length ? "Select at least one sentence." : textOver ? "Shorten the selected text to 15,000 characters or fewer." : over ? `Select ${OCR_LIMIT} or fewer sentences. Deselect ${selected.length - OCR_LIMIT} to continue.` : undefined;

  return (
    <div className={pageFrame()}>
      <PageHead back={back} title="Check the text we found" desc={photoTitle} />
      <h2 id="ocr-results-h" tabIndex={-1} className="sr-only">Recognised sentences</h2>
      <div className="flex flex-col gap-4">
        {(ocr.partial || forced === "partial") && (
          <Alert variant="default"><AlertTitle>Only part of the photo could be read</AlertTitle><AlertDescription>We found {plural(lines.length, "sentence")}. Some text may be missing. You can continue with what was found or add text by hand later.</AlertDescription></Alert>
        )}
        {over && (
          <Alert variant="default" role="status"><AlertTitle>{`You can study up to ${OCR_LIMIT} sentences at a time`}</AlertTitle><AlertDescription>{selected.length} are selected. Deselect {selected.length - OCR_LIMIT} to continue — removed items stay out of this import only.</AlertDescription></Alert>
        )}
        <p className="font-medium" aria-live="polite">
          {selected.length} of {plural(lines.length, "sentence")} selected
        </p>
        {lines.length === 0 ? (
          <Alert variant="default"><AlertTitle>No sentences left in this import</AlertTitle><AlertDescription>You removed every sentence from this import.<div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => patchStudy({ ocr: { ...ocr, phase: "select" } })}>Choose another photo</Button></div></AlertDescription></Alert>
        ) : (
          <ol className="divide-y overflow-hidden rounded-lg border" aria-label="Recognised sentences">
            {lines.map((l, i) => (
              <li key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-4">
                <Checkbox
                  id={`ocr-sel-${l.id}`}
                  className="mt-8"
                  checked={l.selected}
                  onCheckedChange={(checked) => patchLines(lines.map((x) => (x.id === l.id ? { ...x, selected: checked === true } : x)))}
                  aria-label={`Include sentence ${i + 1}`}
                />
                <div className="flex flex-col gap-2">
                  <label htmlFor={`ocr-text-${l.id}`} className="text-sm font-medium">
                    Sentence {i + 1}
                  </label>
                  <Input
                    id={`ocr-text-${l.id}`}
                    lang="fr"
                    value={l.text}
                    aria-describedby={l.low ? `ocr-low-${l.id}` : undefined}
                    onChange={(e) => patchLines(lines.map((x) => (x.id === l.id ? { ...x, text: e.target.value, low: undefined } : x)))}
                  />
                  {l.accentFrom && <p className="text-sm text-muted-foreground">Accents corrected from: <span lang="fr">{l.accentFrom}</span>. Check the spelling before continuing.</p>}
                  {l.low && (
                    <p id={`ocr-low-${l.id}`} className="text-sm text-muted-foreground" style={{ color: "var(--warning)" }}>
                      Low confidence: <span className="underline decoration-wavy underline-offset-4" lang="fr">{l.low.join(", ")}</span> — please check {l.low.length > 1 ? "these words" : "this word"}.
                    </p>
                  )}
                  <div className="ocr-tools">
                    <Button type="button" variant="ghost" aria-disabled={(!!(i === 0 ? "Already first." : undefined)) || undefined} id={`ocr-move-${l.id}-up`} aria-label={`Move sentence ${i + 1} up`} className={cn((!!(i === 0 ? "Already first." : undefined)) ? "opacity-50" : "", "h-8 px-2 text-sm")} onClick={(event) => { if (!!(i === 0 ? "Already first." : undefined)) { event.preventDefault(); return; } (() => move(i, -1))(); }}>{<ArrowUp aria-hidden />}Up{(i === 0 ? "Already first." : undefined) ? <span className="sr-only">{i === 0 ? "Already first." : undefined}</span> : null}</Button>
                    <Button type="button" variant="ghost" aria-disabled={(!!(i === lines.length - 1 ? "Already last." : undefined)) || undefined} id={`ocr-move-${l.id}-down`} aria-label={`Move sentence ${i + 1} down`} className={cn((!!(i === lines.length - 1 ? "Already last." : undefined)) ? "opacity-50" : "", "h-8 px-2 text-sm")} onClick={(event) => { if (!!(i === lines.length - 1 ? "Already last." : undefined)) { event.preventDefault(); return; } (() => move(i, 1))(); }}>{<ArrowDown aria-hidden />}Down{(i === lines.length - 1 ? "Already last." : undefined) ? <span className="sr-only">{i === lines.length - 1 ? "Already last." : undefined}</span> : null}</Button>
                    <Button type="button" variant="ghost" aria-label={`Remove sentence ${i + 1} from this import`} className="h-8 px-2 text-sm" onClick={() => {
                        setRemoved({ line: l, index: i });
                        patchLines(lines.filter((x) => x.id !== l.id));
                        announce(`Sentence ${i + 1} removed from this import.`);
                      }}>{<Trash2 aria-hidden />}Remove from this import</Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {removed && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
            Removed one sentence from this import.
            <Button type="button" variant="ghost" className="h-8 px-2 text-sm" onClick={() => {
                const next = [...get().study.ocr.lines];
                next.splice(removed.index, 0, removed.line);
                patchLines(next);
                setRemoved(null);
              }}>Put it back</Button>
          </p>
        )}
        <div className="sticky bottom-0 z-10 bg-background py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default" aria-disabled={(!!(reason)) || undefined} className={cn((!!(reason)) ? "opacity-50" : "")} onClick={(event) => { if (!!(reason)) { event.preventDefault(); return; } (() => {
                patchStudy({ mode: "text", drafts: { ...get().study.drafts, text: selected.map((l) => l.text.trim()).join("\n") } });
                go("study/new", { focus: false });
                runAnalysis("Photo import");
              })(); }}>Continue with {plural(selected.length, "selected sentence")}{(reason) ? <span className="sr-only">{reason}</span> : null}</Button>
            <Button type="button" variant="outline" onClick={() => patchStudy({ ocr: { ...ocr, phase: "select" } })}>Choose another photo</Button>
          </div>
          {reason && <DisabledReason>{reason}</DisabledReason>}
        </div>
      </div>
    </div>
  );
}
