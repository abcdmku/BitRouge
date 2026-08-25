import { amount, type Amount } from "./amount";
import { countArchPerk, hasArchPerk } from "./board";
import { normalizeAdvanceTimeMs } from "./timeGrid";
import type {
  ArchPerkId,
  ComponentKind,
  FirmwareId,
  MetaState,
  RunState,
  TaskKind,
} from "./types";

// ============================================================================
// All §3 curves and balance constants. Costs are exact-decimal `Amount`s
// rounded to 0.1 cr; internal math uses doubles (in-run scales are small —
// every curve resets at reflow).
// ============================================================================

export const BASE_TICK_MS = 500;
export const BACKLOG_BASE_CAP = 12;
export const BACKLOG_CAP_PER_EAST_PORT = 4;
export const LIVE_PACKET_CAP = 48;
export const PACKET_HOP_LIMIT = 32;
export const HOP_LIMIT_HEAT = 10;
export const MANUAL_DELIVERY_MULTIPLIER = 1.5;
export const PRIORITY_DEADLINE_MS = 45_000;
export const FAULT_SPREAD_INTERVAL_MS = 30_000;
export const WATCHDOG_PATCH_MS = 90_000;
export const WATCHDOG_PENDING_DRAW_W = 2;
export const PATCH_HEAT = 50;
export const THROTTLE_HEAT = 70;
export const FAULT_ROLL_HEAT = 90;
export const OVERHEAT_HEAT = 100;
export const AMBIENT_COOLING_PER_S = 1;
export const HEAT_PIPES_AMBIENT_MULTIPLIER = 3;
export const DIFFUSION_COEFFICIENT = 0.08;
export const COOLER_AURA_PER_S = 12;
export const REGEN_PER_S = 1 / 30;
export const REGEN_BACKLOG_LIMIT = 6;
export const OVERHEAT_DAMAGE_PER_S = 1;
export const DROPPED_TASK_DAMAGE = 2;
export const EXPIRED_PRIORITY_DAMAGE = 5;
export const FAULT_SPREAD_DAMAGE = 5;
export const BASE_MAX_INTEGRITY = 100;
export const INTEGRITY_PER_PERK = 25;
export const OFFLINE_INTEGRITY_FLOOR = 25;
export const OFFLINE_CAP_MS = 12 * 60 * 60 * 1000;
export const VOLUNTARY_REFLOW_MIN_UPTIME_MS = 10 * 60 * 1000;
export const BASE_RESERVE_J = 100;
export const RAIL_WATTS_PER_LEVEL = 6;
export const EVENT_RING_SIZE = 64;

const round1 = (value: number) => Math.round(value * 10) / 10;
export const creditAmount = (value: number): Amount => amount(round1(value));

// ---- tick -------------------------------------------------------------------

/** Effective tick = 500 / (1 + 0.25 * clockLevel) ms, normalized to the time grid. */
export const getEffectiveTickMs = (clockLevel: number) =>
  normalizeAdvanceTimeMs(BASE_TICK_MS / (1 + 0.25 * clockLevel));

// ---- tasks and escalation ---------------------------------------------------

const MIN_ARRIVAL_INTERVAL_MS = 250;

/** Arrival interval = 6000 * 0.97^U * 0.9^(gen-1), U in uptime minutes. */
export const getArrivalIntervalMs = (uptimeMs: number, gen: number) => {
  const minutes = uptimeMs / 60_000;
  const interval = 6000 * Math.pow(0.97, minutes) * Math.pow(0.9, gen - 1);
  return Math.max(MIN_ARRIVAL_INTERVAL_MS, interval);
};

export const TASK_VALUE_MULTIPLIER: Record<TaskKind, number> = {
  bulk: 1,
  crunch: 3,
  hot: 2,
  priority: 5,
};

/** Base value = 1.05^U cr, times the kind multiplier and +20% per baseValue20 perk. */
export const getTaskValue = (
  uptimeMs: number,
  kind: TaskKind,
  architecture: readonly ArchPerkId[],
): Amount => {
  const minutes = uptimeMs / 60_000;
  const archMult = Math.pow(1.2, countArchPerk(architecture, "baseValue20"));
  return creditAmount(Math.pow(1.05, minutes) * TASK_VALUE_MULTIPLIER[kind] * archMult);
};

