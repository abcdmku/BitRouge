/**
 * v2 work sites: §3 numbers, factories, and the `interact` resolution (mine /
 * execute / haul / deliver / GC). Tier-derived tables (latency, quota plans,
 * fault mixes, controller depths) live in `dungeon/tiers.ts` (workstream B);
 * this module owns everything a work site does once placed.
 */
import { amount, amountAdd, amountMultiply, amountPow, type Amount } from "../amount";
import { getTier, TileKind, type Tier } from "../renderSnapshot";
import type { HeroStats, Payload, RunState, WorkSite } from "../types";
import { pushEvent } from "./draft";
import { isAdjacent, toIndex, toPoint } from "./grid";
import { getDepthInTier, getQuotaPlan, getTierIndex, isControllerDepth } from "./tiers";

export { getTier };

// ---- work numbers (§3) ------------------------------------------------------

/** Heat added per working turn (channel, execute, GC); equals ATTACK_HEAT. */
export const WORK_HEAT = 2;
/** Extra heat dissipation while standing on a vent tile. */
export const VENT_DISSIPATION = 3;
/** Overclock: duration, per-turn heat, extra power draw, cadence multiplier. */
export const OVERCLOCK_TURNS = 10;
export const OVERCLOCK_HEAT = 2;
export const OVERCLOCK_WATTS = 4;
export const OVERCLOCK_SPEED_FACTOR = 0.5;
/** GC: channel turns per leak cell. */
export const GC_CHANNEL_TURNS = 2;
/** memoryLeak: turns between leak-cell allocations. */
export const LEAK_ALLOC_TURNS = 8;
/** daemon: turns to catch a payload thief before the payload resolves as lost. */
export const DAEMON_STEAL_TURNS = 20;
/** daemon carrying a stolen payload pays this kill-credit multiple. */
export const DAEMON_CARRY_BOUNTY_MULTIPLIER = 5;
/** forkBomb: duplicates when no copy has been damaged for this many turns. */
export const FORK_BOMB_DUP_TURNS = 12;
/** bitFlip hits that zero a data node (each removes 25% of original yield). */
export const NODE_ZERO_FLIPS = 4;

const TIER_NODE_BASE: Record<Tier, number> = { cache: 1, ram: 4, disk: 10, kernel: 18 };

/** Data node channel turns: max(2, (4 + 2*tierIndex) - floor(cacheLevel / 2)). */
export const getNodeChannelTurns = (depth: number, cacheLevel: number): number =>
  Math.max(2, 4 + 2 * getTierIndex(depth) - Math.floor(cacheLevel / 2));

/** Data node yield: tierBase + (depthInTier - 1). */
export const getNodeYield = (depth: number): number =>
  TIER_NODE_BASE[getTier(depth)] + (getDepthInTier(depth) - 1);

/** Job work volume W = 12 * 1.25^(d-1) units; payout is W credits (1 cr/unit). */
export const getJobWorkUnits = (depth: number): number =>
  12 * Math.pow(1.25, Math.max(0, depth - 1));

export const getJobPayout = (depth: number): Amount =>
  amountMultiply(12, amountPow("1.25", Math.max(0, Math.trunc(depth) - 1)));

/** Job units processed per interact turn: 1 + cacheLevel. */
export const getJobUnitsPerTurn = (cacheLevel: number): number => 1 + Math.max(0, cacheLevel);

/** Payload delivery payout: 10 * 1.3^(d-1) credits. */
export const getHaulPayout = (depth: number): Amount =>
  amountMultiply(10, amountPow("1.3", Math.max(0, Math.trunc(depth) - 1)));

/** GC payout per leak cell: 2 * 1.2^(d-1) credits. */
export const getLeakCredits = (depth: number): Amount =>
  amountMultiply(2, amountPow("1.2", Math.max(0, Math.trunc(depth) - 1)));

/**
 * Current (corruption-adjusted) node yield: floor(original * (1 - step *
 * corrupted)) where step is 25% (12.5% with ECC Memory). Zero at 4 flips.
 */
export const getCorruptedNodeYield = (site: WorkSite, eccMemory: boolean): number => {
  const step = eccMemory ? 0.125 : 0.25;
  return Math.max(0, Math.floor(site.yieldData * (1 - step * site.corrupted)));
};

