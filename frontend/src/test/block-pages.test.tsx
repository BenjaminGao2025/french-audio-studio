import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { Route as ShadowRoute } from "@/routes/shadow";

let search: { block?: string } = {};
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => search }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/components/fr/kit", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BlockShell: ({
    children,
    blockId,
    lane,
    progress,
  }: {
    children: ReactNode;
    blockId?: string;
    lane?: string;
    progress: number;
  }) => (
    <div>
      <p>controls for {blockId}</p>
      <p>timer on {lane}</p>
      <progress aria-label="Block progress" value={progress} max={1} />
      {children}
    </div>
  ),
}));
vi.mock("@/components/fr/widgets", () => ({ AudioButton: () => null, Recorder: () => null }));
vi.mock("@/api", () => ({
  api: { shadow: { sentences: vi.fn() }, speech: { ttsUrl: () => "", transcribe: vi.fn() } },
}));

beforeEach(() => {
  window.localStorage.setItem("1000h.locale", "en");
  search = {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Thursday's 11:15 block points at /shadow: without Finish/Skip controls and the speaking timer
// that block could never be completed or counted.
function mount() {
  const Component = ShadowRoute.options.component;
  if (!Component) throw new Error("Missing page");
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>,
  );
}
const sentences = [
  { text: "Bonjour tout le monde", ipa: "" },
  { text: "Il fait beau", ipa: "" },
];

it("shadow shows the block controls and the speaking timer only when opened from a plan block", async () => {
  vi.mocked(api.shadow.sentences).mockResolvedValue(sentences);
  search = { block: "b7" };
  const { unmount } = mount();
  expect(await screen.findByText("Bonjour")).toBeInTheDocument();
  expect(screen.getByText("controls for b7")).toBeInTheDocument();
  expect(screen.getByText("timer on speaking")).toBeInTheDocument();
  unmount();
  search = {};
  mount();
  expect(await screen.findByText("Bonjour")).toBeInTheDocument();
  expect(screen.queryByText(/controls for/)).not.toBeInTheDocument();
});

it("shadow can still be finished or skipped when there is nothing to shadow yet", async () => {
  vi.mocked(api.shadow.sentences).mockResolvedValue([]);
  search = { block: "b7" };
  mount();
  expect(await screen.findByText("controls for b7")).toBeInTheDocument();
  expect(screen.queryByText("Bonjour")).not.toBeInTheDocument();
});

it("shadow moves through the sentences, and the block ring stops at full when it wraps", async () => {
  vi.mocked(api.shadow.sentences).mockResolvedValue(sentences);
  search = { block: "b7" };
  mount();
  const ring = () => screen.getByRole("progressbar", { name: "Block progress" });
  await screen.findByText("Bonjour");
  expect(ring()).toHaveAttribute("value", "0");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("beau")).toBeInTheDocument();
  expect(ring()).toHaveAttribute("value", "0.5");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Bonjour")).toBeInTheDocument();
  expect(ring()).toHaveAttribute("value", "1");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("beau")).toBeInTheDocument();
  expect(ring()).toHaveAttribute("value", "1");
});
