import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { localDay } from "@/lib/format";
import { Route } from "@/routes/wrapup";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/components/fr/kit", () => ({
  Ring: () => null,
  useBlockFlow: () => ({ finish: () => {}, skip: () => {}, pending: false }),
}));
vi.mock("@/api", () => ({ api: { reviews: { add: vi.fn() } } }));
vi.mock("@/api/hooks", () => ({
  useToday: () => ({
    isPending: false,
    isError: false,
    error: null,
    refetch: () => {},
    data: { day: "2026-10-16", blocks: [] },
  }),
  useMe: () => ({ data: { email: "benjamin@example.com" } }),
}));

beforeEach(() => vi.mocked(api.reviews.add).mockResolvedValue(undefined));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("files the review under the plan's study day, not the UTC date", async () => {
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing page");
  render(<Component />);
  fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Liaison" } });
  fireEvent.click(screen.getByRole("button", { name: "Save review" }));
  await waitFor(() => expect(api.reviews.add).toHaveBeenCalled());
  expect(api.reviews.add).toHaveBeenCalledWith(
    expect.objectContaining({ day: "2026-10-16", hard: "Liaison" }),
  );
});

it("localDay uses the local calendar date whatever the UTC date is", () => {
  expect(localDay(new Date(2026, 9, 17, 23, 59))).toBe("2026-10-17");
  expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
});
