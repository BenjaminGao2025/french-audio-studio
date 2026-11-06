import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { ApiError, shouldRetry } from "@/api/client";
import { errorMessage } from "@/components/fr/kit-utils";
import { Route as JournalRoute } from "@/routes/journal";
import { Route as ReadingRoute } from "@/routes/reading";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  BlockShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Bar: () => null,
  useBlockFlow: () => ({ finish: () => {}, skip: () => {}, pending: false }),
}));
vi.mock("@/components/fr/widgets", () => ({
  AudioButton: () => null,
  Recorder: () => null,
}));
vi.mock("@/api", () => ({
  api: {
    homework: { create: vi.fn(), prepare: vi.fn() },
    reading: { create: vi.fn() },
    analyze: { text: vi.fn() },
  },
}));

beforeEach(() => window.localStorage.setItem("1000h.locale", "en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("does not retry a 4xx but retries a transient failure twice", () => {
  for (const status of [401, 404, 405, 422, 429]) {
    expect(shouldRetry(0, new ApiError(status, "x"))).toBe(false);
  }
  expect(shouldRetry(0, new ApiError(500, "x"))).toBe(true);
  expect(shouldRetry(0, new ApiError(0, "Network error"))).toBe(true);
  expect(shouldRetry(1, new TypeError("boom"))).toBe(true);
  expect(shouldRetry(2, new ApiError(500, "x"))).toBe(false);
});

it("describes a failed action: not available for a missing route, the message otherwise", () => {
  expect(errorMessage(new ApiError(404, "Not Found"))).toBe("Not available on this server yet");
  expect(errorMessage(new ApiError(405, "Method Not Allowed"))).toBe(
    "Not available on this server yet",
  );
  expect(errorMessage(new ApiError(429, "Too many requests"))).toBe("Too many requests");
  expect(errorMessage("weird", "fallback")).toBe("fallback");
});

const mount = (route: typeof JournalRoute) => {
  const Component = route.options.component;
  if (!Component) throw new Error("Missing page");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>,
  );
};

it("Journal explains that its backend is missing instead of doing nothing", async () => {
  vi.mocked(api.homework.create).mockRejectedValue(new ApiError(404, "Not Found"));
  mount(JournalRoute);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "今天去了农贸市场买苹果。" } });
  fireEvent.click(screen.getByRole("button", { name: /Make simple French/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not available on this server yet");
  expect(api.homework.prepare).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Make simple French/ })).toBeEnabled();
});

it("Reading explains that its backend is missing", async () => {
  vi.mocked(api.reading.create).mockRejectedValue(new ApiError(404, "Not Found"));
  mount(ReadingRoute as unknown as typeof JournalRoute);
  fireEvent.click(await screen.findByRole("button", { name: /Generate passage/ }));
  await waitFor(() =>
    expect(screen.getByText("Not available on this server yet")).toBeInTheDocument(),
  );
});
