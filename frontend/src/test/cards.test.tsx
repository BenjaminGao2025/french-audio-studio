import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { api } from "@/api";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/cards";
import { normalizeCard, type RawSrsCard } from "@/api/normalize";
import { srsQueue } from "./fixtures/backend";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  BlockControls: () => null,
}));
vi.mock("@/components/fr/widgets", () => ({ AudioButton: () => null, BlockTimer: () => null }));
vi.mock("@/api", () => ({
  getToken: () => "token",
  api: {
    srs: {
      queue: vi.fn(),
      review: vi.fn(),
      archive: vi.fn(async () => ({})),
      mastered: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({ new_limit: 7, default_new_limit: 10 })),
      putSettings: vi.fn(async (n: number) => ({ new_limit: n })),
    },
    speech: { ttsUrl: () => null },
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderCards(cards: ReturnType<typeof normalizeCard>[]) {
  const qc = new QueryClient();
  qc.setQueryData(["srs-queue", ""], {
    cards,
    counts: { learning: 0, review: 0, new: cards.length, total: cards.length },
  });
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing cards page");
  render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}
const clozeCard = () =>
  normalizeCard(srsQueue.cards.find((c) => c.mode === "cloze") as unknown as RawSrsCard);

// A backend cloze card (note.sentence + target) must render as a blank, and flipping must
// reveal the answer: the page used to read card.sentence, which the backend does not send.
it("renders a real cloze card with a blank and reveals the answer on flip", () => {
  const raw = srsQueue.cards.find((c) => c.mode === "cloze") as unknown as RawSrsCard;
  const card = normalizeCard(raw);
  const qc = new QueryClient();
  qc.setQueryData(["srs-queue", ""], {
    cards: [card],
    counts: { learning: 0, review: 0, new: 1, total: 1 },
  });
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing cards page");
  render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/Nous ______ à Vancouver/)).toBeInTheDocument();
  expect(screen.queryByText("habitons")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Show answer/ }));
  expect(screen.getByText("habitons")).toBeInTheDocument();
  expect(screen.getByText("We have lived in Vancouver for two years.")).toBeInTheDocument();
});

it("marks the card mastered and offers a 6 second undo that restores it", async () => {
  const card = clozeCard();
  renderCards([card]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByRole("button", { name: "✓ 已掌握" }));
  await waitFor(() => expect(api.srs.archive).toHaveBeenCalledWith(card.id, true));
  const undo = await screen.findByRole("button", { name: "撤销" });
  fireEvent.click(undo);
  await waitFor(() => expect(api.srs.archive).toHaveBeenLastCalledWith(card.id, false));
  expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
});

it("hides the undo toast after 6 seconds", async () => {
  renderCards([clozeCard()]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByRole("button", { name: "✓ 已掌握" }));
  await screen.findByRole("button", { name: "撤销" });
  act(() => {
    vi.advanceTimersByTime(6100);
  });
  expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
});

it("lists mastered cards and restores one", async () => {
  const card = { ...clozeCard(), archived: true };
  vi.mocked(api.srs.mastered).mockResolvedValue([card]);
  renderCards([]);
  fireEvent.click(screen.getByRole("button", { name: /已掌握的卡片/ }));
  const restore = await screen.findByRole("button", { name: "恢复" });
  fireEvent.click(restore);
  await waitFor(() => expect(api.srs.archive).toHaveBeenCalledWith(card.id, false));
});

it("saves any New/day number from 0 to 200, clamped, to the server", async () => {
  renderCards([clozeCard()]);
  const input = await screen.findByLabelText("每天新卡");
  await waitFor(() => expect(input).toHaveValue(7));
  fireEvent.change(input, { target: { value: "35" } });
  fireEvent.blur(input);
  await waitFor(() => expect(api.srs.putSettings).toHaveBeenCalledWith(35));
  expect(window.localStorage.getItem("frenchStudio.srs.newLimit")).toBe("35");
  fireEvent.change(input, { target: { value: "999" } });
  fireEvent.blur(input);
  await waitFor(() => expect(api.srs.putSettings).toHaveBeenLastCalledWith(200));
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.blur(input);
  await waitFor(() => expect(api.srs.putSettings).toHaveBeenLastCalledWith(0));
});
