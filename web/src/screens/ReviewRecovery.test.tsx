// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewScreen } from "./Review";
import { get, resetDemo, set } from "../state/store";
import { resetReviewCache, type ServerCard } from "../api/review";

vi.mock("../lib/feedback", () => ({ gradeFeedback: vi.fn(), practiceFeedback: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const real: ServerCard = {
  id: "server-card", note_id: "server-note", mode: "speak", target: "", target_meta: {},
  due: new Date().toISOString(), importance: 3, archived: false, state: "new", created_at: new Date().toISOString(),
  note: { id: "server-note", sentence: "Nous rentrons ensemble.", translation_en: "We go home together.", translation_zh: "" },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const queue = (cards: ServerCard[]) => ({ cards, counts: { new_limit: 10, new_today: 4, reviewed_today: 4 } });
const settings = { session_size: 10, default_session_size: 40 };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  resetDemo(); resetReviewCache();
  set(() => ({ route: "review/session" }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const button = (name: string) => {
  const found = name === "Good" ? host.querySelector<HTMLButtonElement>('[data-rating="3"]') : [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button ${name}`);
  return found;
};

it("refresh waits for the server queue and freezes only real cards, using the server's allowance", async () => {
  let resolve!: (value: Response) => void;
  const f = vi.fn((path: string) => path.includes("/api/srs/queue")
    ? new Promise<Response>(r => { resolve = r; }) : Promise.resolve(json(settings)));
  vi.stubGlobal("fetch", f);
  await act(async () => root.render(<ReviewScreen sub="session" />));
  expect(host.textContent).toContain("Loading today’s cards");
  expect(get().review.sessionCards).toBeNull();
  await act(async () => resolve(json(queue([real]))));
  expect(get().review.sessionCards?.map(c => c.id)).toEqual(["server-card"]);
  expect(get().dailyNew).toBe(10);
  expect(get().newUsed).toBe(5); // four on the server, plus the new card now shown
  expect(host.textContent).toContain("We go home together.");
});

it("failed queue load shows Retry without locking sample cards; Retry loads the real queue", async () => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.includes("/api/srs/queue")
    ? failed ? json({ detail: "Temporary error" }, 503) : json(queue([real])) : json(settings)));
  await act(async () => root.render(<ReviewScreen sub="session" />));
  expect(host.textContent).toContain("Today’s cards didn’t load");
  expect(get().review.sessionCards).toBeNull();
  failed = false;
  await act(async () => button("Retry").click());
  expect(get().review.sessionCards?.map(c => c.id)).toEqual(["server-card"]);
});

it("an empty server queue shows completion instead of sample cards", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => json(path.includes("/api/srs/queue") ? queue([]) : settings)));
  await act(async () => root.render(<ReviewScreen sub="session" />));
  expect(get().review.sessionCards).toEqual([]);
  expect(host.textContent).toContain("Review complete");
});

it("returning to an existing session keeps its locked cards without refetching the queue", async () => {
  const f = vi.fn(async (_path: string) => json({})); vi.stubGlobal("fetch", f);
  set(s => ({ review: { ...s.review, phase: "active", sessionCards: [s.queue[0]] } }));
  const ids = get().review.sessionCards?.map(c => c.id);
  await act(async () => root.render(<ReviewScreen sub="session" />));
  expect(get().review.sessionCards?.map(c => c.id)).toEqual(ids);
  expect(f.mock.calls.some(([path]) => String(path).includes("/api/srs/queue"))).toBe(false);
});

it.each([1, 2, 3, 4])("rating %s retry keeps the chosen rating and request id; the next presentation gets a new id", async rating => {
  const requests: { request_id: string; rating: number }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/review")) {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) throw new TypeError("response lost");
      return json({ ...real, state: "learning", due: new Date(Date.now() + 60_000).toISOString() });
    }
    return json(path.includes("/api/srs/queue") ? queue([real]) : settings);
  }));
  await act(async () => root.render(<ReviewScreen sub="session" />));
  await act(async () => button("Show answer").click());
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-rating="${rating}"]`)!.click());
  expect(button("Good").getAttribute("aria-disabled")).toBe("true");
  await act(async () => button("Retry").click());
  expect(requests).toHaveLength(2);
  expect(requests[0].request_id).toBeTruthy();
  expect(requests[1].request_id).toBe(requests[0].request_id);
  expect(requests[1].rating).toBe(rating);
  await act(async () => button("Show answer").click());
  await act(async () => button("Good").click());
  expect(requests).toHaveLength(3);
  expect(requests[2].request_id).not.toBe(requests[0].request_id);
});
