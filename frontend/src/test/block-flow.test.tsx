import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BlockShell } from "@/components/fr/kit";
import { nextBlock } from "@/api/hooks";
import { withBlock } from "@/components/fr/kit-utils";
import { api } from "@/api";
vi.mock("@/api", () => ({
  api: {
    today: { get: vi.fn(), finishBlock: vi.fn(), skipBlock: vi.fn() },
    game: { heartbeat: vi.fn() },
  },
}));
const blocks = [
  { id: "b2", position: 2, route: "/journal", status: "active" },
  { id: "b3", position: 3, route: "/cards", status: "planned" },
];
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function mount({
  finishDisabled = false,
  withBlockId = true,
}: { finishDisabled?: boolean; withBlockId?: boolean } = {}) {
  window.localStorage.setItem("1000h.locale", "en");
  vi.mocked(api.today.get).mockResolvedValue({ blocks } as Awaited<
    ReturnType<typeof api.today.get>
  >);
  vi.mocked(api.today.finishBlock).mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.today.finishBlock>>,
  );
  vi.mocked(api.today.skipBlock).mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.today.skipBlock>>,
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["today"], { blocks });
  const root = createRootRoute({ component: Outlet });
  const journal = createRoute({
    getParentRoute: () => root,
    path: "/journal",
    component: () => (
      <BlockShell
        kicker="Journal"
        title="Journal"
        progress={0}
        blockId={withBlockId ? "b2" : undefined}
        lane="speaking"
        finishDisabled={finishDisabled}
      >
        Journal
      </BlockShell>
    ),
  });
  const cards = createRoute({
    getParentRoute: () => root,
    path: "/cards",
    component: () => <p>Next review</p>,
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Home</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([journal, cards, home]),
    history: createMemoryHistory({ initialEntries: ["/journal"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
it("finishes b2 and navigates to the next block with its id", async () => {
  const router = await mount();
  fireEvent.click(await screen.findByRole("button", { name: "Finish block" }));
  await waitFor(() => expect(api.today.finishBlock).toHaveBeenCalledWith("b2"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/cards"));
  expect(new URLSearchParams(router.state.location.searchStr).get("block")).toBe("b3");
});
it("skips b2 with the chosen reason", async () => {
  const router = await mount();
  fireEvent.click(await screen.findByRole("button", { name: "Skip (just logged)" }));
  fireEvent.click(screen.getByRole("button", { name: "Too hard" }));
  await waitFor(() => expect(api.today.skipBlock).toHaveBeenCalledWith("b2", "too_hard"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/cards"));
});
it("selects next planned after active", () => expect(nextBlock(blocks, "b2")?.id).toBe("b3"));
it("returns nothing after the last available block", () =>
  expect(
    nextBlock(
      [blocks[1]].filter((b) => b !== undefined),
      "b3",
    ),
  ).toBeUndefined());
it("selects first available without current id", () => expect(nextBlock(blocks)?.id).toBe("b2"));
it("falls back to an earlier block in position order", () =>
  expect(nextBlock([...blocks].reverse(), "b3")?.id).toBe("b2"));
it("returns the block itself so callers never look it up by route", () => {
  const twin = [...blocks, { id: "b4", position: 4, route: "/cards", status: "planned" }];
  expect(nextBlock(twin, "b3")?.id).toBe("b4");
});
it("keeps parameters and replaces an existing block id", () => {
  const url = new URL(
    withBlock("/cards?modes=speak,listen&new_limit=0&block=old", "b1"),
    "http://localhost",
  );
  expect(url.searchParams.get("modes")).toBe("speak,listen");
  expect(url.searchParams.get("new_limit")).toBe("0");
  expect(url.searchParams.getAll("block")).toEqual(["b1"]);
});

it("does not finish an unsaved journal", async () => {
  await mount({ finishDisabled: true });
  const finish = await screen.findByRole("button", { name: "Finish block" });
  expect(finish).toBeDisabled();
  fireEvent.click(finish);
  expect(api.today.finishBlock).not.toHaveBeenCalled();
});

it("goes home, not into the plan, when the page was opened without a block", async () => {
  const router = await mount({ withBlockId: false });
  fireEvent.click(await screen.findByRole("button", { name: "Finish block" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(api.today.finishBlock).not.toHaveBeenCalled();
});

it("skipping without a block also goes home", async () => {
  const router = await mount({ withBlockId: false });
  fireEvent.click(await screen.findByRole("button", { name: "Skip (just logged)" }));
  fireEvent.click(screen.getByRole("button", { name: "Too hard" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(api.today.skipBlock).not.toHaveBeenCalled();
});
