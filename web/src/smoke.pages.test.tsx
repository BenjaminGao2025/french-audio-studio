// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { fake } from "./test/fakeBackend";
import { get, go, resetDemo, updatePlayer } from "./state/store";
import { setupSmoke, wait, openHistoryRow, buttonWith, studyRecord, attemptRow } from "./test/smokeHarness";

setupSmoke();

describe("14. History, Progress and Episodes on the server", () => {
  it("clearing attempts deletes them on the server and leaves study records alone", async () => {
    await act(async () => resetDemo());
    fake.attempts = [attemptRow("t1", "Bonjour."), attemptRow("t2", "Merci.", false)];
    fake.studyRecords = [studyRecord("r1", ["Bonjour."])];
    await act(async () => go("progress/history?tab=attempts"));
    await wait(200);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("2 practice attempts");
    await act(async () => buttonWith("Clear practice attempt history").click());
    await act(async () => buttonWith("Clear attempt history").click());
    await wait(300);
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/dictation/history")).toBe(true);
    expect(fake.attempts).toHaveLength(0);
    expect(fake.studyRecords).toHaveLength(1);
    expect(main.textContent).toContain("No practice attempts");
  });

  it("an analysis saved without sentences can't be reopened, only put back as text", async () => {
    await act(async () => resetDemo());
    fake.studyRecords = [{ ...studyRecord("r1", []), sentences: undefined, sentenceCount: 3, text: "Texte ancien." }];
    await act(async () => go("progress/history?tab=analyses"));
    await wait(200);
    await act(async () => openHistoryRow("Texte ancien.").click());
    expect(document.getElementById("main")!.textContent).toContain("can’t be opened");
    await act(async () => buttonWith("Put the text in Study").click());
    expect(get().study.drafts.text).toBe("Texte ancien.");
    expect(get().route).toBe("study/new");
  });

  it("study time lists each day with its lanes and hand-logged time", async () => {
    await act(async () => resetDemo());
    await act(async () => go("progress/history?tab=time"));
    await wait(200);
    const t = document.getElementById("main")!.textContent!;
    expect(t).toContain("25 min");
    expect(t).toContain("Reading 15 min");
    expect(t).toContain("Review 10 min");
    expect(t).toContain("10 min logged by hand");
  });

  it("after a reload Study offers the last saved analysis", async () => {
    await act(async () => resetDemo());
    fake.studyRecords = [studyRecord("r1", ["Il fait beau.", "On sort ?"])];
    await act(async () => go("study/new"));
    await wait(200);
    expect(document.getElementById("main")!.textContent).toContain("Continue");
    expect(document.getElementById("main")!.textContent).toContain("2 sentences saved");
    await act(async () => buttonWith("Continue").click());
    expect(get().study.sentences).toHaveLength(2);
    expect(get().route).toBe("study");
  });

  it("Progress shows the server's totals and the episode player shows the transcript", async () => {
    await act(async () => resetDemo());
    await act(async () => go("progress"));
    await wait(200);
    const main = document.getElementById("main")!;
    expect(main.textContent).toContain("40 XP to level 4");
    expect(main.textContent).not.toContain("Demo data");
    await act(async () => go("practice/episodes/e1"));
    await wait(200); // the list arrives, then the player asks for the transcript
    await wait(200);
    expect(main.textContent).toContain("Un samedi au marché");
    expect(main.textContent).toContain("On va au marché.");
  });
});

