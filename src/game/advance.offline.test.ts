import { amountCompare } from "./amount";
import { advanceGame, OFFLINE_MAX_SIMULATED_RUNS } from "./advance";
import { applyAction } from "./actions";
import { createInitialGameState } from "./initialState";
import type { GameState, WatchdogLevelId } from "./types";
import { getWatchdogDefinition } from "./watchdog";

const HOUR = 60 * 60 * 1000;

const withWatchdog = (state: GameState, level: WatchdogLevelId): GameState => ({
  ...state,
  watchdog: { ownedLevelId: level, departureLevelId: level, offlineProcessedMs: 0 },
});

describe("advanceGame offline", () => {
  it("clamps to the departure watchdog capacity and reports overflow", () => {
    for (const level of ["none", "watchdogTimer", "cronRuntime", "systemScheduler"] as const) {
      const start = applyAction(withWatchdog(createInitialGameState(1), level), { type: "deploy" });
      const capacity = getWatchdogDefinition(level).maxOfflineMs;
      const requested = 30 * HOUR;
      const { state, report } = advanceGame(start, requested, "offline");
      expect(report.bufferLevelId).toBe(level);
      expect(report.bufferCapacityMs).toBe(capacity);
      expect(report.simulatedMs).toBeLessThanOrEqual(capacity);
      expect(report.overflowMs).toBeGreaterThanOrEqual(requested - capacity);
      expect(report.simulatedMs + report.overflowMs).toBe(requested);
      expect(state.watchdog.offlineProcessedMs).toBe(Math.min(requested, capacity));
      expect(state.lastAdvanceReport).toEqual(report);
    }
  });

  it("uses the departure level even after the owned level changes, and remembers processed time", () => {
    const base = applyAction(createInitialGameState(2), { type: "deploy" });
    const departed = applyAction(
      { ...base, watchdog: { ...base.watchdog, ownedLevelId: "watchdogTimer" } },
      { type: "recordDeparture", timestampMs: 1_000 },
    );
    expect(departed.watchdog.departureLevelId).toBe("watchdogTimer");
    const first = advanceGame(departed, 1.5 * HOUR, "offline");
    expect(first.report.overflowMs).toBe(0);
    const second = advanceGame(first.state, 1 * HOUR, "offline");
    expect(second.report.simulatedMs).toBe(0.5 * HOUR);
    expect(second.report.overflowMs).toBe(0.5 * HOUR);
  });

  it("a manual run departs as auto so offline time is productive", () => {
    const manual = applyAction(applyAction(createInitialGameState(3), { type: "deploy" }), { type: "takeControl" });
    expect(manual.run?.control).toBe("manual");
    const departed = applyAction(withWatchdog(manual, "watchdogTimer"), { type: "recordDeparture", timestampMs: 5 });
    expect(departed.run?.control).toBe("auto");
    const { report } = advanceGame(departed, 10 * 60 * 1000, "offline");
    expect(report.turnsSimulated).toBeGreaterThan(0);
  });

  it("extrapolates deterministically after OFFLINE_MAX_SIMULATED_RUNS full runs", () => {
    const start = applyAction(withWatchdog(createInitialGameState(4), "systemScheduler"), { type: "deploy" });
    const run = () => advanceGame(start, 24 * HOUR, "offline");
    const a = run();
    const b = run();
    expect(a.report.runsCompleted).toBe(OFFLINE_MAX_SIMULATED_RUNS);
    expect(a.report.extrapolatedRuns).toBeGreaterThan(0);
    expect(a.report.extrapolatedMs).toBeGreaterThan(0);
    expect(amountCompare(a.report.creditsBanked, 0)).toBe(1);
    expect(a.state.hub.stats.runs).toBe(OFFLINE_MAX_SIMULATED_RUNS + a.report.extrapolatedRuns);
    expect(amountCompare(a.state.hub.credits, start.hub.credits)).toBe(1);
    expect(b).toEqual(a);
    // extrapolation covers the remaining budget: nothing left to overflow
    expect(a.report.overflowMs).toBe(0);
    expect(a.report.simulatedMs).toBe(24 * HOUR);
  });

  it("does nothing without a watchdog and no active run", () => {
    const idle = createInitialGameState(5);
    const { state, report } = advanceGame(idle, HOUR, "offline");
    expect(report.simulatedMs).toBe(0);
    expect(report.overflowMs).toBe(HOUR);
    expect(state.hub).toEqual(idle.hub);
  });
});
