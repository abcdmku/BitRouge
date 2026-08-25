import { RESEARCH_IDS, type HubState, type ResearchId } from "./types";

export interface ResearchDefinition {
  id: ResearchId;
  /** display label, aligned with IdleBit's research vocabulary */
  name: string;
  description: string;
  /** one-line operator flavor, IdleBit transmission voice */
  flavor: string;
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
  flavor: string,
  costData: number,
  options: { costCredits?: number; daemon?: boolean; watts?: number } = {},
): ResearchDefinition => ({
  id,
  name,
  description,
  flavor,
  costData,
  costCredits: options.costCredits ?? 0,
  daemon: options.daemon ?? false,
  watts: options.watts ?? 0,
});

export const researchDefinitions: readonly ResearchDefinition[] = [
  entry(
    "watchdogTimer",
    "Local Scheduler",
    "Unlocks Watchdog L1: auto-redeploy after death, 2 h offline buffer.",
    "The queue can continue after attention moves elsewhere.",
    5,
  ),
  entry(
    "cacheMapping",
    "Cache Mapping",
    "+2 sight radius.",
    "Working sets no longer end at the fog boundary.",
    6,
  ),
  entry(
    "prefetchDaemon",
    "Prefetch Daemon",
    "Daemon: reveals work sites and payloads on the current floor.",
    "The work queue is fetched before it is needed.",
    8,
    { daemon: true, watts: 2 },
  ),
  entry(
    "thermalSensors",
    "Thermal Sensors",
    "Daemon: -1 extra heat per turn.",
    "The node finally knows how hot it runs.",
    10,
    { daemon: true, watts: 2 },
  ),
  entry(
    "redundantRail",
    "Redundant Rail",
    "+50% PSU power budget.",
    "A second rail carries what the first cannot.",
    10,
  ),
  entry(
    "garbageCollector",
    "Garbage Collector",
    "Daemon: auto-collects one adjacent leak cell every 4 turns.",
    "Leaked memory returns to the pool, billed to the ledger.",
    10,
    { daemon: true, watts: 2 },
  ),
  entry(
    "priorityScheduler",
    "Priority Scheduler",
    "+1 effective scheduler AI level.",
    "Urgent work preempts idle wandering.",
    12,
  ),
  entry(
    "multiCore",
    "Multi-Core Control",
    "+1 daemon slot.",
    "Parallel work is now a design choice, not an accident.",
    15,
  ),
  entry(
    "bugBounty",
    "Piecework Rates",
    "+25% work payouts (jobs, deliveries, GC).",
    "Every completed work unit now bills the ledger.",
    20,
  ),
  entry(
    "coreDumpAnalysis",
    "Core Dump Analysis",
    "Controller floors yield twice the Data.",
    "A crash is a dataset if you read it right.",
    25,
  ),
  entry(
    "checkpointing",
    "Checkpointing",
    "One revive per run.",
    "State survives one fatal fault.",
    30,
  ),
  entry(
    "processReaper",
    "Process Reaper",
    "Daemon: zombie processes stay dead.",
    "Orphaned processes are collected on the spot.",
    35,
    { daemon: true, watts: 2 },
  ),
  entry(
    "cronRuntime",
    "CRON Scheduler",
    "Unlocks Watchdog L2: CRON Runtime, 8 h offline buffer.",
    "The machine can keep a promise while unattended.",
    40,
  ),
  entry(
    "deepScan",
    "Deep Scan",
    "Runs start at floor(max depth / 2).",
    "Known territory streams past at boot.",
    60,
  ),
  entry(
    "systemScheduler",
    "System Scheduler",
    "Unlocks Watchdog L3: System Scheduler, 24 h offline buffer.",
    "Memory and compute now share one plan.",
    150,
  ),
  // ---- v2 work research (§6) -----------------------------------------------
  entry(
    "dmaController",
    "DMA Controller",
    "Hauling a payload no longer doubles the fault alert radius.",
    "Transfers move without waking the bus.",
    20,
  ),
  entry(
    "branchPredictor",
    "Branch Predictor",
    "The first hit during a channel does not reset it.",
    "The pipeline survives one mispredicted fault.",
    25,
  ),
  entry(
    "eccMemory",
    "ECC Memory",
    "bitFlip corruption of data nodes is halved.",
    "Single-bit errors correct themselves now.",
    30,
  ),
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