// ---- factories (used by tests and workstream B's generators) ----------------

export const createDataNode = (id: number, x: number, y: number, depth: number): WorkSite => ({
  id,
  kind: "dataNode",
  x,
  y,
  totalUnits: getNodeChannelTurns(depth, 0),
  remainingUnits: getNodeChannelTurns(depth, 0),
  yieldData: getNodeYield(depth),
  payoutCredits: amount(0),
  corrupted: 0,
  squattedBy: null,
  resolved: false,
});

export const createJobStation = (id: number, x: number, y: number, depth: number): WorkSite => ({
  id,
  kind: "jobStation",
  x,
  y,
  totalUnits: getJobWorkUnits(depth),
  remainingUnits: getJobWorkUnits(depth),
  yieldData: 0,
  payoutCredits: getJobPayout(depth),
  corrupted: 0,
  squattedBy: null,
  resolved: false,
});

export const createIoPort = (id: number, x: number, y: number, depth: number): WorkSite => ({
  id,
  kind: "ioPort",
  x,
  y,
  totalUnits: 1,
  remainingUnits: 1,
  yieldData: 0,
  payoutCredits: getHaulPayout(depth),
  corrupted: 0,
  squattedBy: null,
  resolved: false,
});

export const createPayload = (
  id: number,
  x: number,
  y: number,
  portId: number,
  depth: number,
): Payload => ({
  id,
  x,
  y,
  portId,
  payoutCredits: getHaulPayout(depth),
  heldBy: "floor",
});

/** Shape workstream B's `generateFloor` adds to its result (optional until then). */
export interface GeneratedWork {
  sites: WorkSite[];
  payloads: Payload[];
}

/** Quota required for a floor: the tier plan, capped by resolvable tasks. */
export const computeQuotaRequired = (
  depth: number,
  sites: readonly WorkSite[],
  payloads: readonly Payload[],
): number => {
  const tasks =
    sites.filter((site) => site.kind === "dataNode" || site.kind === "jobStation").length +
    payloads.length;
  return Math.min(getQuotaPlan(depth).required, tasks);
};

// ---- runtime helpers (turn resolution) --------------------------------------

export const findSiteById = (run: RunState, id: number | null): WorkSite | undefined =>
  id === null ? undefined : run.sites.find((site) => site.id === id);

export const isSiteSquatted = (run: RunState, site: WorkSite): boolean =>
  site.squattedBy !== null &&
  run.enemies.some((enemy) => enemy.id === site.squattedBy && (enemy.hp > 0 || enemy.dormantTurns > 0));

export const isLeakAt = (run: RunState, x: number, y: number): boolean =>
  run.leaks.includes(toIndex(x, y, run.floor.width));

const anyControllerAlive = (run: RunState): boolean =>
  run.enemies.some((enemy) => enemy.kind === "kernelPanic" && (enemy.hp > 0 || enemy.dormantTurns > 0));

/**
 * Recompute the bus-gate lock: locked while the quota is unmet or a controller
 * (kernelPanic) lives. Pushes `stairsUnlocked` on the locked -> open edge.
 */
export const updateGateLock = (run: RunState) => {
  const shouldLock = run.quota.done < run.quota.required || anyControllerAlive(run);
  if (run.floor.stairsLocked && !shouldLock) {
    run.floor.stairsLocked = false;
    pushEvent(run, { kind: "stairsUnlocked" });
  } else if (!run.floor.stairsLocked && shouldLock) {
    run.floor.stairsLocked = true;
    pushEvent(run, { kind: "stairsLocked" });
  }
};

/** Count one resolved task toward quota and refresh the gate. */
export const markQuotaProgress = (run: RunState) => {
  run.quota.done += 1;
  pushEvent(run, { kind: "quotaProgress", done: run.quota.done, required: run.quota.required });
  updateGateLock(run);
};

const workPayout = (base: Amount, stats: HeroStats): Amount =>
  amountMultiply(base, stats.workPayoutMultiplier);

const completeDataNode = (run: RunState, stats: HeroStats, site: WorkSite) => {
  const controllerBonus = isControllerDepth(run.depth) ? stats.coreDumpMultiplier : 1;
  const data = getCorruptedNodeYield(site, stats.eccMemory) * controllerBonus;
  site.remainingUnits = 0;
  site.resolved = true;
  run.dataMined += data;
  run.sitesCompleted += 1;
  run.hero.channelSiteId = null;
  pushEvent(run, { kind: "siteCompleted", siteId: site.id, siteKind: "dataNode", credits: amount(0), data });
  markQuotaProgress(run);
};