describe("15. Practice, Settings and the exam placeholder on the server", () => {
  beforeAll(() => {
    // jsdom has no media playback; the shared player is driven by hand below.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  const main = () => document.getElementById("main")!;
  const area = (id: string) => document.getElementById(id) as HTMLTextAreaElement;
  const typeArea = (el: HTMLTextAreaElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("Write: hints first, then corrections, and a corrected sentence goes to Review", { timeout: 20000 }, async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/write"));
    await wait(200);
    expect(main().textContent).toContain("Invitez un ami à dîner.");
    await typeArea(area("write-ta"), "Samedi je suis allé au marché avec ma sœur.");
    await act(async () => buttonWith("Get feedback").click());
    await wait(3400);
    expect(main().textContent).toContain("Check the past participle.");
    expect(main().textContent).not.toContain("Je suis allée au marché.");
    await typeArea(area("write-rev"), "Samedi je suis allée au marché avec ma sœur.");
    await act(async () => buttonWith("Get corrections").click());
    await wait(3400);
    expect(main().textContent).toContain("Writing practice complete");
    expect(main().textContent).toContain("Je suis allée au marché.");
    await act(async () => buttonWith("Add to review").click());
    await wait(100);
    const note = fake.calls.find((c) => c.path === "/api/srs/notes" && c.method === "POST")!;
    expect(note.body).toMatchObject({ sentence: "Je suis allée au marché.", modes: ["listen", "speak"], targets: [{ text: "suis allée", mode: "cloze" }] });
    expect(main().textContent).toContain("In Review");
  });

  it("Speak: a recording is transcribed into the editable transcript and gets feedback", { timeout: 20000 }, async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const nav = navigator as unknown as { mediaDevices?: unknown };
    class FakeRecorder {
      static isTypeSupported = (t: string) => t === "audio/webm";
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    g.MediaRecorder = FakeRecorder;
    nav.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
    g.URL = Object.assign(URL, { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });
    try {
      await act(async () => resetDemo());
      await act(async () => go("practice/speak"));
      await wait(200);
      expect(main().textContent).toContain("Comment vous appelez-vous ?");
      await act(async () => buttonWith("Start recording").click());
      await wait(50);
      await act(async () => buttonWith("Stop recording").click());
      await wait(200);
      expect(area("speak-ta").value).toBe("Bonjour, je m’appelle Léa.");
      const up = fake.calls.find((c) => c.path === "/api/transcribe")!;
      expect(up.method).toBe("POST");
      await act(async () => buttonWith("Get feedback").click());
      await wait(3400);
      const sent = fake.calls.find((c) => c.path === "/api/speak/attempts" && c.method === "POST")!;
      expect(sent.body).toMatchObject({ task: "T1", transcript: "Bonjour, je m’appelle Léa.", audio_duration: 4 });
      expect(main().textContent).toContain("Clear and polite.");
    } finally {
      delete g.MediaRecorder;
      delete nav.mediaDevices;
    }
  });

  it("Speak without a microphone says to type instead", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/speak"));
    await wait(200);
    await act(async () => buttonWith("Start recording").click());
    await wait(50);
    expect(main().textContent).toContain("This browser can’t record audio. Type your answer instead.");
  });

  it("Listen: blind play, self-rating, text, three relistens unlock the question", { timeout: 15000 }, async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/listen"));
    await wait(100);
    await act(async () => buttonWith("Start listening").click());
    await wait(200);
    expect(main().textContent).not.toContain("On va au marché.");
    const end = async () => {
      await wait(20);
      await act(async () => updatePlayer({ status: "ended" }));
      await wait(150);
    };
    await act(async () => buttonWith("Play the clip").click());
    await end();
    await act(async () => (Array.from(main().querySelectorAll("label")).find((l) => l.textContent === "Most or all of it")!.querySelector("button, input") as HTMLElement).click());
    await act(async () => buttonWith("Continue").click());
    await wait(150);
    await act(async () => buttonWith("Show the text").click());
    await wait(150);
    expect(main().textContent).toContain("On va au marché.");
    expect(main().textContent).not.toContain("Où vont-ils ?");
    for (const label of ["Play · Slow", "Play · Normal speed", "Play · Normal speed again"]) {
      await act(async () => buttonWith(label).click());
      await end();
    }
    const stages = fake.calls.filter((c) => c.path.endsWith("/relisten")).map((c) => (c.body as { stage: string }).stage);
    expect(stages).toEqual(["slow20", "normal", "normal"]);
    expect(main().textContent).toContain("Où vont-ils ?");
    await act(async () => (Array.from(main().querySelectorAll("label")).find((l) => l.textContent?.startsWith("Au marché"))!.querySelector("button, input") as HTMLElement).click());
    await act(async () => buttonWith("Check").click());
    await wait(150);
    expect(main().textContent).toContain("Correct");
    const check = fake.calls.find((c) => c.path.endsWith("/check"))!;
    expect(check.body).toMatchObject({ answer_index: 0, seconds: 0 });
  });

  it("Listen with nothing studied sends the learner to Study", async () => {
    await act(async () => resetDemo());
    fake.noListening = true;
    await act(async () => go("practice/listen"));
    await wait(100);
    await act(async () => buttonWith("Start listening").click());
    await wait(150);
    expect(main().textContent).toContain("Nothing to listen to yet");
  });

  it("Audio Studio: own words to French, then audio with a download link", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/studio"));
    await wait(50);
    await typeArea(area("studio-in"), "I would like a coffee");
    await act(async () => buttonWith("Make it French").click());
    await wait(150);
    expect(area("studio-fr").value).toBe("Je voudrais un café, s’il vous plaît.");
    await act(async () => buttonWith("Make audio").click());
    await wait(150);
    expect(fake.calls.find((c) => c.path === "/api/speech")!.body).toMatchObject({ text: "Je voudrais un café, s’il vous plaît.", voice: "fr-FR-DeniseNeural" });
    expect(main().querySelector('a[href="/files/fake.mp3?download=true"]')).toBeTruthy();
    await typeArea(area("studio-fr"), "Un thé, merci.");
    expect(buttonWith("Make audio again")).toBeTruthy();
  });

  it("Settings lists signed-in devices and signs another one out; nothing is simulated", async () => {
    await act(async () => resetDemo());
    await act(async () => go("settings"));
    await wait(200);
    const t = main().textContent!;
    expect(t).toContain("Chrome on Linux");
    expect(t).toContain("This device");
    expect(t).not.toMatch(/Demo|simulated|Sync/);
    const row = Array.from(main().querySelectorAll("li")).find((li) => li.textContent?.includes("Safari on iPhone"))!;
    await act(async () => row.querySelector("button")!.click());
    await wait(150);
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/auth/devices/d2")).toBe(true);
    expect(main().textContent).not.toContain("Safari on iPhone");
  });

  it("Exam practice is an honest placeholder", async () => {
    await act(async () => resetDemo());
    await act(async () => go("practice/exams"));
    await wait(50);
    expect(main().textContent).toContain("not yet verified");
    expect(document.querySelector(".demo-banner")).toBeNull();
  });

  it("Removed pages (old /coach, /grammar, /homework links) say they moved, without a demo banner", async () => {
    await act(async () => resetDemo());
    await act(async () => go("moved"));
    await wait(50);
    expect(main().textContent).toContain("This page has moved");
    expect(document.querySelector(".demo-banner")).toBeNull();
  });
});
