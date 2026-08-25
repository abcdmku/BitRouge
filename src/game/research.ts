import { amount, type Amount } from "./amount";
import type { GameState, ResearchId } from "./types";

export interface ResearchDefinition {
  id: ResearchId;
  name: string;
  description: string;
  creditCost: Amount;
  dataCost: Amount;
  /** One work unit is one completed job. */
  workRequired: number;
  requires: ResearchId[];
  branch: "compute" | "automation" | "system" | "tier";
}

const research = (
  id: ResearchId,
  name: string,
  description: string,
  credits: number | string,
  data: number | string,
  workRequired: number,
  requires: ResearchId[],
  branch: ResearchDefinition["branch"],
): ResearchDefinition => ({
  id,
  name,
  description,
  creditCost: amount(credits),
  dataCost: amount(data),
  workRequired,
  requires,
  branch,
});

/**
 * Names, costs, and dependency order follow IdleBit's opening hardware path.
 * Work requirements replace arbitrary research timers. A faster working node
 * finishes the same research sooner.
 */
export const researchDefinitions: Record<ResearchId, ResearchDefinition> = {
  decodeLogic: research(
    "decodeLogic",
    "Decode Logic",
    "Unlocks fault decoding and more valuable jobs.",
    3,
    0,
    4,
    [],
    "compute",
  ),
  cacheMapping: research(
    "cacheMapping",
    "Cache Mapping",
    "Unlocks Cache modules and processed jobs.",
    6,
    2,
    6,
    ["decodeLogic"],
    "compute",
  ),
  benchmarkHarness: research(
    "benchmarkHarness",
    "Benchmark Harness",
    "Measures the node and opens the multicore path.",
    28,
    1,
    10,
    ["decodeLogic"],
    "compute",
  ),
  multiCore: research(
    "multiCore",
    "Multi-Core Control",
    "Allows more CPU cores to pull jobs in parallel.",
    56,
    6,
    16,
    ["benchmarkHarness"],
    "compute",
  ),
  localScheduler: research(
    "localScheduler",
    "Local Scheduler",
    "Installs a 2 hour Automation Buffer.",
    80,
    6,
    24,
    ["multiCore"],
    "automation",
  ),
  systemScheduler: research(
    "systemScheduler",
    "System Scheduler",
    "Adds system policies and a 12 hour Automation Buffer.",
    320,
    8,
    50,
    ["cronScheduler"],
    "automation",
  ),
  ramControl: research(
    "ramControl",
    "RAM Control",
    "Unlocks RAM modules that recover Data from each job.",
    260,
    3,
    30,
    ["localScheduler"],
    "system",
  ),
  systemBus: research(
    "systemBus",
    "System Bus",
    "Links additional CPU packages to the main data path.",
    520,
    10,
    80,
    ["localScheduler"],
    "system",
  ),
  cronScheduler: research(
    "cronScheduler",
    "CRON Scheduler",
    "Renews one standing order and installs an 8 hour buffer.",
    360,
    10,
    80,
    ["systemBus"],
    "automation",
  ),
  thermalControl: research(
    "thermalControl",
    "Thermal Control",
    "Unlocks stronger cooling and overclock-safe operation.",
    5_000,
    24,
    180,
    ["ramControl"],
    "system",
  ),
  specializedCompute: research(
    "specializedCompute",
    "Specialized Compute",
    "Unlocks GPU modules and routed high-value work.",
    25_000,
    40,
    300,
    ["thermalControl"],
    "system",
  ),
  cpuTierKhz: research(
    "cpuTierKhz",
    "kHz CPU Research",
    "Unlocks the kHz CPU and RAM tier.",
    2_000_000,
    0,
    600,
    ["systemScheduler"],
    "tier",
  ),
  cpuTierMhz: research(
    "cpuTierMhz",
    "MHz CPU Research",
    "Unlocks the MHz CPU and RAM tier.",
    20_000_000_000,
    0,
    1_800,
    ["cpuTierKhz"],
    "tier",
  ),
  cpuTierGhz: research(
    "cpuTierGhz",
    "GHz CPU Research",
    "Unlocks the GHz CPU and RAM tier.",
    200_000_000_000_000,
    0,
    5_400,
    ["cpuTierMhz"],
    "tier",
  ),
};

export const hasResearch = (state: GameState, id: ResearchId) =>
  state.meta.research.completed.includes(id);

export const researchRequirementsMet = (state: GameState, id: ResearchId) =>
  researchDefinitions[id].requires.every((required) => hasResearch(state, required));

export const getResearchProgress = (state: GameState) => {
  const active = state.meta.research.active;
  if (!active) return null;
  const definition = researchDefinitions[active.id];
  return {
    id: active.id,
    workDone: active.workDone,
    workRequired: definition.workRequired,
    progress: Math.min(1, active.workDone / definition.workRequired),
  };
};

export const getAutomationBufferMs = (state: GameState) => {
  if (hasResearch(state, "systemScheduler")) return 12 * 60 * 60 * 1000;
  if (hasResearch(state, "cronScheduler")) return 8 * 60 * 60 * 1000;
  if (hasResearch(state, "localScheduler")) return 2 * 60 * 60 * 1000;
  return 0;
};

export const CPU_TIER_LEVELS = 12;
export type CpuTier = "Hz" | "kHz" | "MHz" | "GHz";

export const getCpuTier = (clockLevel: number): { tier: CpuTier; level: number } => {
  const safe = Math.max(0, Math.trunc(clockLevel));
  const tierIndex = Math.min(3, Math.floor(safe / CPU_TIER_LEVELS));
  const tiers: CpuTier[] = ["Hz", "kHz", "MHz", "GHz"];
  return { tier: tiers[tierIndex], level: (safe % CPU_TIER_LEVELS) + 1 };
};

export const getClockRateLabel = (clockLevel: number) => {
  const { tier, level } = getCpuTier(clockLevel);
  const value = tier === "GHz"
    ? Math.min(6, 1 * Math.pow(1.18, level - 1))
    : Math.min(999, 1 * Math.pow(1.5, level - 1));
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${tier}`;
};

export const canAdvanceClock = (state: GameState) => {
  const targetLevel = state.run.system.clockLevel + 1;
  const targetTier = Math.floor(targetLevel / CPU_TIER_LEVELS);
  if (targetTier <= 0) return true;
  if (targetTier === 1) return hasResearch(state, "cpuTierKhz");
  if (targetTier === 2) return hasResearch(state, "cpuTierMhz");
  return targetTier === 3 && hasResearch(state, "cpuTierGhz");
};

export const getClockGateLabel = (clockLevel: number): string | null => {
  const targetTier = Math.floor((clockLevel + 1) / CPU_TIER_LEVELS);
  if (targetTier === 1) return "kHz CPU Research";
  if (targetTier === 2) return "MHz CPU Research";
  if (targetTier === 3) return "GHz CPU Research";
  return targetTier > 3 ? "MAX TIER" : null;
};
