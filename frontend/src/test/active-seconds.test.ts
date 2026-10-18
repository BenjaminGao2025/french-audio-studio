import { act, renderHook, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useActiveSeconds } from "@/api/use-active-seconds";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("excludes generation waits, hidden tabs, idle time and resets between materials", () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { result, rerender } = renderHook(({ active }) => useActiveSeconds(active), {
    initialProps: { active: false },
  });
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.read()).toBe(0);
  rerender({ active: true });
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.read()).toBe(10);
  visibility.mockReturnValue("hidden");
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.read()).toBe(10);
  visibility.mockReturnValue("visible");
  act(() => vi.advanceTimersByTime(60_000));
  const idle = result.current.read();
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.read()).toBe(idle);
  fireEvent.pointerDown(document);
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.read()).toBe(idle + 2);
  result.current.reset();
  expect(result.current.read()).toBe(0);
});
