import { RESEARCH_IDS, type HubState, type ResearchId } from "./types";

export interface ResearchDefinition {
  id: ResearchId;
  name: string;
  description: string;
  costData: number;
  costCredits: number;
  /** daemons occupy a core slot and draw watts while active */
  daemon: boolean;
  watts: number;
}

const entry = (
  id: ResearchId,
  name: string,
  description: string,
  costData: number,
  options: { costCredits?: number; daemon?: boolean; watts?: number } = {},
): ResearchDefinition => ({
  id,
  name,
  description,
  costData,
  costCredits: options.costCredits ?? 0,
  daemon: options.daemon ?? false,
  watts: options.watts ?? 0,
});

export const researchDefinitions: readonly ResearchDefinition[] = [
  entry("watchdogTimer", "Watchdog Timer", "Unlocks Watchdog L1: auto-redeploy after death, 2 h offline buffer.", 5),
  entry("cacheMapping", "Cache Mapping", "+2 sight radius.", 6),
  entry("prefetchDaemon", "Prefetch Daemon", "Daemon: reveals items on the current floor.", 8, { daemon: true, watts: 2 }),
  entry("thermalSensors", "Thermal Sensors", "Daemon: -1 extra heat per turn.", 10, { daemon: true, watts: 2 }),
  entry("redundantRail", "Redundant Rail", "+50% PSU power budget.", 10),
  entry("garbageCollector", "Garbage Collector", "Daemon: regenerate 1 HP every 4 turns.", 10, { daemon: true, watts: 2 }),
  entry("priorityScheduler", "Priority Scheduler", "+1 effective scheduler AI level.", 12),
  entry("multiCore", "Multi-Core", "+1 daemon slot.", 15),
  entry("bugBounty", "Bug Bounty", "+25% kill credits.", 20),
  entry("coreDumpAnalysis", "Core Dump Analysis", "Core dumps salvage twice the Data.", 25),
  entry("checkpointing", "Checkpointing", "One revive per run.", 30),
  entry("processReaper", "Process Reaper", "Daemon: zombie processes stay dead.", 35, { daemon: true, watts: 2 }),
  entry("cronRuntime", "CRON Runtime", "Unlocks Watchdog L2: 8 h offline buffer.", 40),
  entry("deepScan", "Deep Scan", "Runs start at floor(max depth / 2).", 60),
  entry("systemScheduler", "System Scheduler", "Unlocks Watchdog L3: 24 h offline buffer.", 150),
];

const byId = new Map(researchDefinitions.map((definition) => [definition.id, definition]));

export const isResearchId = (value: unknown): value is ResearchId =>
  typeof value === "string" && (RESEARCH_IDS as readonly string[]).includes(value);

export const getResearchDefinition = (id: ResearchId) => {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown research: ${id}`);
  return definition;
};

export const hasResearch = (hub: HubState, id: ResearchId) => hub.research.completed.includes(id);
