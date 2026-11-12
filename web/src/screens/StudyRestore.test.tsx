// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseExplanationLanguage } from "../lib/explanationLanguage";
import { StudyInput, StudyPhoto, selectStudyPhoto } from "./StudyInput";
import * as studyApi from "../api/study";
import { StudyPersonal } from "./StudyPersonal";
import { StudyGrammar } from "./StudyGrammar";
import { ExplainPanel, GrammarSave } from "./StudyTools";
import { StudyRecorder, takeAudioFocus } from "../components/StudyRecorder";
import { StudyReviewNotice } from "../components/StudyReviewNotice";
import { get, parseLocation, resetDemo, set } from "../state/store";
import { validate } from "../state/study";
import { toStudySentence } from "../api/study";
import { cardKey, loadSavedCards, resetSavedCards } from "../api/srs";
import type { JournalEntry } from "../api/learning";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sentence = toStudySentence({ sentence: "Je vais au marché.", translation_en: "I go to the market.", translation_zh: "", words: [], grammar_points: [], build_up: [] });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: { path: string; init?: RequestInit }[];
let respond: (path: string, init?: RequestInit) => unknown;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (text: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(text));
  if (!b) throw Error(`Missing button: ${text}`);
  return b;
};
const click = async (text: string) => { await act(async () => button(text).click()); await settle(); };
const input = async (id: string, value: string) => {
  await act(async () => {
    const el = host.querySelector<HTMLTextAreaElement>(`#${id}`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const entry = (p: Partial<JournalEntry> = {}): JournalEntry => ({ id: "practice-1", native_text: "I live here. I like my work.", french: "J’habite ici. J’aime mon travail.", reference_url: "/api/homework/practice-1/reference", complete: false, reflection: "", recalled: false, practice_seconds: 0, created_at: "2026-11-09T12:00:00Z", parts: [{ source: "I live here.", french: "J’habite ici." }, { source: "I like my work.", french: "J’aime mon travail." }], recordings: [], can_expand: false, ...p });

beforeEach(() => {
  resetDemo(); resetSavedCards(); set(() => ({ auth: "in", route: "study/new" }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); calls = [];
  respond = (path) => path.includes("/api/history") ? { records: [] } : path.includes("/api/srs/queue") ? { counts: { total: 0 } } : {};
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init }); const data = await respond(path, init);
    return data instanceof Response ? data : new Response(JSON.stringify(data));
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  URL.createObjectURL = vi.fn(() => "blob:test"); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(async () => { await act(async () => root.unmount()); localStorage.removeItem("explanationLanguage"); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("restored study flows", () => {
  it("accepts 15,000 text characters and redirects old personal/grammar routes", () => {
    expect(validate("a".repeat(15000), "text")).toBeNull();
    expect(validate("a".repeat(15001), "text")).toBe("over");
    history.replaceState(null, "", "/app/homework"); expect(parseLocation()).toBe("study/personal");
    history.replaceState(null, "", "/app/grammar?point=V.present"); expect(parseLocation()).toBe("study/grammar?point=V.present");
  });
  it.each(["paste", "drop"])("sends a screenshot from %s to photo OCR without losing the draft", async (kind) => {
    await act(async () => root.render(<StudyInput />)); await settle();
    const draft = get().study.drafts.text;
    const file = new File(["image"], "screenshot.png", { type: "image/png" });
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, kind === "paste" ? "clipboardData" : "dataTransfer", { value: { files: [file] } });
    await act(async () => host.querySelector("textarea")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(get().route).toBe("study/photo");
    expect(get().study.drafts.text).toBe(draft);
    expect(get().study.ocr.photoId).toBe("screenshot.png");
    await act(async () => root.render(<StudyPhoto />));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:test");
  });
  it("shows actual due counts and opens review", async () => {
    respond = () => ({ counts: { total: 9, review: 3, learning: 2, new: 4, reviewed_today: 6 } });
    await act(async () => root.render(<StudyReviewNotice />)); await settle();
    expect(host.textContent).toContain("Due today");
    expect(host.textContent).toMatch(/Cards\s*9/);
    expect(host.textContent).toMatch(/To revisit\s*5/);
    await click("Review today"); expect(get().route).toBe("review/due");
  });
  it.each(["Remove", "Backspace", "Delete"])("removes a selected photo with %s and releases its object URL", async (action) => {
    selectStudyPhoto(new File(["image"], "chosen.png", { type: "image/png" }));
    set(() => ({ route: "study/photo" }));
    await act(async () => root.render(<StudyPhoto />));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:test");
    expect(host.textContent).toContain("chosen.png");
    vi.mocked(URL.revokeObjectURL).mockClear();
    if (action === "Remove") await click("Remove");
    else {
      const preview = host.querySelector<HTMLElement>('[aria-label="Selected photo"]')!;
      preview.focus();
      await act(async () => preview.dispatchEvent(new KeyboardEvent("keydown", { key: action, bubbles: true, cancelable: true })));
    }
    expect(host.querySelector("img")).toBeNull();
    expect(button("Take or choose a photo")).toBeTruthy();
    expect(get().route).toBe("study/photo");
    expect(get().study.ocr).toEqual({ phase: "select", lines: [], partial: false });
    expect(get().announce.msg).toBe("Photo removed.");
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test");
    expect(host.textContent).toContain("This app doesn’t keep it.");
    // The module-level file is cleared too: a later visit stays empty.
    await act(async () => root.render(null));
    await act(async () => root.render(<StudyPhoto />));
    expect(host.querySelector("img")).toBeNull();
  });
  it.each(["preparing", "uploading"])("ignores late OCR work after removing a photo while %s", async (stage) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    vi.spyOn(studyApi, "photoToDataUrl").mockImplementation(async () => {
      if (stage === "preparing") await pending;
      return "data:image/png;base64,dGVzdA==";
    });
    const extract = vi.spyOn(studyApi, "photoExtract").mockImplementation(async () => {
      await pending;
      return [{ fr: "Bonjour.", kind: "sentence", gloss: "Hello." }];
    });
    selectStudyPhoto(new File(["image"], "chosen.png", { type: "image/png" }));
    await act(async () => root.render(<StudyPhoto />));
    await click("Read text from photo");
    expect(get().study.ocr.phase).toBe("processing");
    await click("Remove");
    if (stage === "uploading") expect(extract.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => finish());
    await settle();
    if (stage === "preparing") expect(extract).not.toHaveBeenCalled();
    expect(get().study.ocr).toEqual({ phase: "select", lines: [], partial: false });
    expect(get().announce.msg).toBe("Photo removed.");
    expect(button("Take or choose a photo")).toBeTruthy();
    expect(host.textContent).not.toContain("Preparing and resizing");
  });
  it("keeps grammar-card save status separate for each point", async () => {
    respond = () => ({ notes: [{ sentence: sentence.fr, cards: [{ mode: "grammar", target: "Present tense" }] }] });
    await loadSavedCards([sentence.fr]);
    expect(cardKey("grammar", "Present tense")).not.toBe(cardKey("grammar", "Articles"));
    await act(async () => root.render(<><GrammarSave sentence={sentence} point={{ title: "Present tense", explanation: "", hook: "" }} /><GrammarSave sentence={sentence} point={{ title: "Articles", explanation: "", hook: "" }} /></>));
    expect(button("Grammar card saved").getAttribute("aria-disabled")).toBe("true");
    expect(button("Make a practice card").getAttribute("aria-disabled")).not.toBe("true");
  });
  it("corrects explanations, continues a tutor conversation and saves an answer as a card", async () => {
    chooseExplanationLanguage("zh");
    respond = (path) => path === "/api/feynman" ? { verdict: "partial", got_right: ["The meaning is correct."], gaps: ["au joins à and le."], variation: null, follow_up: "Why au?" } : path === "/api/ask" ? { answer: "Au joins à and le." } : { notes: [] };
    await act(async () => root.render(<ExplainPanel sentence={sentence} />));
    await input("explain-draft", "It means I go to the market."); await click("Check my understanding");
    expect(host.textContent).toContain("au joins à and le.");
    await input("tutor-question", "Why au?"); await click("Ask tutor");
    await input("tutor-question", "Does it work with la?"); await click("Ask tutor");
    const ask = calls.filter((c) => c.path === "/api/ask");
    const body = JSON.parse(ask[1].init!.body as string);
    expect(body.history).toHaveLength(2);
    expect(body).toMatchObject({ question: "Does it work with la?", translation_en: sentence.en, language: "zh" });
    expect(body.word).toBeUndefined();
    await click("Turn this answer"); expect(calls.some((c) => c.path === "/api/ask/card")).toBe(true);
    expect(host.textContent).toContain("Practice card saved");
  });
  it("opens grammar points using real API field names and preserves the ideas draft", async () => {
    set(() => ({ route: "study/grammar?point=V.present" }));
    respond = (path) => path === "/api/grammar/map" ? { seen: 1, blocks: [{ id: "V", en: "Verb", points: [{ id: "V.present", en: "present tense", fr: "le présent", level: "A1", count: 1, focus: true }] }] } : path.includes("/sentences") ? { sentences: [{ sentence: "Je travaille.", history_id: "missing" }] } : { records: [] };
    await act(async () => root.render(<StudyGrammar />)); await settle();
    expect(host.textContent).toContain("present tense"); expect(host.textContent).toContain("Je travaille.");
    const idea = get().study.drafts.ideas; await click("Study this sentence");
    expect(get().study.drafts.text).toBe("Je travaille."); expect(get().study.drafts.ideas).toBe(idea);
  });
  it("prepares full personal ideas, selects parts, hides French, and archives reflection", async () => {
    let saved = entry({ french: "", reference_url: "", parts: [] });
    respond = (path, init) => {
      if (path === "/api/homework") return init?.method === "POST" ? saved : { entries: [] };
      if (path.endsWith("/prepare")) { saved = entry({ recordings: [{ id: "f", kind: "first", duration: 5, url: "/first", created_at: "" }, { id: "l", kind: "final", duration: 5, url: "/final", created_at: "" }] }); return saved; }
      if (path.endsWith("/finish")) { saved = { ...saved, complete: true, ...JSON.parse(init!.body as string) }; return saved; }
      return new Response(new Blob(["audio"], { type: "audio/mpeg" }));
    };
    await act(async () => root.render(<StudyPersonal />)); await settle();
    await input("personal-native", "I live here. I like my work."); await click("Prepare French and audio");
    expect(host.textContent).toContain("J’aime mon travail.");
    await click("Part 2"); expect(calls.some((c) => c.path.endsWith("?part=1"))).toBe(true);
    await click("Hide French text"); expect(host.textContent).not.toContain("J’aime mon travail.");
    expect(button("Finish and archive").getAttribute("aria-disabled")).toBe("true");
    await input("personal-reflection", "I can say both sentences now."); await click("Finish and archive");
    expect(host.textContent).toContain("Practice archived"); expect(saved.reflection).toBe("I can say both sentences now.");
  });
});

describe("recorder lifecycle", () => {
  it("preserves a take when navigating away during recording, without submitting it", async () => {
    const stop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["kept take"]) }); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", Recorder);
    const take = vi.fn(async () => undefined);
    await act(async () => root.render(<StudyRecorder id="navigation-take" label="Record navigation" onTake={take} />));
    await click("Record navigation");
    await act(async () => root.render(null));
    expect(stop).toHaveBeenCalled(); expect(take).not.toHaveBeenCalled();
    await act(async () => root.render(<StudyRecorder id="navigation-take" label="Record navigation" onTake={take} />));
    expect(host.querySelector("audio")).not.toBeNull();
    await click("Check recording"); expect(take).toHaveBeenCalledTimes(1);
  });
  it("releases a late microphone permission result after another audio action", async () => {
    const stop = vi.fn(); let grant!: (stream: { getTracks: () => { stop: typeof stop }[] }) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } });
    const recorder = vi.fn(); vi.stubGlobal("MediaRecorder", recorder);
    await act(async () => root.render(<StudyRecorder id="late-microphone" label="Record late" onTake={async () => undefined} />));
    await click("Record late");
    await act(async () => { takeAudioFocus(); grant({ getTracks: () => [{ stop }] }); });
    expect(stop).toHaveBeenCalled(); expect(recorder).not.toHaveBeenCalled();
  });
  it("keeps a failed take for retry and stops microphone tracks", async () => {
    const stop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["recorded audio"]) }); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", Recorder);
    const take = vi.fn().mockRejectedValueOnce(Error("ASR unavailable")).mockResolvedValue(undefined);
    await act(async () => root.render(<StudyRecorder id="retry-test" label="Record test" onTake={take} />));
    await click("Record test"); await click("Stop");
    expect(stop).toHaveBeenCalled(); expect(host.textContent).toContain("ASR unavailable"); expect(host.querySelector("audio")).not.toBeNull();
    await click("Retry recording"); expect(take).toHaveBeenCalledTimes(2); expect(take.mock.calls[0][0]).toBe(take.mock.calls[1][0]);
    expect(host.textContent).toContain("Checked");
  });
});