const completeJobStation = (run: RunState, stats: HeroStats, site: WorkSite) => {
  const credits = workPayout(site.payoutCredits, stats);
  site.remainingUnits = 0;
  site.resolved = true;
  run.credits = amountAdd(run.credits, credits);
  run.sitesCompleted += 1;
  run.hero.channelSiteId = null;
  pushEvent(run, { kind: "siteCompleted", siteId: site.id, siteKind: "jobStation", credits, data: 0 });
  markQuotaProgress(run);
};

const deliverPayload = (run: RunState, stats: HeroStats, payload: Payload, port: WorkSite) => {
  const credits = workPayout(payload.payoutCredits, stats);
  run.credits = amountAdd(run.credits, credits);
  run.payloadsDelivered += 1;
  run.hero.carryingPayloadId = null;
  port.remainingUnits = 0;
  port.resolved = true;
  run.payloads = run.payloads.filter((candidate) => candidate.id !== payload.id);
  pushEvent(run, { kind: "payloadDelivered", id: payload.id, credits });
  pushEvent(run, { kind: "siteCompleted", siteId: port.id, siteKind: "ioPort", credits, data: 0 });
  markQuotaProgress(run);
};

/** A stolen (or stranded) payload resolves as lost; its port resolves too. */
export const losePayload = (run: RunState, payload: Payload) => {
  payload.heldBy = "lost";
  pushEvent(run, { kind: "payloadLost", id: payload.id });
  const port = findSiteById(run, payload.portId);
  if (port && !port.resolved) {
    port.resolved = true;
    port.remainingUnits = 0;
  }
  markQuotaProgress(run);
};

/**
 * bitFlip corruption: -25% of original yield per hit (halved by ECC Memory),
 * channel reset. A node zeroed by flips resolves for quota (never uncompletable).
 */
export const applyBitFlipCorruption = (run: RunState, stats: HeroStats, site: WorkSite) => {
  if (site.resolved || site.kind !== "dataNode") return;
  site.corrupted += 1;
  site.remainingUnits = site.totalUnits;
  if (run.hero.channelSiteId === site.id) run.hero.channelSiteId = null;
  pushEvent(run, { kind: "siteCorrupted", siteId: site.id });
  if (getCorruptedNodeYield(site, stats.eccMemory) <= 0) {
    site.resolved = true;
    run.hero.channelSiteId = run.hero.channelSiteId === site.id ? null : run.hero.channelSiteId;
    markQuotaProgress(run);
  }
};

/** Collect a leak cell: credits, counters, event. */
export const collectLeak = (run: RunState, stats: HeroStats, index: number) => {
  const credits = workPayout(getLeakCredits(run.depth), stats);
  run.leaks = run.leaks.filter((cell) => cell !== index);
  run.credits = amountAdd(run.credits, credits);
  run.leaksCollected += 1;
  pushEvent(run, { kind: "leakCollected", index, credits });
};

const adjacentLeakIndex = (run: RunState, preferred: number | null): number | null => {
  const { width } = run.floor;
  const candidates = run.leaks
    .filter((index) => {
      const point = toPoint(index, width);
      return isAdjacent(point, run.hero);
    })
    .sort((a, b) => a - b);
  if (candidates.length === 0) return null;
  if (preferred !== null && candidates.includes(preferred)) return preferred;
  return candidates[0]!;
};

/**
 * Resolve the context-sensitive `interact` hero action. Priority: deliver >
 * pick up > execute (job under the hero) > mine (adjacent node) > GC leak.
 * Working turns (mine/execute/GC) add WORK_HEAT. Carrying blocks channels.
 */
