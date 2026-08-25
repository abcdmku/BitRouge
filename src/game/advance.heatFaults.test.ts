import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import { toIndex } from "./board";
import { getPowerDrawW } from "./economy";
import { addTask, buildState, eventsOfKind, TICK } from "./testHelpers";

const heatAt = (state: ReturnType<typeof buildState>, x: number, y: number) =>
  state.run.board.sockets[toIndex(x, y, 5)].heat;

describe("heat", () => {
  it("ambient cooling decays heat toward zero", () => {
    const state = buildState({ seed: 1, clearBootCore: true });
    state.run.board.sockets[toIndex(2, 4, 5)].heat = 10;
    const later = advanceGame(state, 5_000, "foreground").state;
    expect(heatAt(later, 2, 4)).toBeLessThan(10);
  });

  it("diffuses heat into neighbors", () => {
    const state = buildState({ seed: 2, clearBootCore: true });
    state.run.board.sockets[toIndex(2, 4, 5)].heat = 80;
    const later = advanceGame(state, 3_000, "foreground").state;
    expect(heatAt(later, 2, 4)).toBeLessThan(80);
    expect(heatAt(later, 2, 3)).toBeGreaterThan(0);
    expect(heatAt(later, 1, 4)).toBeGreaterThan(0);
  });

  it("coolers pull 12 heat/s from self and neighbors", () => {
    const withCooler = buildState({
      seed: 3,
      railLevel: 2,
      reserveJ: 200,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cooler" }],
    });
    withCooler.run.board.sockets[toIndex(2, 3, 5)].heat = 60;
    const without = buildState({ seed: 3, clearBootCore: true });
    without.run.board.sockets[toIndex(2, 3, 5)].heat = 60;
    const cooled = advanceGame(withCooler, 2_000, "foreground").state;
    const baseline = advanceGame(without, 2_000, "foreground").state;
    expect(heatAt(cooled, 2, 3)).toBeLessThan(heatAt(baseline, 2, 3));
  });

  it("heat pipes firmware triples ambient cooling", () => {
    const piped = buildState({ seed: 4, clearBootCore: true });
    piped.run.system.firmware.push("heatPipes");
    piped.run.board.sockets[toIndex(2, 4, 5)].heat = 50;
    const plain = buildState({ seed: 4, clearBootCore: true });
    plain.run.board.sockets[toIndex(2, 4, 5)].heat = 50;
    const cooledPiped = advanceGame(piped, 4_000, "foreground").state;
    const cooledPlain = advanceGame(plain, 4_000, "foreground").state;
    expect(heatAt(cooledPiped, 2, 4)).toBeLessThan(heatAt(cooledPlain, 2, 4));
  });

  it("throttles packet flow at >= 70 heat (half rate) and emits transition events", () => {
    // A hot straight corridor: count deliveries against a cool baseline.
    const run = (hot: boolean) => {
      const state = buildState({ seed: 5, railLevel: 3, reserveJ: 1000 });
      if (hot) {
        // Keep the core socket permanently hot with a synthetic heat well.
        state.run.board.sockets[toIndex(2, 3, 5)].heat = 100;
        state.run.board.sockets[toIndex(2, 4, 5)].heat = 100;
        state.run.board.sockets[toIndex(2, 5, 5)].heat = 100;
      }
      for (let i = 0; i < 12; i += 1) addTask(state, "bulk", 1);
      const later = advanceGame(state, 10 * TICK, "foreground").state;
      return later.run.tasksDone;
    };
    const cool = run(false);
    const hot = run(true);
    expect(hot).toBeLessThan(cool);
  });

  it("rolls faults from the rng stream at >= 90 heat", () => {
    const state = buildState({
      seed: 6,
      railLevel: 2,
      reserveJ: 500,
      clearBootCore: true,
      chips: [
        { x: 0, y: 0, kind: "cache" },
        { x: 4, y: 0, kind: "cache" },
      ],
    });
    // Pin heat high by re-heating between advances; give the roll many seconds.
    let current = state;
    let faulted = false;
    for (let i = 0; i < 400 && !faulted; i += 1) {
      current.run.board.sockets[toIndex(0, 0, 5)].heat = 99;
      current.run.board.sockets[toIndex(4, 0, 5)].heat = 99;
      current = advanceGame(current, TICK, "foreground").state;
      faulted = current.run.board.sockets.some((s) => s.component?.faulted);
    }
    expect(faulted).toBe(true);
    expect(eventsOfKind(current, "faultSpawned").length).toBeGreaterThan(0);
  });

  it("never rolls faults below 90 heat", () => {
    const state = buildState({
      seed: 7,
      railLevel: 2,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 0, y: 0, kind: "cache" }],
    });
    let current = state;
    for (let i = 0; i < 200; i += 1) {
      current.run.board.sockets[toIndex(0, 0, 5)].heat = 89;
      current = advanceGame(current, TICK, "foreground").state;
    }
    expect(current.run.board.sockets.some((s) => s.component?.faulted)).toBe(false);
  });
});