/** Cumulative kind mix per gen: bulk / crunch / hot / priority. */
export const TASK_MIX_BY_GEN: Record<number, Record<TaskKind, number>> = {
  1: { bulk: 1.0, crunch: 0, hot: 0, priority: 0 },
  2: { bulk: 0.7, crunch: 0.3, hot: 0, priority: 0 },
  3: { bulk: 0.55, crunch: 0.3, hot: 0.15, priority: 0 },
  4: { bulk: 0.45, crunch: 0.3, hot: 0.15, priority: 0.1 },
};

export const rollTaskKind = (gen: number, roll01: number): TaskKind => {
  const mix = TASK_MIX_BY_GEN[Math.min(4, Math.max(1, gen))];
  let cursor = 0;
  for (const kind of ["bulk", "crunch", "hot", "priority"] as const) {
    cursor += mix[kind];
    if (roll01 < cursor) return kind;
  }
  return "bulk";
};

export const getBacklogCap = (architecture: readonly ArchPerkId[]) =>
  BACKLOG_BASE_CAP + BACKLOG_CAP_PER_EAST_PORT * countArchPerk(architecture, "eastPort");

export const getMaxIntegrity = (architecture: readonly ArchPerkId[]) =>
  BASE_MAX_INTEGRITY + INTEGRITY_PER_PERK * countArchPerk(architecture, "integrity25");

// ---- power ------------------------------------------------------------------

export const getGenerationW = (railLevel: number, architecture: readonly ArchPerkId[]) =>
  RAIL_WATTS_PER_LEVEL * railLevel * (hasArchPerk(architecture, "dualRail") ? 2 : 1);

export const getReserveMaxJ = (capacitorLevel: number, architecture: readonly ArchPerkId[]) =>
  BASE_RESERVE_J *
  Math.pow(1.6, capacitorLevel) *
  Math.pow(1.5, countArchPerk(architecture, "reserve150"));

// ---- components -------------------------------------------------------------

export interface ComponentDefinition {
  kind: ComponentKind;
  label: string;
  flavor: string;
  baseCost: number;
  costGrowth: number;
  heatPerAction: number;
  drawW: number;
  /** Minimum generation required to place. */
  minGen: number;
}

export const componentDefinitions: Record<ComponentKind, ComponentDefinition> = {
  core: {
    kind: "core",
    label: "CPU Core",
    flavor: "pulls one job from the queue; output doubles per level",
    baseCost: 15,
    costGrowth: 3,
    heatPerAction: 2,
    drawW: 4,
    minGen: 1,
  },
  cache: {
    kind: "cache",
    label: "CACHE",
    flavor: "doubles the value of each job once",
    baseCost: 40,
    costGrowth: 1.9,
    heatPerAction: 8,
    drawW: 3,
    minGen: 1,
  },
  cooler: {
    kind: "cooler",
    label: "Cooling Loop",
    flavor: "removes 12 heat/s from nearby hardware",
    baseCost: 25,
    costGrowth: 1.7,
    heatPerAction: 0,
    drawW: 2,
    minGen: 1,
  },
  miner: {
    kind: "miner",
    label: "RAM",
    flavor: "stages each job and recovers Data",
    baseCost: 100,
    costGrowth: 2.2,
    heatPerAction: 4,
    drawW: 3,
    minGen: 1,
  },
  gpu: {
    kind: "gpu",
    label: "GPU",
    flavor: "multiplies routed job value by four",
    baseCost: 500,
    costGrowth: 2.5,
    heatPerAction: 20,
    drawW: 10,
    minGen: 3,
  },
};

/**
 * Purchase cost for the next chip of `kind`, given how many are already owned.
 * The free boot CORE does not participate in the CORE curve (second CORE = 15).
 */
export const getComponentCost = (kind: ComponentKind, ownedCount: number): Amount => {
  const def = componentDefinitions[kind];
  const paidOwned = kind === "core" ? Math.max(0, ownedCount - 1) : ownedCount;
  return creditAmount(def.baseCost * Math.pow(def.costGrowth, paidOwned));
};

