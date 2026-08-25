import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { toIndex } from "./board";
import { getSiliconPayout } from "./economy";
import { createInitialGameState } from "./initialState";
import { buildState } from "./testHelpers";

describe("reflow and silicon", () => {
  it("pays superlinear silicon: pushing 2× longer pays ~3.5×", () => {
    const twenty = getSiliconPayout(20 * 60_000, 0);
    const forty = getSiliconPayout(40 * 60_000, 0);
    expect(forty).toBeGreaterThanOrEqual(Math.floor(twenty * 3.4));
    expect(forty).toBeLessThanOrEqual(twenty * 4);
  });

  it("refuses voluntary reflow before 10 minutes of uptime", () => {
    const young = buildState({ seed: 1, uptimeMs: 9 * 60_000 });
    expect(applyAction(young, { type: "reflow" })).toBe(young);
  });

  it("allows voluntary reflow after 10 minutes", () => {
    const state = buildState({ seed: 2, uptimeMs: 12 * 60_000 });
    state.run.tasksDone = 250;
    const after = applyAction(state, { type: "reflow" });
    expect(after).not.toBe(state);
    expect(after.meta.silicon).toBe(getSiliconPayout(12 * 60_000, 250));
    expect(after.meta.reflows).toBe(1);
    expect(after.meta.bestUptimeMs).toBe(12 * 60_000);
    expect(after.run.uptimeMs).toBe(0);
  });

  it("crash reflow works at any uptime and resets the run but not meta", () => {
    const crashed = buildState({ seed: 3, uptimeMs: 3 * 60_000, integrity: 0, credits: 999 });
    crashed.meta.totalTasks = 42;
    const after = applyAction(crashed, { type: "reflow" });
    expect(after).not.toBe(crashed);
    expect(after.run.integrity).toBeGreaterThan(0);
    expect(after.run.credits).toBe("999"); // workshop currency persists
    expect(after.run.backlog).toHaveLength(0);
    expect(after.run.system.railLevel).toBe(0);
    expect(after.meta.totalTasks).toBe(42); // stats persist
  });

  it("fresh runs honor arch perks: startKit grants RAIL I + 6 sockets", () => {
    const state = createInitialGameState(4);
    const rich = { ...state, meta: { ...state.meta, silicon: 100 } };
    const kitted = applyAction(rich, { type: "buyArch", id: "startKit" });
    const crashed = {
      ...kitted,
      run: { ...kitted.run, integrity: 0, uptimeMs: 60_000 },
    };
    const fresh = applyAction(crashed, { type: "reflow" });
    expect(fresh.run.system.railLevel).toBe(1);
    const unlocked = fresh.run.board.sockets.filter((socket) => socket.unlocked);
    expect(unlocked).toHaveLength(7); // 6 sockets + the PORT cell
  });

  it("board5x8 grows the next board and eastPort adds a second port", () => {
    const state = createInitialGameState(5);
    let rich = { ...state, meta: { ...state.meta, silicon: 100 } };
    rich = applyAction(rich, { type: "buyArch", id: "board5x8" });
    rich = applyAction(rich, { type: "buyArch", id: "eastPort" });
    rich.run.board.sockets[toIndex(2, 4, 5)].unlocked = true;
    rich.run.board.sockets[toIndex(2, 4, 5)].component = {
      kind: "cache",
      level: 2,
      powered: true,
      faulted: true,
      faultAgeMs: 500,
    };
    const crashed = { ...rich, run: { ...rich.run, integrity: 0, uptimeMs: 60_000 } };
    const fresh = applyAction(crashed, { type: "reflow" });
    expect(fresh.run.board.height).toBe(8);
    expect(fresh.run.board.sockets).toHaveLength(40);
    // South port on the new bottom row, east port mid-east.
    expect(fresh.run.board.sockets[toIndex(2, 7, 5)].unlocked).toBe(true);
    expect(fresh.run.board.sockets[toIndex(4, 3, 5)].unlocked).toBe(true);
    expect(fresh.run.board.sockets[toIndex(2, 5, 5)].component).toMatchObject({
      kind: "cache",
      level: 2,
      faulted: false,
    });
  });

  it("integrity25 raises the fresh run's starting integrity", () => {
    const state = createInitialGameState(6);
    const rich = { ...state, meta: { ...state.meta, silicon: 100 } };
    const perked = applyAction(rich, { type: "buyArch", id: "integrity25" });
    const crashed = { ...perked, run: { ...perked.run, integrity: 0, uptimeMs: 60_000 } };
    const fresh = applyAction(crashed, { type: "reflow" });
    expect(fresh.run.integrity).toBe(125);
  });
});
