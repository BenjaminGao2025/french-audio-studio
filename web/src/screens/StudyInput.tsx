import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, ChevronLeft, Image as ImageIcon, Mic2, PenLine, Trash2, X, Headphones } from "lucide-react";
import { StudyReviewNotice } from "../components/StudyReviewNotice";
import { ApiError } from "../api/client";
import { photoExtract, photoToDataUrl } from "../api/study";
import { canReopen, fmtWhen, listStudyRecords, sentenceCount, type StudyRecord } from "../api/history";
import { EXAMPLE_TEXT, IDEAS_EXAMPLE, OCR_LIMIT } from "../data/fixtures";
import { nf, plural } from "../lib/format";
import { LIMITS, STAGES, cancelAnalysis, openAnalysisInStudy, runAnalysis, validate } from "../state/study";
import { announce, get, go, patchStudy, useApp } from "../state/store";
import { Banner, Button, Dialog, DisabledReason, PageHead, Segmented, Spinner } from "../components/ui";

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
    v === "empty"
      ? "Enter some text first. Empty or space-only text can’t be analysed."
      : v === "over"
        ? `Shorten the text to ${nf.format(limit)} characters or fewer.`
        : busy
          ? "Analysis is in progress."
          : undefined;

  return (
    <div className="page page--wide study-home">
      <PageHead
        title="Study"
        desc="Paste French, or an idea you want to say."
        actions={study.sentences.length > 0 && !busy ? <Button kind="tertiary" onClick={() => go("study")}>Back to current sentence</Button> : undefined}
      />
      <div className="stack gap-4">
        <div className="study-home-tools">
          <StudyReviewNotice />
          <div className="btn-row">
            <Button kind="secondary" onClick={() => go("study/personal")}>Practise my own words</Button>
            <Button kind="tertiary" onClick={() => go("study/grammar")}>My grammar map</Button>
          </div>
        </div>
        <Segmented
          label="Input mode"
          value={mode}
          onChange={(m) => patchStudy({ mode: m })}
          options={[
            { value: "text", label: "Study French text" },
            { value: "ideas", label: "Practise my own ideas" },
          ]}
        />
        {last.record && !busy && (
          <Banner
            tone="info"
            title="Pick up where you left off?"
            actions={
              <>
                <Button kind="secondary" onClick={() => last.record && openAnalysisInStudy(last.record)}>Open last analysis</Button>
                <Button kind="tertiary" onClick={last.dismiss}>Dismiss</Button>
              </>
            }
          >
            {fmtWhen(last.record.created_at)} · {plural(sentenceCount(last.record), "sentence")} saved.
          </Banner>
        )}
        {(study.restored || forced === "restored") && draft.trim() && (
          <Banner
            tone="info"
            title="Draft restored"
            actions={<Button kind="tertiary" onClick={() => patchStudy({ restored: false })}>Dismiss</Button>}
          >
            We kept what you typed earlier in “{mode === "ideas" ? "Practise my own ideas" : "Study French text"}”. Each mode keeps its own draft.
          </Banner>
        )}

        <div className="panel stack gap-4 study-composer">
          <div className="field">
            <label htmlFor="study-input" className="field-label">
              {mode === "text" ? "French text" : "Your idea"}
            </label>
            <p id="study-help" className="field-help">
              {mode === "text"
                ? `Up to ${nf.format(limit)} characters. Paste or drop a screenshot to import it.`
                : `One idea, in English or simple French. Up to ${limit} characters.`}
            </p>
            <textarea
              id="study-input"
              ref={taRef}
              className="textarea"
              lang={mode === "text" ? "fr" : "en"}
              rows={mode === "text" ? 12 : 8}
              value={draft}
              aria-invalid={v === "over" || a.status === "invalid" ? true : undefined}
              aria-describedby={`study-help study-count${a.status === "invalid" ? " study-err" : ""}`}
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
            <div className="row row--between">
              <span id="study-count" className={v === "over" ? "counter counter--over" : "counter"}>
                {nf.format(draft.length)} / {nf.format(limit)} characters{v === "over" ? ` · ${nf.format(draft.length - limit)} over the limit` : ""}
              </span>
              <span className="btn-row">
                <Button kind="tertiary" onClick={() => setDraft(mode === "text" ? EXAMPLE_TEXT : IDEAS_EXAMPLE)} disabled={busy}>
                  Use example
                </Button>
                <Button kind="tertiary" onClick={() => setConfirmClear(true)} disabledReason={!draft ? "Nothing to clear." : busy ? "Analysis is in progress." : undefined}>
                  Clear
                </Button>
              </span>
            </div>
            {a.status === "invalid" && (
              <p id="study-err" className="field-error" role="alert">
                This text has no letters. Enter French words or sentences to analyse.
              </p>
            )}
            {v === "over" && <p className="field-error">This is longer than {nf.format(limit)} characters. Remove some text to continue.</p>}
          </div>

          {photoError && <Banner tone="error" title="Couldn’t import image">{photoError}</Banner>}
          <AnalysisStatus />

          <div className="sticky-actions" style={{ background: "var(--surface)" }}>
            <div className="btn-row">
              <Button kind="primary" onClick={() => runAnalysis(source)} disabledReason={reason} busy={busy}>
                {busy ? "Analysing…" : mode === "text" ? "Analyse text" : "Create French example"}
              </Button>
              {mode === "text" && (
                <Button kind="secondary" icon={<Camera aria-hidden />} onClick={() => { patchStudy({ ocr: { ...study.ocr, phase: study.ocr.phase === "results" ? "results" : "select" } }); go("study/photo"); }} disabled={busy}>
                  Import from photo
                </Button>
              )}
            </div>
            {reason && !busy && <DisabledReason>{reason}</DisabledReason>}
          </div>
        </div>

        <section className="section" aria-labelledby="prl-h">
          <h2 id="prl-h" className="t-section">Practise without new text</h2>
          <ul className="list study-side-actions">
            <li>
              <button className="list-btn" onClick={() => go("study/recall")}>
                <span className="dest-icon"><PenLine aria-hidden /></span>
                <span className="grow stack">
                  <span className="t-strong">Recall</span>
                  <span className="t-support">See the English meaning, type the French.</span>
                </span>
              </button>
            </li>
            <li>
              <button className="list-btn" onClick={() => go("study/dictation")}>
                <span className="dest-icon"><Headphones aria-hidden /></span>
                <span className="grow stack">
                  <span className="t-strong">Dictation</span>
                  <span className="t-support">Listen to practice audio, type what you hear.</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>

      {confirmClear && (
        <Dialog
          title="Clear this draft?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setConfirmClear(false)} data-autofocus>Cancel</Button>
              <Button
                kind="destructive"
                icon={<Trash2 aria-hidden />}
                onClick={() => {
                  patchStudy({ drafts: { ...get().study.drafts, [mode]: "" }, restored: false });
                  setConfirmClear(false);
                  announce("Draft cleared.");
                  taRef.current?.focus();
                }}
              >
                Clear draft
              </Button>
            </>
          }
        >
          <p>
            This clears the text in “{mode === "ideas" ? "Practise my own ideas" : "Study French text"}” only. Your other draft, saved cards and history stay the same.
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
      <div className="stack gap-3" aria-live="polite">
        <div className="row row--between">
          <Spinner label={`Analysing · ${STAGES[a.stage]}`} />
          <Button kind="secondary" icon={<X aria-hidden />} onClick={cancelAnalysis}>
            Cancel
          </Button>
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
          <Banner tone="info" title="This is taking longer than usual">
            Long texts are analysed a few sentences at a time. You can keep waiting or cancel — your text stays here either way.
          </Banner>
        )}
      </div>
    );
  if (a.status === "cancelled")
    return (
      <Banner tone="neutral" title="Analysis cancelled" live="polite">
        Your text is kept. A cancelled result will never replace newer content.
      </Banner>
    );
  if (a.status === "failed")
    return (
      <Banner tone="error" title="Analysis did not finish" live="assertive" actions={<Button kind="secondary" onClick={() => runAnalysis(mode === "ideas" ? "My own idea" : "Pasted text")}>Retry</Button>}>
        {a.error ?? "The analysis service didn’t respond."} Your text is kept exactly as you typed it.
      </Banner>
    );
  if (a.status === "nofrench")
    return (
      <Banner tone="warning" title="No usable French sentences found" live="polite">
        We couldn’t find French sentences in this text. Check that it’s in French, or switch to “Practise my own ideas” to start from English.
      </Banner>
    );
  return null;
}

