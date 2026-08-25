import { describe, expect, it } from "vitest";
import { amountToNumber } from "./amount";
import { advanceGame } from "./advance";
import { toIndex } from "./board";
import { getDuty } from "./economy";
import { createInitialGameState } from "./initialState";
import { deriveRenderSnapshot } from "./renderSnapshot";
import { deriveVisibleState } from "./selectors";
import { addPacket, addTask, buildState, eventsOfKind, TICK } from "./testHelpers";

// Board is 5×7; PORT at (2,6); boot column (2,3..5) unlocked with dir S.

describe("board tick", () => {
  it("moves packets one socket per tick toward the port and pays on delivery", () => {
    const state = buildState({ seed: 1, railLevel: 2, reserveJ: 100, clearBootCore: true });
    addPacket(state, 2, 4, 8);
    const one = advanceGame(state, TICK, "foreground").state;
    expect(one.run.board.packets[0].socketIndex).toBe(toIndex(2, 5, 5));
    const two = advanceGame(one, TICK, "foreground").state;
    expect(two.run.board.packets).toHaveLength(0);
    expect(amountToNumber(two.run.credits)).toBe(8);
    expect(two.run.tasksDone).toBe(1);
    expect(eventsOfKind(two, "packetDelivered")).toHaveLength(1);
  });

  it("jams: a packet waits when its target socket is occupied, then flows chain-wise", () => {
    const state = buildState({ seed: 2, railLevel: 2, reserveJ: 100, clearBootCore: true });
    const rear = addPacket(state, 2, 3, 1); // oldest
    const front = addPacket(state, 2, 4, 1);
    // Oldest-first: rear tries (2,4) still occupied at its turn? No — front is
    // younger, so rear moves first only if the slot is free. Front vacates
    // after rear's attempt, so rear stalls exactly one tick.
    const one = advanceGame(state, TICK, "foreground").state;
    const packets = one.run.board.packets;
    expect(packets.find((p) => p.id === rear.id)?.socketIndex).toBe(toIndex(2, 3, 5));
    expect(packets.find((p) => p.id === front.id)?.socketIndex).toBe(toIndex(2, 5, 5));
    const two = advanceGame(one, TICK, "foreground").state;
    expect(two.run.board.packets.find((p) => p.id === rear.id)?.socketIndex).toBe(
      toIndex(2, 4, 5),
    );
  });

  it("does not move packets into locked sockets", () => {
    const state = buildState({ seed: 3, railLevel: 2, reserveJ: 100, clearBootCore: true });
    const packet = addPacket(state, 2, 4, 1);
    state.run.board.sockets[toIndex(2, 4, 5)].dir = "E"; // (3,4) is locked
    const next = advanceGame(state, TICK, "foreground").state;
    expect(next.run.board.packets[0].socketIndex).toBe(packet.socketIndex);
    expect(next.run.board.packets[0].hops).toBe(0); // stalls don't count hops
  });

  it("drops looping packets after 32 hops with +10 heat (loop penalty)", () => {
    // 2×2 arrow loop among unlocked sockets far from the port.
    const state = buildState({
      seed: 4,
      railLevel: 4,
      reserveJ: 1000,
      clearBootCore: true,
      unlock: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      dirs: [
        { x: 0, y: 0, dir: "E" },
        { x: 1, y: 0, dir: "S" },
        { x: 1, y: 1, dir: "W" },
        { x: 0, y: 1, dir: "N" },
      ],
    });
    addPacket(state, 0, 0, 1);
    const done = advanceGame(state, 33 * TICK, "foreground").state;
    expect(done.run.board.packets).toHaveLength(0);
    const drops = eventsOfKind(done, "packetDropped");
    expect(drops).toHaveLength(1);
    expect(drops[0].reason).toBe("hopLimit");
    expect(done.run.integrity).toBeGreaterThan(99); // loop drop costs heat, not integrity
  });

  it("cores pull from the backlog and emit onto their own socket", () => {
    const state = buildState({ seed: 5, railLevel: 2, reserveJ: 100 });
    addTask(state, "bulk", 4);
    const next = advanceGame(state, TICK, "foreground").state;
    expect(next.run.backlog).toHaveLength(0);
    expect(next.run.board.packets).toHaveLength(1);
    expect(next.run.board.packets[0].socketIndex).toBe(toIndex(2, 3, 5));
    expect(amountToNumber(next.run.board.packets[0].value)).toBe(4);
  });

  it("a level-2 core doubles emitted value", () => {
    const state = buildState({ seed: 6, railLevel: 2, reserveJ: 100 });
    state.run.board.sockets[toIndex(2, 3, 5)].component!.level = 2;
    addTask(state, "bulk", 4);
    const next = advanceGame(state, TICK, "foreground").state;
    expect(amountToNumber(next.run.board.packets[0].value)).toBe(8);
  });

  it("caches multiply ×2 once per distinct cache and add pass heat", () => {
    const state = buildState({
      seed: 7,
      railLevel: 3,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cache" }],
    });
    addPacket(state, 2, 3, 5);
    const one = advanceGame(state, TICK, "foreground").state;
    const packet = one.run.board.packets[0];
    expect(packet.socketIndex).toBe(toIndex(2, 4, 5));
    expect(amountToNumber(packet.value)).toBe(10);
    expect(one.run.board.sockets[toIndex(2, 4, 5)].heat).toBeGreaterThan(0);
    // Loop it back through the same cache: no second multiplication.
    const draft = one;
    draft.run.board.sockets[toIndex(2, 4, 5)].dir = "N";
    draft.run.board.sockets[toIndex(2, 3, 5)].dir = "S";
    const three = advanceGame(draft, 2 * TICK, "foreground").state;
    const looped = three.run.board.packets[0];
    expect(amountToNumber(looped.value)).toBe(10);
  });

  it("powered-off chips conduct as bare trace with no effect", () => {
    const state = buildState({
      seed: 8,
      railLevel: 3,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cache", powered: false }],
    });
    addPacket(state, 2, 3, 5);
    const one = advanceGame(state, TICK, "foreground").state;
    expect(amountToNumber(one.run.board.packets[0].value)).toBe(5);
  });

  it("faulted chips stop conducting: packets cannot enter", () => {
    const state = buildState({
      seed: 9,
      railLevel: 3,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cache", faulted: true }],
    });
    addPacket(state, 2, 3, 5);
    const one = advanceGame(state, TICK, "foreground").state;
    expect(one.run.board.packets[0].socketIndex).toBe(toIndex(2, 3, 5));
  });

  it("miners consume packets into Data = floor(value / 4)", () => {
    const state = buildState({
      seed: 10,
      railLevel: 3,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "miner" }],
    });
    addPacket(state, 2, 3, 9);
    const one = advanceGame(state, TICK, "foreground").state;
    expect(one.run.board.packets).toHaveLength(0);
    expect(amountToNumber(one.run.data)).toBe(2);
    expect(one.run.tasksDone).toBe(1);
  });

  it("raw CRUNCH deliveries drop and cost integrity", () => {
    const state = buildState({ seed: 11, railLevel: 3, reserveJ: 500, clearBootCore: true });
    addPacket(state, 2, 5, 6, "crunch");
    const one = advanceGame(state, TICK, "foreground").state;
    expect(one.run.board.packets).toHaveLength(0);
    expect(amountToNumber(one.run.credits)).toBe(0);
    expect(one.run.integrity).toBeLessThan(100);
    expect(one.run.damageLog.rawCrunch).toBeGreaterThan(0);
  });

  it("CRUNCH that passed a cache delivers normally", () => {
    const state = buildState({
      seed: 12,
      railLevel: 3,
      reserveJ: 500,
      clearBootCore: true,
      chips: [{ x: 2, y: 4, kind: "cache" }],
    });
    addPacket(state, 2, 3, 6, "crunch");
    const done = advanceGame(state, 3 * TICK, "foreground").state;
    expect(done.run.board.packets).toHaveLength(0);
    expect(amountToNumber(done.run.credits)).toBe(12); // ×2 through the cache
    expect(done.run.damageLog.rawCrunch).toBe(0);
  });

  it("respects the live packet cap of 48 for automated pulls", () => {
    const state = buildState({ seed: 13, railLevel: 4, reserveJ: 1000 });
    // Park 48 synthetic packets on the top edge pointing north (they stall
    // forever); the one-per-socket rule caps organic boards below 48, so the
    // cap path is exercised synthetically.
    state.run.board.sockets[toIndex(0, 0, 5)].dir = "N";
    for (let i = 0; i < 48; i += 1) {
      const packet = addPacket(state, 0, 0, 1);
      packet.socketIndex = toIndex(0, 0, 5);
    }
    addTask(state, "bulk", 1);
    const next = advanceGame(state, TICK, "foreground").state;
    expect(next.run.backlog).toHaveLength(1); // automated pull blocked at cap
  });

  it("brownout duty: zero generation halts automation but arrivals continue", () => {
    const state = buildState({ seed: 14 }); // boot: draw 4 W, generation 0
    addTask(state, "bulk", 1);
    const later = advanceGame(state, 20_000, "foreground").state;
    expect(later.run.board.packets).toHaveLength(0); // core never pulled
    expect(later.run.backlog.length).toBeGreaterThan(1); // arrivals kept coming
  });

  it("boots calm: free CORE unpowered, duty 1, no brownout at first launch", () => {
    const state = createInitialGameState(21);
    const core = state.run.board.sockets[toIndex(2, 3, 5)].component;
    expect(core?.kind).toBe("core");
    expect(core?.powered).toBe(false);
    expect(getDuty(state.run, state.meta)).toBe(1); // draw 0 → never brownout
    const later = advanceGame(state, 15_000, "foreground").state;
    expect(eventsOfKind(later, "brownout")).toHaveLength(0);
    const hud = deriveVisibleState(later).hud;
    expect(hud.duty).toBe(1);
    expect(hud.maxHeat).toBe(0); // additive HUD field for WS3
  });

  it("derives a render snapshot with sockets, packets, backlog and fx ring", () => {
    const state = buildState({ seed: 15, railLevel: 2, reserveJ: 100 });
    addTask(state, "bulk", 3);
    const next = advanceGame(state, 2 * TICK, "foreground").state;
    const snapshot = deriveRenderSnapshot(next);
    expect(snapshot.boardWidth).toBe(5);
    expect(snapshot.boardHeight).toBe(7);
    expect(snapshot.portIndices).toEqual([toIndex(2, 6, 5)]);
    expect(snapshot.sockets).toHaveLength(35);
    expect(snapshot.packets.length).toBeGreaterThan(0);
    expect(snapshot.duty).toBe(1);
    expect(snapshot.crash).toBeNull();
    expect(snapshot.events.length).toBeGreaterThan(0);
    const seqs = snapshot.events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // monotonic
    expect(snapshot.lastEventSeq).toBe(seqs[seqs.length - 1]);
    const locked = snapshot.sockets.find((socket) => !socket.unlocked);
    expect(locked?.unlockCostLabel).toBeTruthy();
  });
});
