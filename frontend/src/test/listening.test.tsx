import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ListeningSession } from "@/api";
import type { ReactNode } from "react";
import { Route } from "@/routes/listening";
import { api } from "@/api";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  BlockShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Bar: () => null,
}));
vi.mock("@/api", () => ({
  api: {
    listening: {
      createSession: vi.fn(),
      gate: vi.fn(),
      blind: vi.fn(),
      reveal: vi.fn(),
      relisten: vi.fn(),
      check: vi.fn(),
      addWord: vi.fn(),
    },
    speech: { ttsUrl: () => "/test.mp3" },
  },
}));
const audioPlay = vi.fn();
beforeEach(() => {
  audioPlay.mockResolvedValue(undefined);
  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      onerror = null;
      play = audioPlay;
      pause = vi.fn();
    },
  );
  const session: ListeningSession = {
    id: "ls1",
    index: 1,
    total: 1,
    rate_stage: "normal",
    audio_url_normal: "/normal.mp3",
    audio_url_slow: "/slow.mp3",
    material: {
      text: "Bonjour",
      words: [{ w: "Bonjour", ipa: "", en: "hello" }],
      question: { prompt: "Question", options: ["A"], answer_index: 0, evidence: "" },
    },
  };
  vi.mocked(api.listening.createSession).mockResolvedValue(session);
  vi.mocked(api.listening.blind).mockResolvedValue(session);
  vi.mocked(api.listening.reveal).mockResolvedValue(session);
  vi.mocked(api.listening.relisten).mockResolvedValue(session);
  vi.mocked(api.listening.check).mockResolvedValue({ ...session, result: { correct: true } });
  vi.mocked(api.listening.addWord).mockResolvedValue({});
  vi.mocked(api.listening.gate).mockResolvedValue({
    hours: { value: 0, target: 200 },
    understood_pct: { value: 0, target: 80 },
    unseen_quiz_pct: { value: 0, target: 60 },
    unlocked: false,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount() {
  const Component = Route.options.component;
  if (!Component) throw new Error("Missing listening page");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Component />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Blind listen" });
}
it("unlocks self-rating only after successful audio playback", async () => {
  await mount();
  expect(screen.getByRole("button", { name: "Understood" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Understood" })).toBeEnabled());
  expect(audioPlay).toHaveBeenCalledTimes(1);
});
it("keeps self-rating locked after failed playback", async () => {
  audioPlay.mockRejectedValue(new Error("unavailable"));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Understood" })).toBeDisabled();
});
it("five blind plays never complete relistens, which unlock sequentially", async () => {
  await mount();
  for (let i = 0; i < 5; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
    await waitFor(() => expect(audioPlay).toHaveBeenCalledTimes(i + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Understood" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  }
  expect(api.listening.relisten).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Understood" }));
  await waitFor(() => expect(api.listening.blind).toHaveBeenCalledWith("ls1", 2, 5));
  fireEvent.click(await screen.findByRole("button", { name: "Relisten →" }));
  expect(screen.getByRole("button", { name: "Normal ×1" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Normal ×2" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Slow ×1" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Normal ×1" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Normal ×2" })).toBeDisabled();
  expect(api.listening.relisten).toHaveBeenCalledWith("ls1", "slow20", 0);
});

it("plays and explains a word tapped in the revealed text", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Understood" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Understood" }));
  await screen.findByRole("button", { name: "Relisten →" });
  audioPlay.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Bonjour" }));
  expect(audioPlay).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog", { name: "Meaning of Bonjour" })).toHaveTextContent("hello");
  expect(api.listening.addWord).not.toHaveBeenCalled();
});
it("keeps reveal locked and reports a failed blind submission", async () => {
  vi.mocked(api.listening.blind).mockRejectedValueOnce(new Error("Save failed"));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  await waitFor(() => expect(screen.getByText("Understood")).toBeEnabled());
  fireEvent.click(screen.getByText("Understood"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(screen.queryByText("Relisten →")).not.toBeInTheDocument();
});
it("shows empty material guidance", async () => {
  vi.mocked(api.listening.createSession).mockRejectedValueOnce(
    new Error("No learned material yet"),
  );
  const Component = Route.options.component!;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Component />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("No learned material yet")).toBeInTheDocument();
});
it("finishes all replays before submitting the comprehension check", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Blind listen" }));
  await waitFor(() => expect(screen.getByText("Understood")).toBeEnabled());
  fireEvent.click(screen.getByText("Understood"));
  fireEvent.click(await screen.findByText("Relisten →"));
  for (const label of ["Slow ×1", "Normal ×1", "Normal ×2"]) {
    await waitFor(() => expect(screen.getByRole("button", { name: label })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: label }));
  }
  await waitFor(() => expect(screen.getByText("Check understanding →")).toBeEnabled());
  fireEvent.click(screen.getByText("Check understanding →"));
  fireEvent.click(screen.getByText("A"));
  expect(await screen.findByText("Correct.")).toBeInTheDocument();
  expect(api.listening.check).toHaveBeenCalledWith("ls1", 0, expect.any(Number));
});
