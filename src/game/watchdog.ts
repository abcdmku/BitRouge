import { amount, type Amount } from "./amount";
import { getResearchDefinition, hasResearch } from "./research";
import {
  WATCHDOG_LEVEL_IDS,
  type GameState,
  type ResearchId,
  type WatchdogLevelId,
  type WatchdogState,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;

export interface WatchdogLevelDefinition {
  id: WatchdogLevelId;
  level: number;
  name: string;
  maxOfflineMs: number;
  requiredResearchId: ResearchId | null;
  costCredits: Amount;
  costData: Amount;
  capability: string;
}

const level = (
  id: WatchdogLevelId,
  index: number,
  name: string,
  hours: number,
  requiredResearchId: ResearchId | null,
  costCredits: number,
  costData: number,
  capability: string,
): WatchdogLevelDefinition => ({
  id,
  level: index,
  name,
  maxOfflineMs: hours * HOUR_MS,
  requiredResearchId,
  costCredits: amount(costCredits),
  costData: amount(costData),
  capability,
});

/** Level names mirror IdleBit's Automation Buffer tiers. */
export const watchdogLevelDefinitions: readonly WatchdogLevelDefinition[] = [
  level("none", 0, "Starting Node", 0, null, 0, 0, "Death ends the session. Closing freezes the simulation."),
  level("watchdogTimer", 1, "Local Scheduler", 2, "watchdogTimer", 50, 0, "Auto-redeploy after death. Runs keep going for up to 2 hours after you close the game."),
  level("cronRuntime", 2, "CRON Runtime", 8, "cronRuntime", 400, 0, "Standing runs continue for up to 8 hours unattended."),
  level("systemScheduler", 3, "System Scheduler", 24, "systemScheduler", 3000, 0, "Runs system policy for a full day unattended."),
  level("clusterController", 4, "Cluster Controller", 48, null, 25000, 200, "Maintains runs across two unattended days."),
  level("globalScheduler", 5, "Global Scheduler", 168, null, 250000, 1000, "Final seven-day offline buffer."),
];

const byId = new Map(watchdogLevelDefinitions.map((definition) => [definition.id, definition]));

export const isWatchdogLevelId = (value: unknown): value is WatchdogLevelId =>
  typeof value === "string" && (WATCHDOG_LEVEL_IDS as readonly string[]).includes(value);

export const getWatchdogDefinition = (id: WatchdogLevelId) => {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown watchdog level: ${id}`);
  return definition;
};

export const getWatchdogLevel = (id: WatchdogLevelId) => getWatchdogDefinition(id).level;

export const getNextWatchdogDefinition = (state: GameState) =>
  watchdogLevelDefinitions[getWatchdogLevel(state.watchdog.ownedLevelId) + 1] ?? null;

/** Capacity of the owned level; the persistence layer plans offline time with this. */
export const getWatchdogCapacityMs = (state: GameState) =>
  getWatchdogDefinition(state.watchdog.ownedLevelId).maxOfflineMs;

export const hasWatchdog = (state: GameState) => getWatchdogLevel(state.watchdog.ownedLevelId) >= 1;

export const createWatchdogState = (): WatchdogState => ({
  ownedLevelId: "none",
  departureLevelId: "none",
  offlineProcessedMs: 0,
});

export const normalizeWatchdogState = (
  value: Partial<WatchdogState> | null | undefined,
): WatchdogState => {
  const ownedLevelId = isWatchdogLevelId(value?.ownedLevelId) ? value.ownedLevelId : "none";
  const departureLevelId = isWatchdogLevelId(value?.departureLevelId)
    ? value.departureLevelId
    : ownedLevelId;
  const processed = value?.offlineProcessedMs;
  return {
    ownedLevelId,
    departureLevelId,
    offlineProcessedMs:
      typeof processed === "number" && Number.isFinite(processed) ? Math.max(0, processed) : 0,
  };
};

export const getWatchdogBlockedReason = (
  state: GameState,
  definition: WatchdogLevelDefinition,
): string | null => {
  const next = getNextWatchdogDefinition(state);
  if (next?.id !== definition.id) return "Watchdog levels must be purchased in order.";
  if (definition.requiredResearchId && !hasResearch(state.hub, definition.requiredResearchId)) {
    return `Requires ${getResearchDefinition(definition.requiredResearchId).name} research.`;
  }
  return null;
};

export const normalizeTimestamp = (timestampMs: number) =>
  Math.max(0, Math.trunc(Number.isFinite(timestampMs) ? timestampMs : 0));

export const recordSave = (state: GameState, timestampMs: number): GameState => ({
  ...state,
  time: { ...state.time, lastSavedAtMs: normalizeTimestamp(timestampMs) },
});

/** Departure forces auto control so an idle session never hangs in manual mode. */
export const recordDeparture = (state: GameState, timestampMs: number): GameState => ({
  ...state,
  run:
    state.run && state.run.control === "manual"
      ? { ...state.run, control: "auto", pendingPath: null, autoPath: null }
      : state.run,
  time: {
    lastSavedAtMs: normalizeTimestamp(timestampMs),
    departedAtMs: normalizeTimestamp(timestampMs),
  },
  watchdog: {
    ...state.watchdog,
    departureLevelId: state.watchdog.ownedLevelId,
    offlineProcessedMs: 0,
  },
  lastAdvanceReport: null,
});
