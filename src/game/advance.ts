import { amount, amountAdd, amountDivide, amountFloor, amountMultiply, amountRound, type Amount } from "./amount";
import { updateCampaignProgress } from "./campaign";
import { chooseAutoAction } from "./dungeon/autoExplore";
import { isEnemyActive } from "./dungeon/draft";
import { dirTo, toIndex } from "./dungeon/grid";
import { resolveTurn } from "./dungeon/turn";
import { OVERCLOCK_SPEED_FACTOR } from "./dungeon/worksites";
import { bankIntoHub } from "./economy";
import { getMsPerTurn } from "./hardware";
import { deriveHeroStats } from "./hero";
import { endRun, getRebootDurationMs, startRun } from "./run";
import {
  MAX_ADVANCE_STEP_MS,
  nonNegativeElapsed,
  normalizeAdvanceTimeMs,
  selectPositiveAdvanceStepMs,
} from "./timeGrid";
import type { AdvanceMode, AdvanceReport, AdvanceResult, GameState, HeroStats, RunState } from "./types";
import { getWatchdogDefinition } from "./watchdog";

export { MAX_ADVANCE_STEP_MS, normalizeAdvanceTimeMs, selectPositiveAdvanceStepMs } from "./timeGrid";

export const OFFLINE_MAX_SIMULATED_RUNS = 12;
export const OFFLINE_MAX_TURNS = 500_000;

interface Tally {
  runsCompleted: number;
  turns: number;
  credits: Amount;
  data: Amount;
  /** per completed run: simulated ms including the reboot that followed */
  durations: number[];
}

/** Effective cadence for a run: tier latency, halved while overclocked. */
export const getEffectiveMsPerTurn = (clockHz: number, run: RunState) => {
  const base = getMsPerTurn(clockHz, run.depth);
  return run.overclockTurns > 0 ? normalizeAdvanceTimeMs(base * OVERCLOCK_SPEED_FACTOR) : base;
};

export const getRunMsPerTurn = (state: GameState, run: RunState) =>
  getEffectiveMsPerTurn(deriveHeroStats(state.hub).clockHz, run);

/** A run consumes cadence in auto mode, or in manual mode while a queued path is pending. */
export const isRunTicking = (run: RunState | null): run is RunState =>
  run !== null &&
  run.status === "active" &&
  (run.control === "auto" || (run.pendingPath !== null && run.pendingPath.length > 0));

export const isRebooting = (state: GameState) =>
  state.run === null && state.hub.rebootRemainingBits !== null;

/** Time until the next discrete event (auto turn or reboot completion); Infinity when idle. */
export const getNextEventMs = (state: GameState): number => {
  if (isRunTicking(state.run)) {
    return normalizeAdvanceTimeMs(getRunMsPerTurn(state, state.run) - state.run.turnAccumulatorMs);
  }
  if (isRebooting(state)) {
    const bits = state.hub.rebootRemainingBits ?? 0;
    return normalizeAdvanceTimeMs((bits / deriveHeroStats(state.hub).clockHz) * 1000);
  }
  return Number.POSITIVE_INFINITY;
};

const hasVisibleEnemy = (run: RunState) =>
  run.enemies.some(
    (enemy) => isEnemyActive(enemy) && run.floor.visible[toIndex(enemy.x, enemy.y, run.floor.width)],
  );

/** Resolve one cadence turn: auto-explore, or consume one step of a queued manual path. */
export const stepRunTurn = (run: RunState, stats: HeroStats): RunState => {
  if (run.control === "manual") {
    const path = run.pendingPath ?? [];
    const next = path[0];
    if (!next || hasVisibleEnemy(run)) return { ...run, pendingPath: null };
    const dir = dirTo(run.hero, next);
    if (!dir) return { ...run, pendingPath: null };
    const rest = path.length > 1 ? path.slice(1) : null;
    return resolveTurn({ ...run, pendingPath: rest }, { type: "move", dir }, stats);
  }
  const decision = chooseAutoAction(run, stats);
  return resolveTurn({ ...run, autoPath: decision.autoPath }, decision.action, stats);
};

