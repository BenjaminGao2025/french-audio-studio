import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RubricPanel } from "@/components/fr/widgets";
import type { Rubric } from "@/api/types";

afterEach(cleanup);

const rubric: Rubric = {
  dims: [{ dim: "Grammar", cefr: "A2", evidence: "Passé composé mostly correct" }],
  score_low: 8,
  score_high: 11,
  confidence: "low",
  hard_fail: null,
};

it("labels the score as an AI estimate, with no calibration or tutor-score entry", () => {
  render(<RubricPanel rubric={rubric} />);
  expect(screen.getByText("AI estimate")).toBeInTheDocument();
  expect(screen.getByText("8–11")).toBeInTheDocument();
  expect(screen.queryByText(/calibrated/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
