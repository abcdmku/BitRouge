import { amount, type Amount } from "./amount";
import { hasResearch } from "./research";
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

export const watchdogLevelDefinitions: readonly WatchdogLevelDefinition[] = [
  level("none", 0, "No Watchdog", 0, null, 0, 0, "Death ends the session. Closing freezes the run."),
  level("watchdogTimer", 1, "Watchdog Timer", 2, "watchdogTimer", 50, 0, "Auto-redeploy after death. Runs continue for 2 h offline."),
  level("cronRuntime", 2, "CRON Runtime", 8, "cronRuntime", 400, 0, "Runs continue for 8 h offline."),
  level("systemScheduler", 3, "System Scheduler", 24, "systemScheduler", 3000, 0, "Runs continue for 24 h offline."),
  level("clusterController", 4, "Cluster Controller", 48, null, 25000, 200, "Runs continue for 48 h offline."),
  level("globalScheduler", 5, "Global Scheduler", 168, null, 250000, 1000, "Runs continue for 7 days offline."),
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
    return `Requires ${definition.requiredResearchId} research.`;
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
