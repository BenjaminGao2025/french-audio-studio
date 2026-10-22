import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reloadFromStorage,
  extend,
  formatClock,
  getFocusDay,
  getFocusState,
  pause,
  remainingMs,
  resume,
  startBreak,
  startFocus,
  stop,
  tick,
} from "@/lib/focus-timer";

const logMutate = vi.fn();
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouterState: () => "/",
}));
vi.mock("@/api/hooks", () => ({
  useLogTime: () => ({ mutate: logMutate, isPending: false, error: null }),
}));

const MIN = 60_000;
const T0 = new Date(2026, 9, 21, 9, 0).getTime();

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("1000h.locale", "zh");
  _reloadFromStorage();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("focus timer store", () => {
  it("counts down from an absolute end time and completes once", () => {
    startFocus("25", T0);
    expect(remainingMs(getFocusState(), T0 + 10 * MIN)).toBe(15 * MIN);
    expect(tick(T0 + 24 * MIN)).toBeNull();
    expect(tick(T0 + 25 * MIN)).toBe("focus");
    expect(getFocusState().phase).toBe("done");
    expect(getFocusState().doneMin).toBe(25);
    expect(tick(T0 + 26 * MIN)).toBeNull();
    expect(getFocusDay()).toMatchObject({ count: 1, minutes: 25 });
  });

  it("pause freezes the clock and resume continues from where it stopped", () => {
    startFocus("25", T0);
    pause(T0 + 5 * MIN);
    expect(remainingMs(getFocusState(), T0 + 60 * MIN)).toBe(20 * MIN);
    expect(tick(T0 + 60 * MIN)).toBeNull();
    resume(T0 + 60 * MIN);
    expect(remainingMs(getFocusState(), T0 + 61 * MIN)).toBe(19 * MIN);
  });

  it("+5 minutes extends the session and counts the longer length", () => {
    startFocus("25", T0);
    extend(5);
    expect(tick(T0 + 25 * MIN)).toBeNull();
    expect(tick(T0 + 30 * MIN)).toBe("focus");
    expect(getFocusDay().minutes).toBe(30);
  });

  it("a session given up is not counted; a break ends back at idle", () => {
    startFocus("50", T0);
    stop();
    expect(getFocusState().phase).toBe("idle");
    expect(getFocusDay().count).toBe(0);
    startBreak(T0);
    expect(tick(T0 + 10 * MIN)).toBe("break");
    expect(getFocusState().phase).toBe("idle");
    expect(getFocusDay().count).toBe(0);
  });

  it("survives a reload and is not counted twice by a second tab", () => {
    startFocus("25", T0);
    _reloadFromStorage(); // another tab / a reload reads the same state
    expect(getFocusState()).toMatchObject({ phase: "focus", endsAt: T0 + 25 * MIN });
    tick(T0 + 25 * MIN);
    // The second tab still holds the old running state and ticks too.
    window.localStorage.setItem(
      "1000h.focus",
      JSON.stringify({
        phase: "focus",
        planId: "25",
        endsAt: T0 + 25 * MIN,
        pausedLeft: null,
        totalMs: 25 * MIN,
      }),
    );
    _reloadFromStorage();
    tick(T0 + 25 * MIN + 500);
    expect(getFocusDay().count).toBe(1);
  });

  it("formats the clock as m:ss", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(61_000)).toBe("1:01");
    expect(formatClock(400)).toBe("0:01");
  });
});

describe("FocusTimer widget", () => {
  it("starts a session, shows the countdown, and offers to log it when done", async () => {
    vi.useFakeTimers({ now: T0 });
    const { FocusTimer } = await import("@/components/fr/focus-timer");
    document.title = "今日 · 1000H French";
    render(<FocusTimer />);
    fireEvent.click(screen.getByRole("button", { name: "番茄钟" }));
    fireEvent.click(screen.getByRole("button", { name: /开始专注/ }));
    expect(screen.getAllByText("25:00").length).toBeGreaterThan(0);
    expect(document.title).toMatch(/^🍅 25:00 · /);

    act(() => vi.advanceTimersByTime(25 * MIN + 1000));
    expect(screen.getByText("完成一个番茄")).toBeInTheDocument();
    expect(document.title).toBe("今日 · 1000H French");

    fireEvent.click(screen.getByRole("button", { name: "听力" }));
    expect(logMutate).toHaveBeenCalledWith(
      { lane: "listening", minutes: 25, note: "番茄钟 25 分钟" },
      expect.anything(),
    );
  });
});
