import { amount } from "./amount";
import { createCampaignState } from "./campaign";
import { createRngState } from "./rng";
import { createWatchdogState } from "./watchdog";
import type { GameState, HubState } from "./types";

export const DEFAULT_SEED = 0x1d1eb17;
export const STARTING_CREDITS = 10;

export const createInitialHubState = (): HubState => ({
  credits: amount(STARTING_CREDITS),
  data: amount(0),
  hardware: { clock: 1, cores: 0, cache: 0, ram: 0, psu: 0, cooling: 0, scheduler: 0 },
  research: { completed: [] },
  stats: {
    runs: 0,
    maxDepth: 0,
    totalKills: 0,
    lifetimeCredits: amount(0),
    deadlocksSurvived: 0,
    bossKills: 0,
    offlineRuns: 0,
  },
  rebootRemainingBits: null,
  lastRunSummary: null,
});

export const createInitialGameState = (seed: number = DEFAULT_SEED): GameState => ({
  version: 1,
  hub: createInitialHubState(),
  run: null,
  rng: createRngState(Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_SEED),
  watchdog: createWatchdogState(),
  time: { lastSavedAtMs: null, departedAtMs: null },
  lastAdvanceReport: null,
  campaign: createCampaignState(),
});