export const resolveInteract = (run: RunState, stats: HeroStats) => {
  const hero = run.hero;

  // 1. deliver a carried payload at (or next to) its port
  if (hero.carryingPayloadId !== null) {
    const payload = run.payloads.find((candidate) => candidate.id === hero.carryingPayloadId);
    if (payload) {
      const port = findSiteById(run, payload.portId);
      if (
        port &&
        !port.resolved &&
        ((hero.x === port.x && hero.y === port.y) || isAdjacent(hero, port))
      ) {
        deliverPayload(run, stats, payload, port);
        return;
      }
    }
  }

  // 2. pick up a floor payload under the hero
  if (hero.carryingPayloadId === null) {
    const payload = run.payloads.find(
      (candidate) => candidate.heldBy === "floor" && candidate.x === hero.x && candidate.y === hero.y,
    );
    if (payload) {
      payload.heldBy = "hero";
      hero.carryingPayloadId = payload.id;
      pushEvent(run, { kind: "payloadTaken", id: payload.id });
      return;
    }
  }

  // 3. execute the job station under the hero (resumable)
  const station = run.sites.find(
    (site) =>
      site.kind === "jobStation" &&
      !site.resolved &&
      site.x === hero.x &&
      site.y === hero.y &&
      !isSiteSquatted(run, site),
  );
  if (station) {
    hero.channelSiteId = station.id;
    hero.channelShield = stats.branchPredictor;
    hero.heat += WORK_HEAT;
    station.remainingUnits = Math.max(0, station.remainingUnits - getJobUnitsPerTurn(stats.cacheLevel));
    if (station.remainingUnits <= 0) {
      completeJobStation(run, stats, station);
    } else {
      pushEvent(run, { kind: "siteChanneled", siteId: station.id, remaining: station.remainingUnits });
    }
    return;
  }

  // hauling blocks channels (mining and GC)
  if (hero.carryingPayloadId !== null) return;

  // 4. mine an adjacent data node (non-resumable channel)
  const nodes = run.sites
    .filter((site) => site.kind === "dataNode" && !site.resolved && isAdjacent(site, hero))
    .sort((a, b) => a.id - b.id);
  const node = nodes.find((site) => site.id === hero.channelSiteId) ?? nodes[0];
  if (node) {
    if (hero.channelSiteId !== node.id) {
      // starting (or switching) a channel resets it to full turns
      node.totalUnits = getNodeChannelTurns(run.depth, stats.cacheLevel);
      node.remainingUnits = node.totalUnits;
      hero.channelSiteId = node.id;
      hero.channelShield = stats.branchPredictor;
    }
    hero.heat += WORK_HEAT;
    node.remainingUnits = Math.max(0, node.remainingUnits - 1);
    if (node.remainingUnits <= 0) {
      completeDataNode(run, stats, node);
    } else {
      pushEvent(run, { kind: "siteChanneled", siteId: node.id, remaining: node.remainingUnits });
    }
    return;
  }

  // 5. GC an adjacent leak cell (2-turn channel per cell)
  const leakIndex = adjacentLeakIndex(run, run.gcChannel?.index ?? null);
  if (leakIndex !== null) {
    hero.heat += WORK_HEAT;
    const remaining =
      run.gcChannel && run.gcChannel.index === leakIndex
        ? run.gcChannel.remaining - 1
        : GC_CHANNEL_TURNS - 1;
    if (remaining <= 0) {
      run.gcChannel = null;
      collectLeak(run, stats, leakIndex);
    } else {
      run.gcChannel = { index: leakIndex, remaining };
    }
    return;
  }
  // nothing to interact with: the turn is spent (acts like wait)
};

/**
 * Damage interrupts work: a hit resets a data-node channel to full turns
 * (Branch Predictor absorbs the first), keeps job units (resumable), and
 * resets any leak GC channel. Called once per turn after the enemy phase.
 */
export const breakChannelOnDamage = (run: RunState) => {
  const hero = run.hero;
  run.gcChannel = null;
  if (hero.channelSiteId === null) return;
  const site = findSiteById(run, hero.channelSiteId);
  if (!site || site.resolved) {
    hero.channelSiteId = null;
    return;
  }
  if (site.kind === "dataNode") {
    if (hero.channelShield) {
      hero.channelShield = false;
      return;
    }
    site.remainingUnits = site.totalUnits;
  }
  hero.channelSiteId = null;
};

/** True when the hero stands on a vent tile (+3 heat dissipation). */
export const isHeroOnVent = (run: RunState): boolean =>
  run.floor.tiles[toIndex(run.hero.x, run.hero.y, run.floor.width)] === TileKind.vent;
