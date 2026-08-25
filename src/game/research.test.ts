import { describe, expect, it } from "vitest";
import { amount, amountToNumber } from "./amount";
import { applyAction } from "./actions";
import { toIndex } from "./board";
import { createInitialGameState } from "./initialState";
import {
  canAdvanceClock,
  getAutomationBufferMs,
  getClockRateLabel,
  getCpuTier,
  researchDefinitions,
} from "./research";

const queueJob = (state: ReturnType<typeof createInitialGameState>, id: number) => {
  state.run.backlog.push({ id, kind: "bulk", value: amount(1), deadlineMs: null });
};

describe("research progression", () => {
  it("keeps the IdleBit opening order and tier costs", () => {
    expect(researchDefinitions.decodeLogic.creditCost).toBe("3");
    expect(researchDefinitions.cacheMapping.dataCost).toBe("2");
    expect(researchDefinitions.multiCore.requires).toEqual(["benchmarkHarness"]);
    expect(researchDefinitions.localScheduler.requires).toEqual(["multiCore"]);
    expect(researchDefinitions.cpuTierKhz.creditCost).toBe("2000000");
    expect(researchDefinitions.cpuTierMhz.creditCost).toBe("20000000000");
    expect(researchDefinitions.cpuTierGhz.creditCost).toBe("200000000000000");
  });

  it("spends exact resources and advances R&D with completed jobs", () => {
    let state = createInitialGameState(31);
    state.run.credits = amount(3);
    state = applyAction(state, { type: "startResearch", id: "decodeLogic" });
    expect(state.run.credits).toBe("0");
    expect(state.meta.research.active).toEqual({ id: "decodeLogic", workDone: 0 });

    for (let id = 1; id <= 4; id += 1) {
      queueJob(state, id);
      state = applyAction(state, { type: "pulseSystem" });
    }

    expect(state.run.tasksDone).toBe(4);
    expect(state.meta.research.active).toBeNull();
    expect(state.meta.research.completed).toEqual(["decodeLogic"]);
  });

  it("enforces dependencies and one active project", () => {
    const state = createInitialGameState(32);
    state.run.credits = amount(1_000);
    state.run.data = amount(100);
    expect(applyAction(state, { type: "startResearch", id: "cacheMapping" })).toBe(state);

    const decoding = applyAction(state, { type: "startResearch", id: "decodeLogic" });
    expect(applyAction(decoding, { type: "startResearch", id: "benchmarkHarness" })).toBe(
      decoding,
    );
  });

  it("turns scheduler research into 2 hour and 12 hour offline buffers", () => {
    const state = createInitialGameState(33);
    expect(getAutomationBufferMs(state)).toBe(0);
    state.meta.research.completed.push("localScheduler");
    expect(getAutomationBufferMs(state)).toBe(2 * 60 * 60 * 1_000);
    state.meta.research.completed.push("systemScheduler");
    expect(getAutomationBufferMs(state)).toBe(12 * 60 * 60 * 1_000);
  });

  it("gates fixed blueprint installs behind their research", () => {
    const state = createInitialGameState(34);
    state.run.credits = amount(1_000);
    expect(applyAction(state, { type: "installComponent", kind: "cache" })).toBe(state);

    state.meta.research.completed.push("cacheMapping");
    const installed = applyAction(state, { type: "installComponent", kind: "cache" });
    const index = toIndex(2, 4, 5);
    expect(installed.run.board.sockets[index].component?.kind).toBe("cache");
    expect(installed.run.board.sockets[index].unlocked).toBe(true);
    expect(amountToNumber(installed.run.credits)).toBe(960);
  });

  it("moves from Hz through researched kHz, MHz, and GHz tiers", () => {
    let state = createInitialGameState(35);
    state.run.credits = amount("1000000000000000000");
    for (let level = 0; level < 11; level += 1) {
      state = applyAction(state, { type: "buySystem", item: "clock" });
    }
    expect(getCpuTier(state.run.system.clockLevel)).toEqual({ tier: "Hz", level: 12 });
    expect(canAdvanceClock(state)).toBe(false);
    expect(applyAction(state, { type: "buySystem", item: "clock" })).toBe(state);

    state.meta.research.completed.push("cpuTierKhz");
    state = applyAction(state, { type: "buySystem", item: "clock" });
    expect(getCpuTier(state.run.system.clockLevel)).toEqual({ tier: "kHz", level: 1 });
    expect(getClockRateLabel(state.run.system.clockLevel)).toBe("1.0 kHz");
  });
});
