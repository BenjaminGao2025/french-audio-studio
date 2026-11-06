import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
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
    write: { tasks: vi.fn(), attempt: vi.fn(), round2: vi.fn(), rubric: vi.fn() },
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.write.attempt).mockResolvedValue({
    id: "a1",
    status: "ready",
    feedback1: { hints: ["Revise verb"] },
  });
  vi.mocked(api.write.round2).mockResolvedValue({
    id: "a1",
    status: "ready",
    feedback2: { corrected_text: "Corrected French", sentences: [], structures: [] },
  } as Awaited<ReturnType<typeof api.write.round2>>);
  vi.mocked(api.write.rubric).mockResolvedValue({} as Awaited<ReturnType<typeof api.write.rubric>>);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function mount(strict = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  qc.setQueryData(["write-tasks"], {
    tasks: [
      {
        task: "T1",
        minutes: 2,
        word_range: [60, 120],
        subjects: [{ id: "w1", prompt: "Write an email" }],
      },
    ],
  });
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing writing page");
  const page = (
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await act(() => Promise.resolve());
}
it("starts at minutes times sixty", async () => {
  await mount();
  expect(screen.getByText("02:00")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText("01:59")).toBeInTheDocument();
});
it.each([false, true])("auto-submits exactly once at zero (StrictMode=%s)", async (strict) => {
  await mount(strict);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bonjour" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000);
  });
  expect(api.write.attempt).toHaveBeenCalledTimes(1);
  expect(api.write.attempt).toHaveBeenCalledWith(
    expect.objectContaining({ task: "T1", text: "Bonjour", seconds: 120 }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(api.write.attempt).toHaveBeenCalledTimes(1);
});
it("only loads round-two corrections after revision is requested", async () => {
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bonjour" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.queryByText("Corrected French")).not.toBeInTheDocument();
  expect(api.write.round2).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "I've revised — show round 2" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(api.write.round2).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Corrected French")).toBeInTheDocument();
});
