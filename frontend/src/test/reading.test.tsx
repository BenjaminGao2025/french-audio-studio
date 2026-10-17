import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Route } from "@/routes/reading";
import { api } from "@/api";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  BlockShell: ({ children, progress }: { children: ReactNode; progress: number }) => (
    <div>
      <progress aria-label="Reading progress" value={progress} max={1} />
      {children}
    </div>
  ),
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useBlockFlow: () => ({ finish: vi.fn() }),
}));
vi.mock("@/api", () => ({ api: { reading: { create: vi.fn(), get: vi.fn(), done: vi.fn() } } }));
beforeEach(() => {
  const sentence = (text: string) => ({
    text,
    translation_en: "",
    translation_zh: "",
    build_up: [],
    words: [],
    grammar_points: [],
  });
  const passage = {
    id: "p1",
    title: "Passage",
    level: "A2",
    text_type: "notice",
    source: "mock",
    license: "test",
    text: "First. Last.",
    analysis: { sentences: [sentence("First sentence"), sentence("Last sentence")] },
    questions: [1, 2, 3].map((i) => ({
      kind: "comprehension",
      q: `Question ${i}`,
      a: `Answer ${i}`,
      evidence: "",
    })),
  };
  vi.mocked(api.reading.create).mockResolvedValue(passage);
  vi.mocked(api.reading.get).mockResolvedValue(passage);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function mount() {
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing reading page");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Component />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate · notice · A2" }));
  await screen.findByRole("button", { name: /Question 1/ });
}
it("keeps earlier answers visible when another question opens", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: /Question 1/ }));
  fireEvent.click(screen.getByRole("button", { name: /Question 2/ }));
  expect(screen.getByText("Answer 1")).toBeInTheDocument();
  expect(screen.getByText("Answer 2")).toBeInTheDocument();
  expect(screen.queryByText("Answer 3")).not.toBeInTheDocument();
});
it("opens all answers and reaches full progress at the last sentence", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Show all answers" }));
  for (const i of [1, 2, 3]) expect(screen.getByText(`Answer ${i}`)).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Reading progress" })).toHaveAttribute(
    "value",
    "0.8",
  );
  fireEvent.click(screen.getByRole("button", { name: "Last sentence" }));
  expect(screen.getByRole("progressbar", { name: "Reading progress" })).toHaveAttribute(
    "value",
    "1",
  );
});
