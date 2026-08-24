import { amount, amountCompare } from "./amount";
import { applyAction } from "./actions";
import { buyHardware, buyResearch, computeBankedData, getKillCredits } from "./economy";
import { getHardwareCost, getMsPerTurn } from "./hardware";
import { deriveHeroStats } from "./hero";
import { createInitialGameState, createInitialHubState } from "./initialState";
import { researchDefinitions } from "./research";
import { endRun } from "./run";
import type { GameState } from "./types";

describe("economy", () => {
  it("hardware costs follow base × growth^n, rounded", () => {
    expect(getHardwareCost("clock", 0)).toEqual({ credits: "25", data: "0" });
    expect(getHardwareCost("clock", 1)).toEqual({ credits: "40", data: "0" });
    expect(getHardwareCost("cache", 2).credits).toBe("97"); // 30 × 1.8² = 97.2
    expect(getHardwareCost("cores", 1)).toEqual({ credits: "287", data: "3" }); // 140×2.05=287, 2×1.3=2.6
  });

  it("buying hardware spends credits and raises the level; unaffordable is a no-op", () => {
    const hub = { ...createInitialHubState(), credits: amount(100) };
    const bought = buyHardware(hub, "cache");
    expect(bought.hardware.cache).toBe(1);
    expect(bought.credits).toBe("70");
    const poor = createInitialHubState();
    expect(buyHardware(poor, "scheduler")).toBe(poor);
  });

  it("research costs Data and unlocks derived effects", () => {
    const hub = { ...createInitialHubState(), data: amount(25) };
    const withBounty = buyResearch(hub, "bugBounty");
    expect(withBounty.data).toBe("5");
    expect(withBounty.research.completed).toEqual(["bugBounty"]);
    expect(buyResearch(withBounty, "bugBounty")).toBe(withBounty);
    expect(deriveHeroStats(withBounty).killCreditMultiplier).toBe("1.25");
    expect(researchDefinitions).toHaveLength(15);
  });

  it("derived stats match the plan table", () => {
    const stats = deriveHeroStats(createInitialHubState());
    expect(stats.clockHz).toBeCloseTo(2.3, 10);
    expect(stats.attack).toBe(1);
    expect(stats.maxHp).toBe(8);
    expect(stats.heatDissipation).toBe(1);
    expect(stats.powerBudget).toBeCloseTo(10 / 1.7, 10);
    expect(getMsPerTurn(2.3, 1)).toBeCloseTo(2000 / 2.3, 2);
    expect(getMsPerTurn(2.3, 2)).toBeCloseTo((2000 * 1.35) / 2.3, 2);
  });

  it("kill credits scale 2 × 1.2^depth exactly", () => {
    expect(getKillCredits(1)).toBe("2.4");
    expect(getKillCredits(3)).toBe("3.456");
    expect(getKillCredits(1, "1.25")).toBe("3");
  });

  it("banks Data = floor(credits/10) + salvage + 5 × new depths", () => {
    expect(computeBankedData("37.9", 2, 2)).toBe("15");
    expect(computeBankedData("0", 0, 0)).toBe("0");
  });

  it("ending a run banks into the hub, updates stats, and arms the watchdog reboot", () => {
    let state: GameState = applyAction(createInitialGameState(1), { type: "deploy" });
    state = { ...state, run: { ...state.run!, credits: amount(55), kills: 4, salvageData: 1, maxDepthReached: 2 } };
    const ended = endRun(state, "test");
    expect(ended.run).toBeNull();
    expect(ended.hub.credits).toBe("65");
    expect(ended.hub.data).toBe("16"); // 5 + 1 + 10
    expect(ended.hub.stats).toEqual({ runs: 1, maxDepth: 2, totalKills: 4, lifetimeCredits: "55" });
    expect(ended.hub.rebootRemainingBits).toBeNull();
    expect(ended.hub.lastRunSummary?.newMaxDepth).toBe(true);

    const armed = endRun({ ...state, watchdog: { ...state.watchdog, ownedLevelId: "watchdogTimer" } }, "test");
    expect(armed.hub.rebootRemainingBits).toBe(16);
    expect(amountCompare(armed.hub.credits, 65)).toBe(0);
  });

  it("purchaseWatchdog requires research and credits, in order", () => {
    let state = createInitialGameState(2);
    expect(applyAction(state, { type: "purchaseWatchdog" })).toBe(state);
    state = { ...state, hub: { ...state.hub, credits: amount(100), research: { completed: ["watchdogTimer"] } } };
    const bought = applyAction(state, { type: "purchaseWatchdog" });
    expect(bought.watchdog.ownedLevelId).toBe("watchdogTimer");
    expect(bought.hub.credits).toBe("50");
    expect(applyAction(bought, { type: "purchaseWatchdog" })).toBe(bought);
  });
});
