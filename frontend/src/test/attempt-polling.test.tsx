import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { useSettledAttempt } from "@/api/hooks";
import type { Attempt } from "@/api/types";

vi.mock("@/api", () => ({
  api: { write: { getAttempt: vi.fn() }, speak: { getAttempt: vi.fn() } },
}));

const pending: Attempt = { id: "a1", status: "pending" };

function Probe({ attempt, round = 1 }: { attempt: Attempt | null; round?: 1 | 2 }) {
  const current = useSettledAttempt("write", attempt, round);
  return <p data-testid="s">{current?.status ?? "none"}</p>;
}
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("polls every 3 s while pending and stops once the attempt is ready", async () => {
  vi.mocked(api.write.getAttempt)
    .mockResolvedValueOnce({ id: "a1", status: "pending" })
    .mockResolvedValue({ id: "a1", status: "ready" });
  render(wrap(<Probe attempt={pending} />));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByTestId("s")).toHaveTextContent("pending");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  await act(() => vi.advanceTimersByTimeAsync(50)); // let the query notify React
  expect(screen.getByTestId("s")).toHaveTextContent("ready");
  const calls = vi.mocked(api.write.getAttempt).mock.calls.length;
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(vi.mocked(api.write.getAttempt).mock.calls.length).toBe(calls);
});

it("settles on failed", async () => {
  vi.mocked(api.write.getAttempt).mockResolvedValue({ id: "a1", status: "failed", error: "x" });
  render(wrap(<Probe attempt={pending} />));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByTestId("s")).toHaveTextContent("failed");
});

it("does not fetch an attempt that is already ready", async () => {
  render(wrap(<Probe attempt={{ id: "a1", status: "ready" }} />));
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(api.write.getAttempt).not.toHaveBeenCalled();
  expect(screen.getByTestId("s")).toHaveTextContent("ready");
});

it("round 2 does not read the settled result of round 1", async () => {
  vi.mocked(api.write.getAttempt).mockResolvedValue({ id: "a1", status: "ready" });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(
    <QueryClientProvider client={qc}>
      <Probe attempt={pending} round={1} />
    </QueryClientProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByTestId("s")).toHaveTextContent("ready");
  vi.mocked(api.write.getAttempt).mockResolvedValue({ id: "a1", status: "pending" });
  rerender(
    <QueryClientProvider client={qc}>
      <Probe attempt={pending} round={2} />
    </QueryClientProvider>,
  );
  expect(screen.getByTestId("s")).toHaveTextContent("pending");
});
