import { afterEach, expect, it, vi } from "vitest";
import { mock } from "@/api/mock";
afterEach(() => vi.useRealTimers());
it("resolves every promise-returning adapter function with representative arguments", async () => {
  vi.useFakeTimers();
  const phase = {
    id: "A",
    name: "A",
    week_target_min: 960,
    lane_targets: {},
    new_cards_per_day: 5,
    gates: {},
  };
  const args: Record<string, unknown[]> = {
    "auth.login": ["test@example.com", "unused"],
    "game.heartbeat": ["listening", 0],
    "game.log": ["listening", 0, "test"],
    "srs.review": ["missing", 3],
    "srs.practice": [[]],
    "srs.lookupNotes": [["bonjour"]],
    "homework.create": ["test"],
    "homework.uploadRecording": ["j1", "first"],
    "homework.finish": ["j1", "test", false],
    "analyze.lookup": ["bonjour"],
    "write.subject": ["T1"],
    "write.getAttempt": ["a1"],
    "write.round2": ["a1"],
    "speak.getAttempt": ["a1"],
    "speak.round2": ["a1"],
    "episodes.create": [{ minutes: 1 }],
    "today.startBlock": ["b2"],
    "today.finishBlock": ["b2"],
    "today.skipBlock": ["b2", "too_hard"],
    "today.minimal": [false],
    "reviews.add": [{ day: "2026-10-17", hard: "", solved: "", unsolved: "", tomorrow: "" }],
    "items.list": [{}],
    "checkpoints.decide": ["cp8", "continue", "test"],
    "phase.put": [phase],
  };
  let promises = 0;
  for (const [group, methods] of Object.entries(mock)) {
    for (const [name, method] of Object.entries(methods)) {
      if (typeof method !== "function") continue;
      const value: unknown = method(...(args[`${group}.${name}`] ?? ["test"]));
      if (value instanceof Promise) {
        promises += 1;
        const checked = expect(value).resolves.not.toBeInstanceOf(Error);
        await vi.runAllTimersAsync();
        await checked;
      }
    }
  }
  expect(promises).toBeGreaterThan(65);
});
it("returns ordered, unique plan blocks", async () => {
  await mock.today.minimal(false);
  const { blocks } = await mock.today.get();
  expect(blocks.map((b) => b.position)).toEqual(
    [...blocks.map((b) => b.position)].sort((a, b) => a - b),
  );
  expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
});
it("stores explicit minimal mode state", async () => {
  expect((await mock.today.minimal(true)).minimal).toBe(true);
  expect((await mock.today.get()).minimal).toBe(true);
  expect((await mock.today.minimal(false)).minimal).toBe(false);
});
it("has a week-8 report but no week-16 report", async () => {
  const rows = await mock.checkpoints.list();
  expect(rows.find((r) => r.kind === "week_8")?.report).toBeDefined();
  expect(rows.find((r) => r.kind === "week_16")?.report).toBeUndefined();
});
it("removes a reviewed card from the next queue", async () => {
  const card = (await mock.srs.queue()).cards[0];
  expect(card).toBeDefined();
  if (!card) throw new Error("Missing review fixture");
  await mock.srs.review(card.id, 3);
  expect((await mock.srs.queue()).cards.some((c) => c.id === card.id)).toBe(false);
});
it.each([
  ["T1", 120],
  ["T2", 210],
  ["T3", 270],
])("uses exam interaction duration for %s", async (task, seconds) => {
  expect(
    ((await mock.speak.tasks()).tasks as Record<string, unknown>[]).find(
      (t) => (t as { task: string }).task === task,
    )?.["seconds"],
  ).toBe(seconds);
});
it("gives T2 two minutes preparation", async () => {
  expect(
    ((await mock.speak.tasks()).tasks as Record<string, unknown>[]).find(
      (t) => (t as { task: string }).task === "T2",
    )?.["prep_seconds"],
  ).toBe(120);
});
it("has no tutor or human-score adapter and no tutor to-do", async () => {
  expect(Object.keys(mock)).not.toContain("tutor");
  expect(Object.keys(mock)).not.toContain("humanScores");
  const { todos } = await mock.today.get();
  expect(todos.some((t) => /tutor/i.test(t.text))).toBe(false);
});
it("has no course lane, block or hours anywhere in the mock data", async () => {
  const state = await mock.game.state();
  const ledger = await mock.hours.ledger();
  const phase = await mock.phase.get();
  const { blocks } = await mock.today.get();
  expect(JSON.stringify([state, ledger, phase, blocks])).not.toMatch(/course|textbook/i);
  expect(ledger.lanes.map((l) => l.lane)).toEqual([
    "listening",
    "reading",
    "speaking",
    "writing",
    "review",
    "car",
  ]);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  expect(sum(phase.lane_targets)).toBe(phase.week_target_min);
  expect(sum(state.week.lane_targets)).toBe(state.week.target);
  expect(ledger.lanes.reduce((a, l) => a + l.active, 0)).toBeCloseTo(ledger.active_hours);
  expect(ledger.lanes.reduce((a, l) => a + l.manual, 0)).toBeCloseTo(ledger.manual_hours);
});
it("pins the mock to the 16 h plan: 960 min split 210/240/300/120/90, no target for the car lane", async () => {
  const split = { listening: 210, reading: 240, speaking: 300, writing: 120, review: 90, car: 0 };
  const state = await mock.game.state();
  const phase = await mock.phase.get();
  const ledger = await mock.hours.ledger();
  const today = await mock.today.get();
  expect(phase.week_target_min).toBe(960);
  expect(today.phase.week_target_min).toBe(960);
  expect(state.week.target).toBe(960);
  expect(phase.lane_targets).toEqual(split);
  expect(state.week.lane_targets).toEqual(split);
  expect(Object.fromEntries(ledger.lanes.map((l) => [l.lane, l.week_target * 60]))).toEqual(split);
  // A weekday's study blocks add up to 160 min; the 5-minute wrap-up is not study time.
  const study = today.blocks.filter((b) => b.kind !== "minimal");
  expect(study.reduce((sum, b) => sum + b.planned_min, 0)).toBe(160);
});