const tick = (input: GameState, stepMs: number, tally: Tally): GameState => {
  let state = input;
  if (isRunTicking(state.run)) {
    const stats = deriveHeroStats(state.hub);
    let run: RunState = {
      ...state.run,
      turnAccumulatorMs: normalizeAdvanceTimeMs(state.run.turnAccumulatorMs + stepMs),
      elapsedMs: normalizeAdvanceTimeMs(state.run.elapsedMs + stepMs),
    };
    for (;;) {
      const msPerTurn = getEffectiveMsPerTurn(stats.clockHz, run);
      if (run.turnAccumulatorMs < msPerTurn) break;
      run = { ...run, turnAccumulatorMs: normalizeAdvanceTimeMs(run.turnAccumulatorMs - msPerTurn) };
      run = stepRunTurn(run, stats);
      tally.turns += 1;
      if (run.status === "dead") {
        const before = { ...state, run };
        state = endRun(before, run.deathCause ?? "Unknown fault");
        const summary = state.hub.lastRunSummary;
        if (summary) {
          tally.runsCompleted += 1;
          tally.credits = amountAdd(tally.credits, summary.creditsBanked);
          tally.data = amountAdd(tally.data, summary.dataBanked);
          tally.durations.push(summary.elapsedMs + getRebootDurationMs(stats.clockHz));
        }
        return updateCampaignProgress(state);
      }
      // Campaign sweep at the turn boundary keeps completion timing (and the
      // transmission log order) identical for any advance-step split.
      {
        const composed: GameState = { ...state, run };
        const updated = updateCampaignProgress(composed);
        if (updated !== composed) {
          state = updated;
          run = updated.run ?? run;
        }
      }
      if (!isRunTicking(run)) break;
    }
    return { ...state, run };
  }
  if (isRebooting(state)) {
    // Step in the ms domain (on the ns grid) so partial steps sum exactly to the
    // boundary; bits are re-derived from the remaining ms at the current clock.
    const stats = deriveHeroStats(state.hub);
    const remainingMs = getNextEventMs(state);
    if (stepMs >= remainingMs) {
      return startRun({ ...state, hub: { ...state.hub, rebootRemainingBits: null } });
    }
    const leftMs = normalizeAdvanceTimeMs(remainingMs - stepMs);
    const bits = (leftMs * stats.clockHz) / 1000;
    return { ...state, hub: { ...state.hub, rebootRemainingBits: bits } };
  }
  return state;
};

const extrapolate = (state: GameState, tally: Tally, remainingMs: number) => {
  if (tally.runsCompleted === 0 || remainingMs <= 0) {
    return { state, extrapolatedRuns: 0, extrapolatedMs: 0, credits: amount(0), data: amount(0) };
  }
  const count = tally.durations.length;
  const meanDurationMs = tally.durations.reduce((sum, value) => sum + value, 0) / count;
  if (!(meanDurationMs > 0)) {
    return { state, extrapolatedRuns: 0, extrapolatedMs: 0, credits: amount(0), data: amount(0) };
  }
  const extrapolatedRuns = Math.floor(remainingMs / meanDurationMs);
  if (extrapolatedRuns <= 0) {
    return { state, extrapolatedRuns: 0, extrapolatedMs: 0, credits: amount(0), data: amount(0) };
  }
  const credits = amountRound(amountDivide(amountMultiply(tally.credits, extrapolatedRuns), count));
  const data = amountFloor(amountDivide(amountMultiply(tally.data, extrapolatedRuns), count));
  const hub = bankIntoHub(state.hub, credits, data);
  return {
    state: { ...state, hub: { ...hub, stats: { ...hub.stats, runs: hub.stats.runs + extrapolatedRuns } } },
    extrapolatedRuns,
    extrapolatedMs: normalizeAdvanceTimeMs(extrapolatedRuns * meanDurationMs),
    credits,
    data,
  };
};