/** Upgrade to `level + 1` costs base-cost * 0.6 * 1.15^(level-1). */
export const getUpgradeCost = (kind: ComponentKind, level: number): Amount =>
  creditAmount(componentDefinitions[kind].baseCost * 0.6 * Math.pow(1.15, Math.max(0, level - 1)));

const upgradeSpendThrough = (kind: ComponentKind, level: number) => {
  let total = 0;
  for (let l = 1; l < level; l += 1) {
    total += componentDefinitions[kind].baseCost * 0.6 * Math.pow(1.15, l - 1);
  }
  return total;
};

/**
 * Sell refund: 50% (100% with Hot-Swap) of the latest purchase price of the
 * kind plus every upgrade paid on this chip.
 */
export const getSellRefund = (
  kind: ComponentKind,
  ownedCount: number,
  level: number,
  hotSwap: boolean,
): Amount => {
  const def = componentDefinitions[kind];
  const paidOwned = kind === "core" ? Math.max(0, ownedCount - 1) : ownedCount;
  const purchase =
    kind === "core" && ownedCount <= 1
      ? 0
      : def.baseCost * Math.pow(def.costGrowth, Math.max(0, paidOwned - 1));
  const fraction = hotSwap ? 1 : 0.5;
  return creditAmount((purchase + upgradeSpendThrough(kind, level)) * fraction);
};

/** CORE value multiplier doubles per level; CACHE ×2 and GPU ×4 grow +25% per level. */
export const getCoreMultiplier = (level: number) => Math.pow(2, Math.max(0, level - 1));
export const getCacheMultiplier = (level: number) => 2 * Math.pow(1.25, Math.max(0, level - 1));
export const getGpuMultiplier = (level: number) => 4 * Math.pow(1.25, Math.max(0, level - 1));

// ---- sockets / system -------------------------------------------------------

/** Unlock cost given the current count of unlocked (non-port) sockets. */
export const getSocketUnlockCost = (unlockedCount: number): Amount =>
  creditAmount(4 * Math.pow(1.35, Math.max(0, unlockedCount - 3)));

/** RAIL I costs 12 cr; RAIL n>=2 costs 50 * 2^(n-2). */
export const getRailCost = (nextLevel: number): Amount =>
  nextLevel <= 1 ? creditAmount(12) : creditAmount(50 * Math.pow(2, nextLevel - 2));

/** CAPACITOR n costs 40 * 1.9^(n-1). */
export const getCapacitorCost = (nextLevel: number): Amount =>
  creditAmount(40 * Math.pow(1.9, Math.max(0, nextLevel - 1)));

/** CLOCK n costs 30 * 1.8^(n-1). */
export const getClockCost = (nextLevel: number): Amount =>
  creditAmount(30 * Math.pow(1.8, Math.max(0, nextLevel - 1)));

// ---- firmware ---------------------------------------------------------------

export interface FirmwareDefinition {
  id: FirmwareId;
  label: string;
  flavor: string;
  costData: number;
}

export const firmwareDefinitions: Record<FirmwareId, FirmwareDefinition> = {
  heatPipes: {
    id: "heatPipes",
    label: "HEAT PIPES",
    flavor: "ambient cooling ×3",
    costData: 10,
  },
  watchdog: {
    id: "watchdog",
    label: "WATCHDOG",
    flavor: "auto-patch faults after 90 s; +2 W per pending fault",
    costData: 25,
  },
  qos: {
    id: "qos",
    label: "QoS",
    flavor: "cores pull PRIORITY tasks first",
    costData: 60,
  },
  hotSwap: {
    id: "hotSwap",
    label: "HOT-SWAP",
    flavor: "sell/move refunds 100%",
    costData: 150,
  },
};

// ---- architecture -----------------------------------------------------------

export interface ArchPerkDefinition {
  id: ArchPerkId;
  label: string;
  flavor: string;
  baseCostSilicon: number;
  repeatable: boolean;
  /** Repeatable cost growth per copy owned. */
  costGrowth: number;
  requires: ArchPerkId | null;
}