/* ---------------- SCR-OCR-01 / SCR-OCR-02 ---------------- */
// The chosen photo lives outside the store: it is a local file the learner picked on this page.
let photoFile: { file: File; url: string } | null = null;

export function selectStudyPhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image smaller than 25 MB.");
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

  const back = (
    <Button kind="tertiary" className="btn--sm-text" icon={<ChevronLeft aria-hidden />} onClick={() => go("study/new")} style={{ alignSelf: "flex-start", marginLeft: -12 }}>
      Back to text input
    </Button>
  );

  if (ocr.phase === "results") return <OcrResults back={back} photoTitle={photo?.file.name ?? "your photo"} />;

  const busy = ocr.phase === "processing";
  return (
    <div className="page">
      <PageHead
        back={back}
        title="Import from photo"
        desc="Take or choose a photo of French text — a page, a sign, your notes. We find the French sentences; you check them before studying."
      />
      <div className="stack gap-5">
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
          <div className="panel stack gap-3">
            <img src={photo.url} alt="The photo you chose" style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, alignSelf: "flex-start" }} />
            <div className="row gap-2">
              <span className="t-support grow">{photo.file.name}</span>
              <Button kind="tertiary" className="btn--sm-text" icon={<ImageIcon aria-hidden />} disabled={busy} onClick={() => inputRef.current?.click()}>
                Choose another photo
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="photo-card" onClick={() => inputRef.current?.click()}>
            <span className="photo-thumb" aria-hidden>
              <Camera width={28} height={28} />
            </span>
            <span className="t-strong">Take or choose a photo</span>
            <span className="t-support">JPEG or PNG recommended. Other image formats depend on your browser. Large photos are resized before upload.</span>
          </button>
        )}

        {busy && (
          <div className="row row--between">
            <Spinner label={`${photoStage}…`} />
            <Button kind="secondary" icon={<X aria-hidden />} onClick={cancel}>Cancel</Button>
          </div>
        )}
        {error && ocr.phase !== "failed" && <p className="field-error" role="alert">{error}</p>}
        {ocr.phase === "cancelled" && (
          <Banner tone="neutral" title="Import cancelled" live="polite">
            Nothing was lost. Your photo is still selected — read it again, or choose another one.
          </Banner>
        )}
        {ocr.phase === "failed" && (
          <Banner tone="error" title="We couldn’t read this photo" live="assertive">
            {error || "The text reader didn’t respond."} Your photo is kept; try again.
          </Banner>
        )}
        {ocr.phase === "none" && (
          <Banner
            tone="warning"
            title="No French text found"
            live="polite"
            actions={<Button kind="tertiary" onClick={() => go("study/new")}>Type text instead</Button>}
          >
            We couldn’t find French in this photo. Try a sharper, closer photo.
          </Banner>
        )}

        {!busy && (
          <div className="stack gap-2">
            <div className="btn-row">
              <Button kind="primary" onClick={start} disabledReason={!photo ? "Choose a photo first." : undefined}>
                {ocr.phase === "failed" || ocr.phase === "cancelled" ? "Try again" : "Read text from photo"}
              </Button>
            </div>
            {!photo && <DisabledReason>Choose a photo first.</DisabledReason>}
          </div>
        )}
        <p className="note"><Mic2 aria-hidden /> The photo is sent to the AI text reader only to find its words. This app doesn’t keep it.</p>
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
    <div className="page">
      <PageHead back={back} title="Check the text we found" desc={`From ${photoTitle}. Fix any mistakes, choose the sentences to study, and put them in order.`} />
      <h2 id="ocr-results-h" tabIndex={-1} className="sr-only">Recognised sentences</h2>
      <div className="stack gap-4">
        {(ocr.partial || forced === "partial") && (
          <Banner tone="warning" title="Only part of the photo could be read">
            We found {plural(lines.length, "sentence")}. Some text may be missing. You can continue with what was found or add text by hand later.
          </Banner>
        )}
        {over && (
          <Banner tone="warning" title={`You can study up to ${OCR_LIMIT} sentences at a time`} live="polite">
            {selected.length} are selected. Deselect {selected.length - OCR_LIMIT} to continue — removed items stay out of this import only.
          </Banner>
        )}
        <p className="t-strong" aria-live="polite">
          {selected.length} of {plural(lines.length, "sentence")} selected
        </p>
        {lines.length === 0 ? (
          <Banner tone="neutral" title="No sentences left in this import" actions={<Button kind="secondary" onClick={() => patchStudy({ ocr: { ...ocr, phase: "select" } })}>Choose another photo</Button>}>
            You removed every sentence from this import.
          </Banner>
        ) : (
          <ol className="list" aria-label="Recognised sentences">
            {lines.map((l, i) => (
              <li key={l.id} className="ocr-item">
                <input
                  type="checkbox"
                  id={`ocr-sel-${l.id}`}
                  checked={l.selected}
                  onChange={(e) => patchLines(lines.map((x) => (x.id === l.id ? { ...x, selected: e.target.checked } : x)))}
                  style={{ width: 22, height: 22, marginTop: 34, accentColor: "var(--primary)" }}
                  aria-label={`Include sentence ${i + 1}`}
                />
                <div className="stack gap-2">
                  <label htmlFor={`ocr-text-${l.id}`} className="t-label">
                    Sentence {i + 1}
                  </label>
                  <input
                    id={`ocr-text-${l.id}`}
                    className="input"
                    lang="fr"
                    value={l.text}
                    aria-describedby={l.low ? `ocr-low-${l.id}` : undefined}
                    onChange={(e) => patchLines(lines.map((x) => (x.id === l.id ? { ...x, text: e.target.value, low: undefined } : x)))}
                  />
                  {l.accentFrom && <p className="t-support">Accents corrected from: <span lang="fr">{l.accentFrom}</span>. Check the spelling before continuing.</p>}
                  {l.low && (
                    <p id={`ocr-low-${l.id}`} className="t-support" style={{ color: "var(--warning)" }}>
                      Low confidence: <span className="low-conf" lang="fr">{l.low.join(", ")}</span> — please check {l.low.length > 1 ? "these words" : "this word"}.
                    </p>
                  )}
                  <div className="ocr-tools">
                    <Button id={`ocr-move-${l.id}-up`} kind="tertiary" className="btn--sm-text" icon={<ArrowUp aria-hidden />} aria-label={`Move sentence ${i + 1} up`} disabledReason={i === 0 ? "Already first." : undefined} onClick={() => move(i, -1)}>
                      Up
                    </Button>
                    <Button id={`ocr-move-${l.id}-down`} kind="tertiary" className="btn--sm-text" icon={<ArrowDown aria-hidden />} aria-label={`Move sentence ${i + 1} down`} disabledReason={i === lines.length - 1 ? "Already last." : undefined} onClick={() => move(i, 1)}>
                      Down
                    </Button>
                    <Button
                      kind="tertiary"
                      className="btn--sm-text"
                      icon={<Trash2 aria-hidden />}
                      aria-label={`Remove sentence ${i + 1} from this import`}
                      onClick={() => {
                        setRemoved({ line: l, index: i });
                        patchLines(lines.filter((x) => x.id !== l.id));
                        announce(`Sentence ${i + 1} removed from this import.`);
                      }}
                    >
                      Remove from this import
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {removed && (
          <p className="row t-support" role="status">
            Removed one sentence from this import.
            <Button
              kind="tertiary"
              className="btn--sm-text"
              onClick={() => {
                const next = [...get().study.ocr.lines];
                next.splice(removed.index, 0, removed.line);
                patchLines(next);
                setRemoved(null);
              }}
            >
              Put it back
            </Button>
          </p>
        )}
        <div className="sticky-actions">
          <div className="btn-row">
            <Button
              kind="primary"
              disabledReason={reason}
              onClick={() => {
                patchStudy({ mode: "text", drafts: { ...get().study.drafts, text: selected.map((l) => l.text.trim()).join("\n") } });
                go("study/new", { focus: false });
                runAnalysis("Photo import");
              }}
            >
              Continue with {plural(selected.length, "selected sentence")}
            </Button>
            <Button kind="secondary" onClick={() => patchStudy({ ocr: { ...ocr, phase: "select" } })}>
              Choose another photo
            </Button>
          </div>
          {reason && <DisabledReason>{reason}</DisabledReason>}
        </div>
      </div>
    </div>
  );
}
