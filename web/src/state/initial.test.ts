import { expect, it } from "vitest";
import { get } from "./store";

it("starts the live app without a sample library, review queue, history or learning totals", () => {
  const state = get();
  expect(state.queue).toEqual([]);
  expect(state.cards).toEqual([]);
  expect(state.sentences).toEqual([]);
  expect(state.lookups).toEqual({});
  expect(state.history).toEqual({ analyses: [], audio: [], attempts: [] });
  expect(state.audioStats.lifetimeHours).toBe(0);
  expect(state.review.sessionCards).toBeNull();
});
