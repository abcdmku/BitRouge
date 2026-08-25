import { describe, expect, it } from "vitest";
import { amountToNumber } from "./amount";
import { applyAction } from "./actions";
import { toIndex } from "./board";
import { LIVE_PACKET_CAP } from "./economy";
import { createInitialGameState } from "./initialState";
import { addPacket, addTask, buildState, eventsOfKind } from "./testHelpers";

const at = (x: number, y: number) => toIndex(x, y, 5);

describe("manual WORK (workSocket)", () => {
  it("hand-pulls a task into a ready core at zero power", () => {
    const state = buildState({ seed: 1 }); // 0 W generation — hands only
    addTask(state, "bulk", 2);
    const next = applyAction(state, { type: "workSocket", index: at(2, 3) });
    expect(next).not.toBe(state);
    expect(next.run.backlog).toHaveLength(0);
    expect(next.run.board.packets).toHaveLength(1);
    expect(next.run.system.reserveJ).toBe(state.run.system.reserveJ); // zero power
    expect(eventsOfKind(next, "workTap")).toHaveLength(1);
  });

  it("advances a packet one hop instantly", () => {
    const state = buildState({ seed: 2, clearBootCore: true });
    addPacket(state, 2, 4, 3);
    const next = applyAction(state, { type: "workSocket", index: at(2, 4) });
    expect(next.run.board.packets[0].socketIndex).toBe(at(2, 5));
  });

  it("pays ×1.5 when the delivery hop is manual", () => {
    const state = buildState({ seed: 3, clearBootCore: true });
    addPacket(state, 2, 5, 2);
    const next = applyAction(state, { type: "workSocket", index: at(2, 5) });
    expect(next.run.board.packets).toHaveLength(0);
    expect(amountToNumber(next.run.credits)).toBe(3); // 2 × 1.5
    expect(next.run.tasksDone).toBe(1);
  });

  it("halves heat on manual hops (cache pass +4 instead of +8)", () => {
    const state = buildState({
      seed: 4,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cache" }],
    });
    addPacket(state, 2, 3, 2);
    const next = applyAction(state, { type: "workSocket", index: at(2, 3) });
    expect(next.run.board.sockets[at(2, 4)].heat).toBe(4);
    expect(amountToNumber(next.run.board.packets[0].value)).toBe(4); // full ×2 value
  });

  it("manual hops are hop-cap-free", () => {
    const state = buildState({ seed: 5, clearBootCore: true });
    addPacket(state, 2, 3, 1);
    state.run.board.packets[0].hops = 31;
    const next = applyAction(state, { type: "workSocket", index: at(2, 3) });
    expect(next.run.board.packets).toHaveLength(1); // no hop-limit drop
    expect(next.run.board.packets[0].hops).toBe(31);
  });

  it("hand-pulls ignore the live packet cap", () => {
    const state = buildState({ seed: 6 });
    state.run.board.sockets[at(0, 0)].dir = "N";
    for (let i = 0; i < LIVE_PACKET_CAP; i += 1) {
      const packet = addPacket(state, 0, 0, 1);
      packet.socketIndex = at(0, 0);
    }
    addTask(state, "bulk", 1);
    const next = applyAction(state, { type: "workSocket", index: at(2, 3) });
    expect(next.run.backlog).toHaveLength(0); // pulled despite the cap
  });

  it("patches a fault and sets heat to 50", () => {
    const state = buildState({
      seed: 7,
      chips: [{ x: 1, y: 1, kind: "cache", faulted: true }],
    });
    state.run.board.sockets[at(1, 1)].heat = 96;
    const next = applyAction(state, { type: "workSocket", index: at(1, 1) });
    expect(next.run.board.sockets[at(1, 1)].component?.faulted).toBe(false);
    expect(next.run.board.sockets[at(1, 1)].heat).toBe(50);
    expect(eventsOfKind(next, "faultPatched").some((e) => e.manual)).toBe(true);
  });

  it("no-ops on locked or empty-idle sockets", () => {
    const state = buildState({ seed: 8 });
    expect(applyAction(state, { type: "workSocket", index: at(0, 0) })).toBe(state);
    expect(applyAction(state, { type: "workSocket", index: at(2, 4) })).toBe(state);
    expect(applyAction(state, { type: "workSocket", index: 999 })).toBe(state);
  });
});

