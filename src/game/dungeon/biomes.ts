/**
 * Biomes: every 5 depths the stack changes layer — network (1-5), storage
 * (6-10), kernel (11+). Biomes shift the enemy mix and hazard weights; the
 * renderer reads `RenderSnapshot.biome` for palette selection.
 */
import { getBiome, type Biome, type EnemyKind, type HazardKind } from "../renderSnapshot";

export { getBiome };
export type { Biome };

/** Enemy weight multipliers per biome; unlisted kinds keep their base weight. */
export const BIOME_ENEMY_WEIGHTS: Record<Biome, Partial<Record<EnemyKind, number>>> = {
  network: { bitFlip: 2, daemon: 2 },
  storage: { memoryLeak: 3, zombieProcess: 2.5, bitFlip: 0.6 },
  kernel: { deadlock: 2.5, forkBomb: 2, nullPointer: 2, bitFlip: 0.5 },
};

/** Hazard weights per biome (base weight 1 each). */
export const BIOME_HAZARD_WEIGHTS: Record<Biome, Record<HazardKind, number>> = {
  network: { hotTile: 1, overloadPlate: 1.5, corruptedSector: 0.75, brownout: 1.5 },
  storage: { hotTile: 0.75, overloadPlate: 1, corruptedSector: 2, brownout: 1 },
  kernel: { hotTile: 2, overloadPlate: 1.5, corruptedSector: 1, brownout: 0.75 },
};

export const getBiomeEnemyWeight = (kind: EnemyKind, baseWeight: number, depth: number) =>
  baseWeight * (BIOME_ENEMY_WEIGHTS[getBiome(depth)][kind] ?? 1);
