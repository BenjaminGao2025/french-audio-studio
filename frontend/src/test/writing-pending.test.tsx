import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/writing";
import { api } from "@/api";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  BlockShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/fr/widgets", () => ({ RubricPanel: () => null }));
vi.mock("@/api", () => ({
  api: {
    write: {
      tasks: vi.fn(),
      attempt: vi.fn(),
      getAttempt: vi.fn(),
      round2: vi.fn(),
      rubric: vi.fn(),
    },
    humanScores: { calibration: vi.fn() },
  },
}));
// The backend generates feedback in the background: the attempt starts as "pending".
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.write.attempt).mockResolvedValue({ id: "a1", status: "pending" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function mountAndSubmit() {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(["write-tasks"], {
    tasks: [
      {
        task: "T1",
        minutes: 10,
        word_range: [1, 120],
        subjects: [{ id: "w1", prompt: "Write an email" }],
      },
    ],
  });
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing writing page");
  render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bonjour Marc" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
it("shows a loading state, polls, then shows the hints once the feedback is ready", async () => {
  vi.mocked(api.write.getAttempt)
    .mockResolvedValueOnce({ id: "a1", status: "pending" })
    .mockResolvedValue({
      id: "a1",
      status: "ready",
      feedback1: { hints: ["Check the verb form."] },
    });
  await mountAndSubmit();
  // First poll (immediately) says pending: still loading, no hints.
  expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  expect(screen.queryByText(/Check the verb form/)).not.toBeInTheDocument();
  expect(api.write.getAttempt).toHaveBeenCalledTimes(1);
  // Second poll, 3 s later, says ready.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3050);
  });
  expect(api.write.getAttempt).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Check the verb form/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();
});
it("reports a failed generation instead of loading forever", async () => {
  vi.mocked(api.write.getAttempt).mockResolvedValue({
    id: "a1",
    status: "failed",
    error: "Feedback service is busy",
  });
  await mountAndSubmit();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3050);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Feedback service is busy");
});