describe("board editing actions", () => {
  it("rotateSocket cycles N→E→S→W on unlocked sockets", () => {
    const state = buildState({ seed: 9 });
    const index = at(2, 4);
    let current = state;
    const seen: string[] = [current.run.board.sockets[index].dir];
    for (let i = 0; i < 4; i += 1) {
      current = applyAction(current, { type: "rotateSocket", index });
      seen.push(current.run.board.sockets[index].dir);
    }
    expect(seen).toEqual(["S", "W", "N", "E", "S"]);
    expect(applyAction(state, { type: "rotateSocket", index: at(0, 0) })).toBe(state); // locked
    expect(applyAction(state, { type: "rotateSocket", index: at(2, 6) })).toBe(state); // port
  });

  it("unlockSocket charges the escalating unlock curve", () => {
    const state = buildState({ seed: 10, credits: 100 });
    const first = applyAction(state, { type: "unlockSocket", index: at(1, 5) });
    expect(first.run.board.sockets[at(1, 5)].unlocked).toBe(true);
    expect(amountToNumber(first.run.credits)).toBeCloseTo(96, 5); // 4 cr
    const second = applyAction(first, { type: "unlockSocket", index: at(3, 5) });
    expect(amountToNumber(second.run.credits)).toBeCloseTo(96 - 5.4, 5); // 4 × 1.35
    const broke = buildState({ seed: 10, credits: 1 });
    expect(applyAction(broke, { type: "unlockSocket", index: at(1, 5) })).toBe(broke);
  });

  it("placeComponent pays the owned-count curve (boot core is free)", () => {
    const state = buildState({ seed: 11, credits: 1000, unlockAll: true });
    const second = applyAction(state, { type: "placeComponent", index: at(1, 5), kind: "core" });
    expect(amountToNumber(second.run.credits)).toBe(985); // second core: 15
    const third = applyAction(second, { type: "placeComponent", index: at(3, 5), kind: "core" });
    expect(amountToNumber(third.run.credits)).toBe(985 - 45); // 15 × 3
    expect(eventsOfKind(third, "chipPlaced")).toHaveLength(2); // ring keeps both placements
    // Occupied socket and gen-gated GPU both refuse.
    expect(applyAction(third, { type: "placeComponent", index: at(1, 5), kind: "cache" })).toBe(third);
    expect(applyAction(third, { type: "placeComponent", index: at(0, 0), kind: "gpu" })).toBe(third);
  });

  it("upgradeComponent charges 0.6×base×1.15^(level-1); CACHE tier II is gen-gated", () => {
    const state = buildState({ seed: 12, credits: 1000, chips: [{ x: 1, y: 5, kind: "cache" }] });
    const coreUp = applyAction(state, { type: "upgradeComponent", index: at(2, 3) });
    expect(amountToNumber(coreUp.run.credits)).toBe(991); // 15 × 0.6 = 9
    expect(coreUp.run.board.sockets[at(2, 3)].component?.level).toBe(2);
    // gen 1: cache upgrade refused
    expect(applyAction(state, { type: "upgradeComponent", index: at(1, 5) })).toBe(state);
    const gen2 = buildState({ seed: 12, credits: 1000, chips: [{ x: 1, y: 5, kind: "cache" }] });
    gen2.meta.architecture.push("gen2");
    gen2.meta.gen = 2;
    const cacheUp = applyAction(gen2, { type: "upgradeComponent", index: at(1, 5) });
    expect(amountToNumber(cacheUp.run.credits)).toBe(976); // 40 × 0.6 = 24
  });

  it("sellComponent refunds 50%, or 100% with Hot-Swap", () => {
    const state = buildState({ seed: 13, credits: 0, chips: [{ x: 1, y: 5, kind: "cache" }] });
    const sold = applyAction(state, { type: "sellComponent", index: at(1, 5) });
    expect(amountToNumber(sold.run.credits)).toBe(20); // 40 / 2
    expect(sold.run.board.sockets[at(1, 5)].component).toBeNull();
    const swap = buildState({ seed: 13, credits: 0, chips: [{ x: 1, y: 5, kind: "cache" }] });
    swap.run.system.firmware.push("hotSwap");
    const soldFull = applyAction(swap, { type: "sellComponent", index: at(1, 5) });
    expect(amountToNumber(soldFull.run.credits)).toBe(40);
  });

  it("togglePower flips the powered flag", () => {
    const state = buildState({ seed: 14 });
    const off = applyAction(state, { type: "togglePower", index: at(2, 3) });
    expect(off.run.board.sockets[at(2, 3)].component?.powered).toBe(false);
    const on = applyAction(off, { type: "togglePower", index: at(2, 3) });
    expect(on.run.board.sockets[at(2, 3)].component?.powered).toBe(true);
  });
});

