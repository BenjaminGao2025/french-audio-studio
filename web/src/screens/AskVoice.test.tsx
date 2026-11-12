// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Ask } from "./WordPopup";
import { toStudySentence } from "../api/study";
import { fake, installFakeBackend } from "../test/fakeBackend";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sentence = toStudySentence({sentence:"Les représentants ont résolu d'exposer les droits.", translation_en:"They resolved.", translation_zh:"", words:[], grammar_points:[], build_up:[]});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const trackStop = vi.fn();
const getUserMedia = vi.fn();
class FakeRecorder {
  static isTypeSupported = vi.fn((mime: string) => mime === "audio/mp4");
  static instances: FakeRecorder[] = [];
  state = "inactive";
  mimeType: string;
  ondataavailable?: (e: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(_stream: unknown, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType || "";
    FakeRecorder.instances.push(this);
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({data:new Blob(["fake recording"],{type:this.mimeType})});
    this.onstop?.();
  }
}
beforeEach(() => {
  installFakeBackend(); fake.reset(); fake.delay = 0;
  getUserMedia.mockReset().mockResolvedValue({getTracks:() => [{stop:trackStop}]});
  trackStop.mockClear(); FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia},configurable:true});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  Object.defineProperty(navigator,"mediaDevices",{value:undefined,configurable:true});
});
const render = () => act(async () => root.render(<Ask sentence={sentence} word="résolu" />));
const click = (label: string) => act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); await new Promise(r => setTimeout(r, 15)); });
const input = () => host.querySelector<HTMLInputElement>('input')!;
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input(),text);
  input().dispatchEvent(new Event("input",{bubbles:true}));
});
it.each(["recorder", "mediaDevices", "getUserMedia"])("hides the mic without %s", async missing => {
  if (missing === "recorder") vi.stubGlobal("MediaRecorder",undefined);
  else Object.defineProperty(navigator,"mediaDevices",{value:missing === "mediaDevices" ? undefined : {},configurable:true});
  await render();
  expect(host.querySelector('[aria-label="Record question"]')).toBeNull();
  expect(input()).toBeTruthy();
});
it("records mp4, transcribes with sentence context, appends reviewed text, and only sends on Send", async () => {
  const fetchSpy = vi.spyOn(globalThis,"fetch");
  await render();
  expect(host.querySelector('[aria-label="Record question"]')).toBeTruthy();
  await type("Why résolu?");
  await click("Record question");
  expect(getUserMedia).toHaveBeenCalledWith({audio:true});
  expect(host.querySelector('[aria-label="Stop recording"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(FakeRecorder.instances[0].mimeType).toBe("audio/mp4");
  await click("Stop recording");
  expect(input().value).toBe("Why résolu? Bonjour, je m’appelle Léa.");
  const transcribe = fetchSpy.mock.calls.find(([url]) => String(url).startsWith("/api/transcribe?"))!;
  expect(new URL(String(transcribe[0]),"http://localhost").searchParams.get("language")).toBe("zh");
  expect(new URL(String(transcribe[0]),"http://localhost").searchParams.get("sentence")).toBe(sentence.fr);
  expect(transcribe[1]?.method).toBe("POST");
  expect((transcribe[1]?.body as Blob).type).toBe("audio/mp4");
  expect(fake.calls.filter(c => c.path === "/api/ask")).toHaveLength(0);
  await type("Reviewed question");
  await click("Record question"); await click("Stop recording");
  expect(input().value).toBe("Reviewed question Bonjour, je m’appelle Léa.");
  expect(fake.calls.filter(c => c.path === "/api/transcribe")).toHaveLength(2);
  expect(fake.calls.filter(c => c.path === "/api/ask")).toHaveLength(0);
  await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await new Promise(r => setTimeout(r,15)); });
  expect(fake.calls.find(c => c.path === "/api/ask")?.body).toMatchObject({question:input().value,word:"résolu"});
  expect(trackStop).toHaveBeenCalledTimes(2);
  fetchSpy.mockRestore();
});
it("recovers from permission denial and leaves the input editable", async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException("denied","NotAllowedError"));
  await render(); await click("Record question");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Allow microphone access");
  expect(host.querySelector('[aria-label="Record question"]')?.getAttribute("aria-pressed")).toBe("false");
  await type("Typed question");
  expect(input().value).toBe("Typed question");
  await click("Dismiss microphone error");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await click("Record question"); await click("Stop recording");
  expect(input().value).toContain("Typed question Bonjour");
});
it("shows transcription errors and can record again", async () => {
  await render(); fake.failNext.add("/api/transcribe");
  await click("Record question"); await click("Stop recording");
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
  expect(input().value).toBe("");
  await click("Record question"); await click("Stop recording");
  expect(input().value).toContain("Bonjour");
});
it("releases the microphone on unmount without transcribing", async () => {
  await render(); await click("Record question");
  await act(async () => root.render(null));
  expect(trackStop).toHaveBeenCalled();
  expect(fake.calls.filter(c => c.path === "/api/transcribe")).toHaveLength(0);
});
