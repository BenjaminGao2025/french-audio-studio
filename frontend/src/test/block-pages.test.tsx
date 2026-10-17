import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Route as HoursRoute } from "@/routes/hours";

let search: { block?: string } = {};
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => search }),
}));
vi.mock("@/components/fr/kit", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Bar: () => null,
  BlockControls: ({ blockId }: { blockId: string }) => <p>controls for {blockId}</p>,
}));
vi.mock("@/api", () => ({ api: { game: {}, todos: {} } }));
vi.mock("@/api/hooks", () => ({
  useGameState: () => ({ data: undefined }),
  useHoursLedger: () => ({
    isPending: true,
    isError: false,
    error: null,
    data: undefined,
    refetch: () => {},
  }),
  useLogTime: () => ({ mutate: () => {}, isPending: false }),
  useTodos: () => ({
    isPending: true,
    isError: false,
    error: null,
    data: undefined,
    refetch: () => {},
  }),
}));

afterEach(cleanup);

// A plan block can point at /hours (course or textbook time): without Finish/Skip
// controls that block could never be completed.
const pages = [["hours", HoursRoute]] as const;

it.each(pages)("%s shows the block controls only when opened from a plan block", (_name, route) => {
  const Component = route.options.component;
  if (!Component) throw new Error("Missing page");
  const ui = (
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>
  );
  search = { block: "b7" };
  const { unmount } = render(ui);
  expect(screen.getByText("controls for b7")).toBeInTheDocument();
  unmount();
  search = {};
  render(ui);
  expect(screen.queryByText(/controls for/)).not.toBeInTheDocument();
});