/**
 * Advance the simulation by `elapsedMs`. Steps to the next event boundary so
 * `advance(100)∘advance(100) ≡ advance(200)`. Offline time is clamped to the
 * watchdog capacity captured at departure; after OFFLINE_MAX_SIMULATED_RUNS
 * complete runs (or OFFLINE_MAX_TURNS turns) the remainder is extrapolated.
 */
export const advanceGame = (input: GameState, elapsedMs: number, mode: AdvanceMode): AdvanceResult => {
  const requestedMs = normalizeAdvanceTimeMs(nonNegativeElapsed(elapsedMs));
  const bufferLevelId = mode === "offline" ? input.watchdog.departureLevelId : input.watchdog.ownedLevelId;
  const buffer = getWatchdogDefinition(bufferLevelId);
  const remainingCapacityMs =
    mode === "offline" ? Math.max(0, buffer.maxOfflineMs - input.watchdog.offlineProcessedMs) : requestedMs;
  const budgetMs = normalizeAdvanceTimeMs(Math.min(requestedMs, remainingCapacityMs));
  const capacityOverflowMs = normalizeAdvanceTimeMs(requestedMs - budgetMs);
  let unsimulatedMs = 0;

  const tally: Tally = { runsCompleted: 0, turns: 0, credits: amount(0), data: amount(0), durations: [] };
  let state = input;
  let remainingMs = budgetMs;
  let extrapolatedRuns = 0;
  let extrapolatedMs = 0;
  let changed = false;

  while (remainingMs > 0) {
    const eventMs = getNextEventMs(state);
    if (!Number.isFinite(eventMs)) {
      // nothing can happen: idle hub without watchdog
      unsimulatedMs = remainingMs;
      break;
    }
    if (
      mode === "offline" &&
      (tally.runsCompleted >= OFFLINE_MAX_SIMULATED_RUNS || tally.turns >= OFFLINE_MAX_TURNS)
    ) {
      const result = extrapolate(state, tally, remainingMs);
      state = result.state;
      extrapolatedRuns = result.extrapolatedRuns;
      extrapolatedMs = result.extrapolatedMs;
      tally.credits = amountAdd(tally.credits, result.credits);
      tally.data = amountAdd(tally.data, result.data);
      if (extrapolatedRuns === 0) unsimulatedMs = remainingMs;
      remainingMs = 0;
      changed = true;
      break;
    }
    const stepMs = selectPositiveAdvanceStepMs(remainingMs, Math.min(eventMs, MAX_ADVANCE_STEP_MS));
    state = tick(state, stepMs, tally);
    remainingMs = normalizeAdvanceTimeMs(remainingMs - stepMs);
    changed = true;
  }

  const simulatedMs = normalizeAdvanceTimeMs(budgetMs - unsimulatedMs);
  const overflowMs = normalizeAdvanceTimeMs(capacityOverflowMs + unsimulatedMs);
  const report: AdvanceReport = {
    mode,
    elapsedMs: requestedMs,
    simulatedMs,
    overflowMs,
    runsCompleted: tally.runsCompleted,
    extrapolatedRuns,
    creditsBanked: tally.credits,
    dataBanked: tally.data,
    bufferLevelId,
    bufferCapacityMs: buffer.maxOfflineMs,
    turnsSimulated: tally.turns,
    extrapolatedMs,
    hadActivity: simulatedMs > 0 && (tally.turns > 0 || tally.runsCompleted > 0 || extrapolatedRuns > 0),
  };
  if (mode === "offline") {
    const offlineRunsAdded = tally.runsCompleted + extrapolatedRuns;
    if (offlineRunsAdded > 0) {
      state = {
        ...state,
        hub: {
          ...state.hub,
          stats: { ...state.hub.stats, offlineRuns: state.hub.stats.offlineRuns + offlineRunsAdded },
        },
      };
    }
    state = updateCampaignProgress(state);
    state = {
      ...state,
      watchdog: {
        ...state.watchdog,
        offlineProcessedMs: normalizeAdvanceTimeMs(state.watchdog.offlineProcessedMs + budgetMs),
      },
      lastAdvanceReport: report,
    };
    return { state, report };
  }
  return { state: changed ? state : input, report };
};
