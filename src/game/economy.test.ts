import { describe, expect, it } from "vitest";
import { amountToNumber } from "./amount";
import {
  getArrivalIntervalMs,
  getBacklogCap,
  getCacheMultiplier,
  getCapacitorCost,
  getClockCost,
  getComponentCost,
  getCoreMultiplier,
  getEffectiveTickMs,
  getGenerationW,
  getGenFromArchitecture,
  getGpuMultiplier,
  getMaxIntegrity,
  getRailCost,
  getReserveMaxJ,
  getSellRefund,
  getSiliconPayout,
  getSocketUnlockCost,
  getTaskValue,
  getUpgradeCost,
  rollTaskKind,
  TASK_MIX_BY_GEN,
} from "./economy";

const n = (value: string) => amountToNumber(value);

describe("economy curves", () => {
  it("tick: 500 / (1 + 0.25 × clockLevel)", () => {
    expect(getEffectiveTickMs(0)).toBe(500);
    expect(getEffectiveTickMs(1)).toBe(400);
    expect(getEffectiveTickMs(2)).toBeCloseTo(333.333, 2);
  });

  it("escalation: 6000 × 0.97^U × 0.9^(gen-1)", () => {
    expect(getArrivalIntervalMs(0, 1)).toBe(6000);
    expect(getArrivalIntervalMs(60_000, 1)).toBeCloseTo(6000 * 0.97, 6);
    expect(getArrivalIntervalMs(10 * 60_000, 1)).toBeCloseTo(6000 * Math.pow(0.97, 10), 5);
    expect(getArrivalIntervalMs(0, 2)).toBeCloseTo(5400, 6);
    expect(getArrivalIntervalMs(0, 4)).toBeCloseTo(6000 * Math.pow(0.9, 3), 6);
  });

  it("task value: 1.05^U with kind multipliers and +20% arch stacks", () => {
    expect(n(getTaskValue(0, "bulk", []))).toBe(1);
    expect(n(getTaskValue(0, "crunch", []))).toBe(3);
    expect(n(getTaskValue(0, "hot", []))).toBe(2);
    expect(n(getTaskValue(0, "priority", []))).toBe(5);
    expect(n(getTaskValue(10 * 60_000, "bulk", []))).toBeCloseTo(
      Math.round(Math.pow(1.05, 10) * 10) / 10,
      6,
    );
    expect(n(getTaskValue(0, "bulk", ["baseValue20", "baseValue20"]))).toBeCloseTo(1.4, 6);
  });

  it("gen mixes sum to 1 and gate kinds by generation", () => {
    for (const gen of [1, 2, 3, 4]) {
      const mix = TASK_MIX_BY_GEN[gen];
      expect(mix.bulk + mix.crunch + mix.hot + mix.priority).toBeCloseTo(1, 9);
    }
    expect(rollTaskKind(1, 0.99)).toBe("bulk");
    expect(rollTaskKind(2, 0.8)).toBe("crunch");
    expect(rollTaskKind(3, 0.9)).toBe("hot");
    expect(rollTaskKind(4, 0.95)).toBe("priority");
  });

  it("component costs: base × growth^(owned-1), boot core free", () => {
    expect(n(getComponentCost("core", 1))).toBe(15); // second core
    expect(n(getComponentCost("core", 2))).toBe(45);
    expect(n(getComponentCost("cache", 0))).toBe(40);
    expect(n(getComponentCost("cache", 1))).toBe(76);
    expect(n(getComponentCost("cooler", 0))).toBe(25);
    expect(n(getComponentCost("miner", 0))).toBe(100);
    expect(n(getComponentCost("gpu", 0))).toBe(500);
  });

  it("upgrade cost 0.6× base × 1.15^(level-1); sell refunds 50%", () => {
    expect(n(getUpgradeCost("core", 1))).toBe(9);
    expect(n(getUpgradeCost("core", 2))).toBeCloseTo(10.4, 6);
    expect(n(getSellRefund("cache", 1, 1, false))).toBe(20);
    expect(n(getSellRefund("cache", 1, 1, true))).toBe(40);
    expect(n(getSellRefund("cache", 1, 2, false))).toBe(32); // + upgrade 24 / 2
  });

  it("multipliers: core ×2 per level, cache/gpu +25% per level", () => {
    expect(getCoreMultiplier(1)).toBe(1);
    expect(getCoreMultiplier(3)).toBe(4);
    expect(getCacheMultiplier(1)).toBe(2);
    expect(getCacheMultiplier(2)).toBe(2.5);
    expect(getGpuMultiplier(1)).toBe(4);
    expect(getGpuMultiplier(2)).toBe(5);
  });

  it("socket unlock 4 × 1.35^(n-3), rails 12 then 50×2^(n-2)", () => {
    expect(n(getSocketUnlockCost(3))).toBe(4);
    expect(n(getSocketUnlockCost(4))).toBeCloseTo(5.4, 6);
    expect(n(getRailCost(1))).toBe(12);
    expect(n(getRailCost(2))).toBe(50);
    expect(n(getRailCost(3))).toBe(100);
    expect(n(getCapacitorCost(1))).toBe(40);
    expect(n(getCapacitorCost(2))).toBe(76);
    expect(n(getClockCost(1))).toBe(30);
    expect(n(getClockCost(2))).toBe(54);
  });

  it("power: 6 W per rail (×2 dual rail), reserve 100 × 1.6^cap × 1.5^perk", () => {
    expect(getGenerationW(0, [])).toBe(0);
    expect(getGenerationW(2, [])).toBe(12);
    expect(getGenerationW(2, ["dualRail"])).toBe(24);
    expect(getReserveMaxJ(0, [])).toBe(100);
    expect(getReserveMaxJ(1, [])).toBeCloseTo(160, 6);
    expect(getReserveMaxJ(1, ["reserve150"])).toBeCloseTo(240, 6);
  });

  it("silicon payout is superlinear: two 20-min runs ≈ 10 Si, one 40-min ≈ 19 Si", () => {
    expect(getSiliconPayout(20 * 60_000, 0)).toBe(5);
    expect(getSiliconPayout(40 * 60_000, 0)).toBe(19);
    expect(getSiliconPayout(40 * 60_000, 450)).toBe(21); // + floor(450/200)
    expect(getSiliconPayout(12 * 60_000, 0)).toBeGreaterThanOrEqual(2);
  });

  it("gen, backlog cap and max integrity derive from architecture", () => {
    expect(getGenFromArchitecture([])).toBe(1);
    expect(getGenFromArchitecture(["gen2", "gen3"])).toBe(3);
    expect(getBacklogCap([])).toBe(12);
    expect(getBacklogCap(["eastPort"])).toBe(16);
    expect(getMaxIntegrity([])).toBe(100);
    expect(getMaxIntegrity(["integrity25"])).toBe(125);
  });
});