describe("faults", () => {
  const faultedPair = () =>
    buildState({
      seed: 8,
      railLevel: 2,
      reserveJ: 500,
      clearBootCore: true,
      chips: [
        { x: 1, y: 1, kind: "cache", faulted: true },
        { x: 2, y: 1, kind: "cache" },
      ],
    });

  it("spreads to an adjacent chip after 30 s unpatched, costing 5 integrity", () => {
    const state = faultedPair();
    const later = advanceGame(state, 31_000, "foreground").state;
    const victim = later.run.board.sockets[toIndex(2, 1, 5)].component;
    expect(victim?.faulted).toBe(true);
    expect(later.run.damageLog.faultSpread).toBe(5);
    expect(eventsOfKind(later, "faultSpread")).toHaveLength(1);
  });

  it("does not spread before 30 s", () => {
    const state = faultedPair();
    const later = advanceGame(state, 29_000, "foreground").state;
    expect(later.run.board.sockets[toIndex(2, 1, 5)].component?.faulted).toBe(false);
  });

  it("watchdog auto-patches after 90 s and draws 2 W while pending", () => {
    // Isolated faulted chip: no neighbors to re-infect it after the patch.
    const state = buildState({
      seed: 8,
      clearBootCore: true,
      chips: [{ x: 0, y: 0, kind: "cache", faulted: true }],
    });
    state.run.system.firmware.push("watchdog");
    expect(getPowerDrawW(state.run)).toBe(2); // faulted chip 0 W + watchdog 2 W
    const later = advanceGame(state, 95_000, "foreground").state;
    const chip = later.run.board.sockets[toIndex(0, 0, 5)].component;
    expect(chip?.faulted).toBe(false);
    expect(later.run.board.sockets[toIndex(0, 0, 5)].heat).toBeLessThanOrEqual(50);
    expect(eventsOfKind(later, "faultPatched").some((e) => !e.manual)).toBe(true);
    expect(getPowerDrawW(later.run)).toBe(3); // patched cache draws its 3 W again
  });

  it("unpatched neighbors re-infect a patched chip at their own 30 s marks", () => {
    const state = faultedPair();
    state.run.system.firmware.push("watchdog");
    const later = advanceGame(state, 95_000, "foreground").state;
    // The watchdog patched the original at 90 s, but the spread victim
    // (faulted at ~30 s, unpatched) spread back at its next 30 s boundary.
    expect(eventsOfKind(later, "faultPatched").some((e) => !e.manual)).toBe(true);
    const chips = [toIndex(1, 1, 5), toIndex(2, 1, 5)].map(
      (index) => later.run.board.sockets[index].component,
    );
    expect(chips.some((chip) => chip?.faulted)).toBe(true);
  });

  it("without watchdog the fault keeps spreading", () => {
    const state = faultedPair();
    const later = advanceGame(state, 95_000, "foreground").state;
    expect(later.run.board.sockets[toIndex(1, 1, 5)].component?.faulted).toBe(true);
  });
});
