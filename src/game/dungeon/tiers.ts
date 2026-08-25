/**
 * Memory tiers (redesign v2 §2): depth bands become memory tiers, replacing
 * biomes. The tier decides layout (see generate.ts carvers), turn latency,
 * the fault mix, the hazard mix, and the per-floor work quota.
 *
 *   tier   depths  cycles/turn  layout
 *   cache  1-3     2            bank lattice
 *   ram    4-7     5            parallel banks + channels
 *   disk   8-11    12           concentric ring sectors
 *   kernel 12+     8            corrupted rooms
 *
 * Workstreams A (sim mechanics) and C (render/UI) both consume this module;
 * it is the single source of truth for every tier-derived number.
 */
import { normalizeAdvanceTimeMs } from "../timeGrid";
import { getTier, type EnemyKind, type HazardKind, type Tier } from "../renderSnapshot";

// `Tier` and `getTier(depth)` are part of the renderer contract (snapshot
// carries `tier`), so the canonical definitions live in renderSnapshot.ts;
// this module re-exports them and owns everything derived from the tier.
export { getTier };
export type { Tier };

export const TIERS: readonly Tier[] = ["cache", "ram", "disk", "kernel"];

/** First depth of each tier (kernel is open-ended). */
export const TIER_START_DEPTH: Record<Tier, number> = { cache: 1, ram: 4, disk: 8, kernel: 12 };

/** 0..3 (cache..kernel); the tier scaling knob in the §3 formulas. */
export const getTierIndex = (depth: number): number => TIERS.indexOf(getTier(depth));

/** 1-based position inside the tier band (cache: 1..3, ram: 1..4, ...). */
export const getDepthInTier = (depth: number): number =>
  Math.max(1, depth - TIER_START_DEPTH[getTier(depth)] + 1);

/** Turn latency per tier. Kernel is faster than disk on purpose: dangerous, not laggy. */
export const TIER_CYCLES_PER_TURN: Record<Tier, number> = { cache: 2, ram: 5, disk: 12, kernel: 8 };

export const cyclesPerTurn = (tier: Tier): number => TIER_CYCLES_PER_TURN[tier];

/**
 * Replacement for the smooth 1.35^depth latency curve:
 * `msPerTurn = 1000 * cyclesPerTurn(tier) / clockHz`. Drop-in for
 * `hardware.getMsPerTurn` (workstream A wires it).
 */
export const getTierMsPerTurn = (clockHz: number, depth: number): number =>
  normalizeAdvanceTimeMs((1000 * cyclesPerTurn(getTier(depth))) / clockHz);

/**
 * Controller (boss) floors: 3, 7, 11, then every 4th (15, 19, 23, ...).
 * A kernelPanic guards the bus gate; the flush needs quota AND the kill.
 */
export const isControllerDepth = (depth: number): boolean => depth >= 3 && depth % 4 === 3;

/**
 * Per-tier fault mixes (§8), replacing the v1 biome weight tables. Weights
 * multiply the base enemy weights; kinds missing from a tier's mix never
 * spawn there. Strict per spec: cache = bitFlip/forkBomb, ram =
 * memoryLeak/nullPointer/zombie, disk = daemon/deadlock/zombie, kernel =
 * everything, hot. `minDepth` gating in enemies.ts still applies on top.
 */
export const TIER_ENEMY_WEIGHTS: Record<Tier, Partial<Record<EnemyKind, number>>> = {
  cache: { bitFlip: 1, forkBomb: 1 },
  ram: { memoryLeak: 2, nullPointer: 2, zombieProcess: 2 },
  disk: { daemon: 2, deadlock: 2, zombieProcess: 1.5 },
  kernel: {
    bitFlip: 0.5,
    nullPointer: 1.5,
    memoryLeak: 1,
    deadlock: 1.5,
    forkBomb: 1.5,
    daemon: 1.5,
    zombieProcess: 1,
  },
};

/**
 * Drop-in replacement for `getBiomeEnemyWeight` (same signature). Zero-weight
 * kinds (bosses) never roll; kinds outside the tier mix multiply to zero.
 */
export const getTierEnemyWeight = (kind: EnemyKind, baseWeight: number, depth: number): number =>
  baseWeight * (TIER_ENEMY_WEIGHTS[getTier(depth)][kind] ?? 0);

/** Hazard weights per tier (hazards rethemed per tier, §8). */
export const TIER_HAZARD_WEIGHTS: Record<Tier, Record<HazardKind, number>> = {
  cache: { hotTile: 1.5, overloadPlate: 1, corruptedSector: 0.25, brownout: 1.25 },
  ram: { hotTile: 1, overloadPlate: 1.5, corruptedSector: 0.75, brownout: 1 },
  disk: { hotTile: 0.5, overloadPlate: 1, corruptedSector: 2, brownout: 1 },
  kernel: { hotTile: 2, overloadPlate: 1.5, corruptedSector: 1.5, brownout: 0.75 },
};

/** Per-floor task roll (§3): total sites, quota required, and the kind mix. */
export interface QuotaPlan {
  /** total work sites on the floor (hauls count once; each also gets a payload) */
  sites: number;
  /** resolved sites needed before the bus gate unlocks */
  required: number;
  nodes: number;
  jobs: number;
  hauls: number;
}

export const TIER_QUOTA_PLANS: Record<Tier, QuotaPlan> = {
  cache: { sites: 5, required: 3, nodes: 2, jobs: 2, hauls: 1 },
  ram: { sites: 6, required: 4, nodes: 2, jobs: 2, hauls: 2 },
  disk: { sites: 6, required: 4, nodes: 3, jobs: 2, hauls: 1 },
  kernel: { sites: 7, required: 5, nodes: 3, jobs: 2, hauls: 2 },
};

export const getQuotaPlan = (depth: number): QuotaPlan => TIER_QUOTA_PLANS[getTier(depth)];

// §3 per-site numbers (channel turns, work volumes, payouts) live in
// dungeon/worksites.ts next to the interact resolution that spends them;
// generation consumes its createDataNode/createJobStation/createIoPort/
// createPayload factories so the numbers exist exactly once.
