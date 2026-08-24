import { advanceGame } from "./advance";
import { applyAction } from "./actions";
import { createInitialGameState } from "./initialState";
import type { GameState } from "./types";

const advanceBy = (state: GameState, totalMs: number, stepMs: number) => {
  let next = state;
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    next = advanceGame(next, Math.min(stepMs, totalMs - elapsed), "foreground").state;
  }
  return next;
};

const withWatchdog = (state: GameState): GameState => ({
  ...state,
  hub: { ...state.hub, research: { completed: ["watchdogTimer"] } },
  watchdog: { ...state.watchdog, ownedLevelId: "watchdogTimer", departureLevelId: "watchdogTimer" },
});

describe("advanceGame delta invariance", () => {
  it("advance(200) ≡ advance(100)∘advance(100) ≡ 20×advance(10) during a run", () => {
    const start = applyAction(createInitialGameState(7), { type: "deploy" });
    const total = 6000;
    const whole = advanceBy(start, total, total);
    const halves = advanceBy(start, total, 100);
    const tenths = advanceBy(start, total, 10);
    expect(halves).toEqual(whole);
    expect(tenths).toEqual(whole);
    expect(whole.run?.turn ?? whole.hub.stats.runs).toBeGreaterThan(0);
  });

  it("holds across death, reboot and redeploy with a watchdog", () => {
    const start = applyAction(withWatchdog(createInitialGameState(11)), { type: "deploy" });
    const total = 600_000;
    const whole = advanceBy(start, total, 60_000);
    const fine = advanceBy(start, total, 333);
    const uneven = advanceBy(start, total, 17);
    expect(fine).toEqual(whole);
    expect(uneven).toEqual(whole);
    expect(whole.hub.stats.runs).toBeGreaterThan(0);
    expect(whole.rng).toEqual(fine.rng);
  });

  it("holds through a reboot countdown alone", () => {
    const base = withWatchdog(createInitialGameState(3));
    const start: GameState = { ...base, hub: { ...base.hub, rebootRemainingBits: 16 } };
    const whole = advanceGame(start, 20_000, "foreground").state;
    const pieces = advanceBy(start, 20_000, 250);
    expect(pieces).toEqual(whole);
    expect(whole.run).not.toBeNull();
  });

  it("does not consume time in manual mode without a queued path", () => {
    const deployed = applyAction(createInitialGameState(5), { type: "deploy" });
    const manual = applyAction(deployed, { type: "takeControl" });
    const later = advanceGame(manual, 10_000, "foreground").state;
    expect(later.run?.turn).toBe(manual.run?.turn);
    expect(later.run?.turnAccumulatorMs).toBe(0);
  });

  it("ignores negative or non-finite elapsed time", () => {
    const start = applyAction(createInitialGameState(9), { type: "deploy" });
    expect(advanceGame(start, -50, "foreground").state).toBe(start);
    expect(advanceGame(start, Number.NaN, "foreground").state).toBe(start);
  });
});
