import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  api: { srs: { queue: vi.fn(), review: vi.fn() }, speech: { ttsUrl: () => null } },
}));

afterEach(cleanup);

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
