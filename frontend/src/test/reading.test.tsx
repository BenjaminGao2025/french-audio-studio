import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Passage } from "@/api";
import { Route } from "@/routes/reading";
import { api } from "@/api";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({ options, useSearch: () => ({}) }),
}));
vi.mock("@/components/fr/kit", () => ({
  BlockShell: ({ children, finishDisabled }: { children: ReactNode; finishDisabled: boolean }) => (
    <div>
      <button disabled={finishDisabled}>Finish block</button>
      {children}
    </div>
  ),
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/api", () => ({
  api: {
    reading: { create: vi.fn(), get: vi.fn(), done: vi.fn(), addWord: vi.fn() },
    speech: { ttsUrl: (text: string) => `/tts?text=${encodeURIComponent(text)}` },
    analyze: { lookup: vi.fn() },
  },
}));
const passage: Passage = {
  id: "p1",
  title: "Library",
  level: "A2",
  text_type: "notice",
  source: "fixture",
  license: "generated",
  text: "La bibliothèque ouvre mardi.",
  analysis: {
    sentences: [
      {
        text: "La bibliothèque ouvre mardi.",
        translation_en: "The library opens Tuesday.",
        translation_zh: "",
        build_up: ["La bibliothèque", "La bibliothèque ouvre mardi."],
        words: [
          {
            word: "bibliothèque",
            ipa: "",
            lemma: "bibliothèque",
            pos: "noun",
            en: "library",
            zh: "",
            why: "",
          },
        ],
        grammar_points: [],
      },
    ],
  },
  questions: [1, 2].map((i) => ({
    kind: "detail",
    q: `Question ${i}`,
    options: [`Tuesday ${i}`, `Monday ${i}`, `Friday ${i}`, `Sunday ${i}`],
  })),
};
beforeEach(() => {
  vi.mocked(api.reading.create).mockResolvedValue(passage);
  vi.mocked(api.reading.addWord).mockResolvedValue({});
  vi.mocked(api.reading.done).mockResolvedValue({
    ...passage,
    result: { correct: 2, answers: [0, 0], seconds: 10 },
    questions: passage.questions.map((q) => ({
      ...q,
      answer_index: 0,
      explanation: "Tuesday is stated; other days are unsupported.",
      evidence: passage.text,
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  const Component = Route.options.component!;
  render(<Component />);
}
async function create() {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Generate passage" }));
  await screen.findByText("Question 1");
}
it("requests the selected A1–A2 text type", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Text type"), { target: { value: "email" } });
  fireEvent.change(screen.getByLabelText("Level"), { target: { value: "A1" } });
  fireEvent.click(screen.getByText("Generate passage"));
  await screen.findByText("Question 1");
  expect(api.reading.create).toHaveBeenCalledWith({
    generate: { text_type: "email", level: "A1" },
  });
});
it("requires all MCQ answers and shows cited explanations after submitting", async () => {
  await create();
  expect(screen.getByText("Submit answers & mark read")).toBeDisabled();
  expect(screen.getByText("Finish block")).toBeDisabled();
  fireEvent.click(screen.getByText("Tuesday 1"));
  fireEvent.click(screen.getByText("Tuesday 2"));
  fireEvent.click(screen.getByText("Submit answers & mark read"));
  await screen.findByText("2 / 2 correct · attempt saved");
  expect(api.reading.done).toHaveBeenCalledWith("p1", expect.any(Number), [0, 0]);
  expect(screen.getAllByText(/other days are unsupported/)).toHaveLength(2);
  expect(screen.getByText("Finish block")).toBeEnabled();
});
it("saves selected vocabulary as a cloze through the module API", async () => {
  await create();
  fireEvent.click(screen.getByRole("button", { name: /bibliothèque · library/ }));
  await waitFor(() =>
    expect(api.reading.addWord).toHaveBeenCalledWith("p1", passage.text, "bibliothèque", "library"),
  );
});
it("plays and explains a word tapped in the breakdown, without touching the vocabulary list", async () => {
  const played: string[] = [];
  vi.stubGlobal(
    "Audio",
    class {
      src: string;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
      pause() {}
    },
  );
  await create();
  fireEvent.click(screen.getAllByRole("button", { name: "bibliothèque" })[0]!);
  expect(played).toEqual(["/tts?text=biblioth%C3%A8que"]);
  expect(screen.getByRole("dialog", { name: "Meaning of bibliothèque" })).toHaveTextContent(
    "library",
  );
  expect(api.reading.addWord).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("shows generation errors and allows retry", async () => {
  vi.mocked(api.reading.create).mockRejectedValueOnce(new Error("Gateway unavailable"));
  mount();
  fireEvent.click(screen.getByText("Generate passage"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Gateway unavailable");
  fireEvent.click(screen.getByText("Generate passage"));
  await screen.findByText("Question 1");
});
it("shows submission errors without finishing the block", async () => {
  await create();
  vi.mocked(api.reading.done).mockRejectedValueOnce(new Error("Try again"));
  fireEvent.click(screen.getByText("Tuesday 1"));
  fireEvent.click(screen.getByText("Tuesday 2"));
  fireEvent.click(screen.getByText("Submit answers & mark read"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(screen.getByText("Finish block")).toBeDisabled();
});
