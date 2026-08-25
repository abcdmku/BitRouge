import { TileKind, type EnemyKind } from "../renderSnapshot";
import { getMsPerTurn } from "../hardware";
import { isOpaqueTile, isVentTile, isWalkableTile, VENT_TILE } from "./grid";
import {
  cyclesPerTurn,
  getDepthInTier,
  getQuotaPlan,
  getTier,
  getTierEnemyWeight,
  getTierIndex,
  getTierMsPerTurn,
  isControllerDepth,
  TIER_ENEMY_WEIGHTS,
  TIER_HAZARD_WEIGHTS,
  TIER_QUOTA_PLANS,
  TIERS,
} from "./tiers";

describe("memory tiers", () => {
  it("maps depth bands to cache / ram / disk / kernel", () => {
    expect(getTier(1)).toBe("cache");
    expect(getTier(3)).toBe("cache");
    expect(getTier(4)).toBe("ram");
    expect(getTier(7)).toBe("ram");
    expect(getTier(8)).toBe("disk");
    expect(getTier(11)).toBe("disk");
    expect(getTier(12)).toBe("kernel");
    expect(getTier(42)).toBe("kernel");
    expect(TIERS).toEqual(["cache", "ram", "disk", "kernel"]);
    expect([1, 4, 8, 12].map(getTierIndex)).toEqual([0, 1, 2, 3]);
    expect([1, 3, 4, 7, 8, 11, 12, 15].map(getDepthInTier)).toEqual([1, 3, 1, 4, 1, 4, 1, 4]);
  });

  it("latency: msPerTurn = 1000 * cycles / clockHz, kernel faster than disk", () => {
    expect(cyclesPerTurn("cache")).toBe(2);
    expect(cyclesPerTurn("ram")).toBe(5);
    expect(cyclesPerTurn("disk")).toBe(12);
    expect(cyclesPerTurn("kernel")).toBe(8);
    // stock clock (2 Hz): cache 1.0 s, ram 2.5 s, disk 6.0 s, kernel 4.0 s
    expect(getTierMsPerTurn(2, 1)).toBeCloseTo(1000, 6);
    expect(getTierMsPerTurn(2, 5)).toBeCloseTo(2500, 6);
    expect(getTierMsPerTurn(2, 9)).toBeCloseTo(6000, 6);
    expect(getTierMsPerTurn(2, 13)).toBeCloseTo(4000, 6);
    // hardware.getMsPerTurn is wired to the same table
    for (let depth = 1; depth <= 15; depth += 1) {
      expect(getMsPerTurn(2.3, depth)).toBeCloseTo(getTierMsPerTurn(2.3, depth), 6);
    }
    // a disk turn is >= 4x a cache turn (success criterion 4)
    expect(getTierMsPerTurn(2, 9) / getTierMsPerTurn(2, 1)).toBeGreaterThanOrEqual(4);
  });

  it("controller floors are 3, 7, 11, then every 4th", () => {
    for (const depth of [3, 7, 11, 15, 19, 23]) expect(isControllerDepth(depth)).toBe(true);
    for (const depth of [1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 20]) {
      expect(isControllerDepth(depth)).toBe(false);
    }
  });

  it("fault mixes follow §8: cache flips/forks, ram leaks/pointers/zombies, disk daemons/deadlocks/zombies, kernel everything", () => {
    expect(Object.keys(TIER_ENEMY_WEIGHTS.cache).sort()).toEqual(["bitFlip", "forkBomb"]);
    for (const kind of ["memoryLeak", "nullPointer", "zombieProcess"] as const) {
      expect(TIER_ENEMY_WEIGHTS.ram[kind]).toBeGreaterThan(0);
    }
    for (const kind of ["daemon", "deadlock", "zombieProcess"] as const) {
      expect(TIER_ENEMY_WEIGHTS.disk[kind]).toBeGreaterThan(0);
    }
    const everyFault: EnemyKind[] = [
      "bitFlip",
      "nullPointer",
      "memoryLeak",
      "deadlock",
      "forkBomb",
      "daemon",
      "zombieProcess",
    ];
    for (const kind of everyFault) expect(TIER_ENEMY_WEIGHTS.kernel[kind]).toBeGreaterThan(0);
    // the boss never rolls; the ram signature faults never roll in cache
    expect(getTierEnemyWeight("kernelPanic", 0, 15)).toBe(0);
    expect(getTierEnemyWeight("daemon", 2, 1)).toBe(0);
    expect(getTierEnemyWeight("deadlock", 1, 5)).toBe(0);
    expect(getTierEnemyWeight("bitFlip", 5, 1)).toBeGreaterThan(0);
    for (const weights of Object.values(TIER_ENEMY_WEIGHTS)) {
      for (const value of Object.values(weights)) expect(value).toBeGreaterThan(0);
    }
  });

  it("hazard weights cover all four kinds per tier", () => {
    for (const weights of Object.values(TIER_HAZARD_WEIGHTS)) {
      expect(Object.keys(weights).sort()).toEqual(["brownout", "corruptedSector", "hotTile", "overloadPlate"]);
      for (const value of Object.values(weights)) expect(value).toBeGreaterThan(0);
    }
  });

  it("quota table matches §3", () => {
    expect(TIER_QUOTA_PLANS.cache).toEqual({ sites: 5, required: 3, nodes: 2, jobs: 2, hauls: 1 });
    expect(TIER_QUOTA_PLANS.ram).toEqual({ sites: 6, required: 4, nodes: 2, jobs: 2, hauls: 2 });
    expect(TIER_QUOTA_PLANS.disk).toEqual({ sites: 6, required: 4, nodes: 3, jobs: 2, hauls: 1 });
    expect(TIER_QUOTA_PLANS.kernel).toEqual({ sites: 7, required: 5, nodes: 3, jobs: 2, hauls: 2 });
    expect(getQuotaPlan(2)).toBe(TIER_QUOTA_PLANS.cache);
  });

  it("vent tile: contract value 4, walkable, transparent", () => {
    expect(VENT_TILE).toBe(4);
    expect(TileKind.vent).toBe(VENT_TILE);
    expect(isVentTile(VENT_TILE)).toBe(true);
    expect(isVentTile(TileKind.floor)).toBe(false);
    expect(isWalkableTile(VENT_TILE)).toBe(true);
    expect(isOpaqueTile(VENT_TILE)).toBe(false);
  });
});