describe("system, firmware and arch purchases", () => {
  it("buySystem rail: 12 cr then 50, 100…", () => {
    const state = buildState({ seed: 15, credits: 200 });
    const one = applyAction(state, { type: "buySystem", item: "rail" });
    expect(one.run.system.railLevel).toBe(1);
    expect(amountToNumber(one.run.credits)).toBe(188);
    const two = applyAction(one, { type: "buySystem", item: "rail" });
    expect(amountToNumber(two.run.credits)).toBe(138);
  });

  it("buySystem capacitor and clock follow their curves", () => {
    const state = buildState({ seed: 16, credits: 200 });
    const cap = applyAction(state, { type: "buySystem", item: "capacitor" });
    expect(cap.run.system.capacitorLevel).toBe(1);
    expect(amountToNumber(cap.run.credits)).toBe(160);
    const clock = applyAction(cap, { type: "buySystem", item: "clock" });
    expect(clock.run.system.clockLevel).toBe(1);
    expect(amountToNumber(clock.run.credits)).toBe(130);
  });

  it("buyFirmware spends Data once per firmware", () => {
    const state = buildState({ seed: 17 });
    state.run.data = "25" as typeof state.run.data;
    const bought = applyAction(state, { type: "buyFirmware", id: "watchdog" });
    expect(bought.run.system.firmware).toEqual(["watchdog"]);
    expect(amountToNumber(bought.run.data)).toBe(0);
    expect(applyAction(bought, { type: "buyFirmware", id: "watchdog" })).toBe(bought);
    expect(applyAction(bought, { type: "buyFirmware", id: "hotSwap" })).toBe(bought); // broke
  });

  it("buyArch validates cost, prerequisites and repeatability", () => {
    const state = createInitialGameState(18);
    expect(applyAction(state, { type: "buyArch", id: "startKit" })).toBe(state); // 0 Si
    const rich = { ...state, meta: { ...state.meta, silicon: 100 } };
    expect(applyAction(rich, { type: "buyArch", id: "gen3" })).toBe(rich); // needs gen2
    const gen2 = applyAction(rich, { type: "buyArch", id: "gen2" });
    expect(gen2.meta.gen).toBe(2);
    expect(gen2.meta.silicon).toBe(85);
    const gen3 = applyAction(gen2, { type: "buyArch", id: "gen3" });
    expect(gen3.meta.gen).toBe(3);
    expect(applyAction(gen3, { type: "buyArch", id: "gen2" })).toBe(gen3); // owned
    const stacked = applyAction(gen3, { type: "buyArch", id: "baseValue20" });
    const stackedTwice = applyAction(stacked, { type: "buyArch", id: "baseValue20" });
    expect(stackedTwice.meta.architecture.filter((p) => p === "baseValue20")).toHaveLength(2);
    // Second copy costs 8 × 1.6 = 13 (rounded).
    expect(stacked.meta.silicon - stackedTwice.meta.silicon).toBe(13);
  });

  it("recordSave / recordDeparture / reset behave", () => {
    const state = createInitialGameState(19);
    const departed = applyAction(state, { type: "recordDeparture", timestampMs: 5000 });
    expect(departed.departedAtMs).toBe(5000);
    const saved = applyAction(departed, { type: "recordSave", timestampMs: 6000 });
    expect(saved.savedAtMs).toBe(6000);
    expect(saved.departedAtMs).toBeNull();
    const wiped = applyAction(saved, { type: "reset" });
    expect(wiped.savedAtMs).toBeNull();
    expect(wiped.meta.reflows).toBe(0);
    expect(wiped.run.uptimeMs).toBe(0);
  });

  it("board-editing actions are ignored while crashed", () => {
    const crashed = buildState({ seed: 20, integrity: 0, credits: 1000 });
    expect(applyAction(crashed, { type: "workSocket", index: at(2, 3) })).toBe(crashed);
    expect(applyAction(crashed, { type: "buySystem", item: "rail" })).toBe(crashed);
    expect(applyAction(crashed, { type: "rotateSocket", index: at(2, 4) })).toBe(crashed);
  });
});