export const archPerkDefinitions: Record<ArchPerkId, ArchPerkDefinition> = {
  startKit: {
    id: "startKit",
    label: "START KIT",
    flavor: "begin with +1 PSU level and 6 sockets",
    baseCostSilicon: 3,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  integrity25: {
    id: "integrity25",
    label: "+INTEGRITY 25",
    flavor: "+25 max integrity",
    baseCostSilicon: 5,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  baseValue20: {
    id: "baseValue20",
    label: "BASE VALUE +20%",
    flavor: "+20% task value (repeatable)",
    baseCostSilicon: 8,
    repeatable: true,
    costGrowth: 1.6,
    requires: null,
  },
  reserve150: {
    id: "reserve150",
    label: "RESERVE ×1.5",
    flavor: "power reserve ×1.5",
    baseCostSilicon: 8,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  board5x8: {
    id: "board5x8",
    label: "BOARD 5×8",
    flavor: "one more socket row (next reflow)",
    baseCostSilicon: 12,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  gen2: {
    id: "gen2",
    label: "GEN 2",
    flavor: "CACHE tier II + CRUNCH tasks",
    baseCostSilicon: 15,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  eastPort: {
    id: "eastPort",
    label: "EAST PORT",
    flavor: "second PORT on the east edge; backlog +4",
    baseCostSilicon: 20,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  gen3: {
    id: "gen3",
    label: "GEN 3",
    flavor: "GPU + HOT tasks",
    baseCostSilicon: 30,
    repeatable: false,
    costGrowth: 1,
    requires: "gen2",
  },
  dualRail: {
    id: "dualRail",
    label: "DUAL RAIL",
    flavor: "rails generate ×2",
    baseCostSilicon: 40,
    repeatable: false,
    costGrowth: 1,
    requires: null,
  },
  gen4: {
    id: "gen4",
    label: "GEN 4",
    flavor: "QoS junctions + PRIORITY tasks",
    baseCostSilicon: 50,
    repeatable: false,
    costGrowth: 1,
    requires: "gen3",
  },
};

export const getArchCost = (id: ArchPerkId, timesOwned: number) => {
  const def = archPerkDefinitions[id];
  return Math.round(def.baseCostSilicon * Math.pow(def.costGrowth, timesOwned));
};

export const getGenFromArchitecture = (architecture: readonly ArchPerkId[]) => {
  if (hasArchPerk(architecture, "gen4")) return 4;
  if (hasArchPerk(architecture, "gen3")) return 3;
  if (hasArchPerk(architecture, "gen2")) return 2;
  return 1;
};

// ---- prestige ---------------------------------------------------------------

/** Silicon = floor(U^1.8 / 40) + floor(W / 200), U = uptime minutes, W = tasks. */
export const getSiliconPayout = (uptimeMs: number, tasksDone: number) => {
  const minutes = Math.max(0, uptimeMs) / 60_000;
  return Math.floor(Math.pow(minutes, 1.8) / 40) + Math.floor(Math.max(0, tasksDone) / 200);
};

// ---- derived run figures ----------------------------------------------------

export const hasFirmware = (run: RunState, id: FirmwareId) => run.system.firmware.includes(id);

/** Total draw: each powered, unfaulted chip's W plus 2 W per fault pending under Watchdog. */
export const getPowerDrawW = (run: RunState) => {
  let draw = 0;
  let pendingFaults = 0;
  for (const socket of run.board.sockets) {
    const component = socket.component;
    if (!component) continue;
    if (component.faulted) {
      pendingFaults += 1;
      continue;
    }
    if (component.powered) draw += componentDefinitions[component.kind].drawW;
  }
  if (hasFirmware(run, "watchdog")) draw += WATCHDOG_PENDING_DRAW_W * pendingFaults;
  return draw;
};

export const getNetWatts = (run: RunState, meta: MetaState) =>
  getGenerationW(run.system.railLevel, meta.architecture) - getPowerDrawW(run);

/** Board duty 0..1: full speed while reserve > 0, else G / draw (crawl, never halt). */
export const getDuty = (run: RunState, meta: MetaState) => {
  const draw = getPowerDrawW(run);
  if (draw === 0) return 1; // nothing to power — never brownout
  const generation = getGenerationW(run.system.railLevel, meta.architecture);
  if (draw <= generation) return 1;
  if (run.system.reserveJ > 1e-9) return 1;
  return generation > 0 ? generation / draw : 0;
};
