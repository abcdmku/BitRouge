import { amount } from "./amount";
import { bankIntoHub, computeBankedData } from "./economy";
import { enterFloor } from "./dungeon/turn";
import { createHeroState, deriveHeroStats } from "./hero";
import { hasResearch } from "./research";
import { createRngState, nextRngUint32 } from "./rng";
import type { FloorState, GameState, HubState, RunState, RunSummary } from "./types";
import { hasWatchdog } from "./watchdog";

/** Reboot countdown length; drains at clockHz bits per second. */
export const REBOOT_BITS = 16;

export const getRebootDurationMs = (clockHz: number) => (REBOOT_BITS / clockHz) * 1000;

export const getStartDepth = (hub: HubState) =>
  hasResearch(hub, "deepScan") ? Math.max(1, Math.floor(hub.stats.maxDepth / 2)) : 1;

const emptyFloor = (): FloorState => ({
  width: 1,
  height: 1,
  tiles: [0],
  explored: [false],
  visible: [false],
  stairs: { x: 0, y: 0 },
  hazards: [],
});

/** Fork a run seed from the hub rng and enter the starting floor. No-op while a run is active. */
export const startRun = (state: GameState): GameState => {
  if (state.run) return state;
  const stats = deriveHeroStats(state.hub);
  const drawn = nextRngUint32(state.rng);
  const seed = drawn.value;
  const run: RunState = {
    seed,
    rng: createRngState(seed),
    depth: 0,
    maxDepthReached: 0,
    turn: 0,
    status: "active",
    deathCause: null,
    control: "auto",
    turnAccumulatorMs: 0,
    elapsedMs: 0,
    credits: amount(0),
    salvageData: 0,
    kills: 0,
    hero: createHeroState(stats, 0, 0),
    floor: emptyFloor(),
    enemies: [],
    items: [],
    events: [],
    nextEventSeq: 1,
    nextEntityId: 1,
    pendingPath: null,
    autoPath: null,
  };
  enterFloor(run, stats, getStartDepth(state.hub));
  return {
    ...state,
    rng: drawn.state,
    run,
    hub: { ...state.hub, rebootRemainingBits: null },
  };
};

export const createRunSummary = (hub: HubState, run: RunState, cause: string, aborted: boolean): RunSummary => {
  const newDepths = Math.max(0, run.maxDepthReached - hub.stats.maxDepth);
  return {
    seed: run.seed,
    depth: run.depth,
    maxDepthReached: run.maxDepthReached,
    turns: run.turn,
    kills: run.kills,
    creditsBanked: run.credits,
    dataBanked: computeBankedData(run.credits, run.salvageData, newDepths),
    cause,
    elapsedMs: run.elapsedMs,
    newMaxDepth: newDepths > 0,
    aborted,
  };
};

/** Bank the run into the hub, record stats, and arm the watchdog reboot when owned. */
export const endRun = (state: GameState, cause: string, aborted = false): GameState => {
  const run = state.run;
  if (!run) return state;
  const summary = createRunSummary(state.hub, run, cause, aborted);
  const banked = bankIntoHub(state.hub, summary.creditsBanked, summary.dataBanked);
  const hub: HubState = {
    ...banked,
    stats: {
      ...banked.stats,
      runs: banked.stats.runs + 1,
      maxDepth: Math.max(banked.stats.maxDepth, run.maxDepthReached),
      totalKills: banked.stats.totalKills + run.kills,
    },
    rebootRemainingBits: !aborted && hasWatchdog(state) ? REBOOT_BITS : null,
    lastRunSummary: summary,
  };
  return { ...state, hub, run: null };
};
