import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { advanceGame } from "./advance";
import { createInitialGameState } from "./initialState";
import { advanceBy, buildState, withCredits } from "./testHelpers";

describe("advanceGame delta invariance", () => {
  it("advance(200) ≡ 2×advance(100) ≡ 20×advance(10) from boot", () => {
    const start = createInitialGameState(7);
    const total = 30_000;
    const whole = advanceBy(start, total, total);
    const halves = advanceBy(start, total, 100);
    const tenths = advanceBy(start, total, 10);
    expect(halves).toEqual(whole);
    expect(tenths).toEqual(whole);
    expect(whole.run.backlog.length).toBeGreaterThan(0); // arrivals happened
    expect(whole.rng).toEqual(tenths.rng);
  });

  it("holds on a powered board with automation, packets and rng draws", () => {
    // Rail + a second core + a cache: arrivals, emissions, moves, heat, and
    // brownout coins all in play.
    let start = buildState({
      seed: 42,
      railLevel: 1,
      credits: 500,
      chips: [
        { x: 1, y: 5, kind: "core" },
        { x: 2, y: 4, kind: "cache" },
      ],
      dirs: [{ x: 1, y: 5, dir: "E" }],
    });
    start = applyAction(start, { type: "buySystem", item: "clock" });
    const total = 120_000;
    const whole = advanceBy(start, total, total);
    const uneven = advanceBy(start, total, 333);
    const fine = advanceBy(start, total, 17);
    expect(uneven).toEqual(whole);
    expect(fine).toEqual(whole);
    expect(whole.run.tasksDone).toBeGreaterThan(0);
    expect(whole.rng.draws).toEqual(fine.rng.draws);
  });

  it("holds across a crash (integrity reaches 0 at the same tick)", () => {
    // Dead board with no generation: backlog floods and drops grind integrity
    // down; escalated uptime accelerates arrivals.
    const start = buildState({ seed: 9, integrity: 6, uptimeMs: 30 * 60_000 });
    start.meta.totalTasks = 1;
    const total = 10 * 60_000;
    const whole = advanceBy(start, total, 60_000);
    const pieces = advanceBy(start, total, 777);
    expect(pieces).toEqual(whole);
    expect(whole.run.integrity).toBe(0);
  });

  it("holds through crash then reflow (meta persists identically)", () => {
    const start = buildState({ seed: 5, integrity: 4, uptimeMs: 40 * 60_000 });
    start.meta.totalTasks = 1;
    const crashDrive = (stepMs: number) => {
      const crashed = advanceBy(start, 8 * 60_000, stepMs);
      expect(crashed.run.integrity).toBe(0);
      return applyAction(crashed, { type: "reflow" });
    };
    const whole = crashDrive(8 * 60_000);
    const pieces = crashDrive(490);
    expect(pieces).toEqual(whole);
    expect(whole.meta.reflows).toBe(1);
    expect(whole.meta.silicon).toBeGreaterThan(0);
    expect(whole.run.uptimeMs).toBe(0); // fresh run
  });

  it("does not advance a crashed run", () => {
    const crashed = buildState({ seed: 3, integrity: 0 });
    const result = advanceGame(crashed, 10_000, "foreground");
    expect(result.state).toBe(crashed);
    expect(result.report.hadActivity).toBe(false);
  });

  it("ignores negative or non-finite elapsed time", () => {
    const start = withCredits(createInitialGameState(9), 100);
    expect(advanceGame(start, -50, "foreground").state).toBe(start);
    expect(advanceGame(start, Number.NaN, "foreground").state).toBe(start);
  });
});
