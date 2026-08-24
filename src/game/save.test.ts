import { advanceGame } from "./advance";
import { applyAction } from "./actions";
import { createInitialGameState } from "./initialState";
import { deserializeSave, normalizeGameState, SAVE_VERSION, serializeSave } from "./save";

describe("save", () => {
  it("round-trips a hub-only state", () => {
    let state = createInitialGameState(42);
    state = { ...state, hub: { ...state.hub, credits: "1234.5" as typeof state.hub.credits, hardware: { ...state.hub.hardware, ram: 3 } } };
    state = applyAction(state, { type: "recordSave", timestampMs: 5_000 });
    const raw = serializeSave(state, 5_000);
    const parsed = JSON.parse(raw) as { version: number; savedAtMs: number; departedAtMs: number | null };
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.savedAtMs).toBe(5_000);
    expect(parsed.departedAtMs).toBeNull();
    const loaded = deserializeSave(raw);
    expect(loaded.state).toEqual(state);
    expect(loaded.savedAtMs).toBe(5_000);
  });

  it("round-trips mid-run, including the event ring, rng and cached paths", () => {
    let state = applyAction(createInitialGameState(7), { type: "deploy" });
    state = advanceGame(state, 20_000, "foreground").state;
    expect(state.run).not.toBeNull();
    state = applyAction(state, { type: "recordDeparture", timestampMs: 9_000 });
    const loaded = deserializeSave(serializeSave(state, 9_000));
    expect(loaded.state).toEqual(state);
    expect(loaded.departedAtMs).toBe(9_000);
    // the restored state advances identically
    const a = advanceGame(state, 5_000, "foreground").state;
    const b = advanceGame(loaded.state, 5_000, "foreground").state;
    expect(b).toEqual(a);
  });

  it("collapses garbage to the initial state", () => {
    const initial = createInitialGameState();
    for (const raw of [null, undefined, "", "not json", "42", "[]", "{}", JSON.stringify({ version: 1, state: 5 })]) {
      const loaded = deserializeSave(raw);
      expect(loaded.state).toEqual(initial);
      expect(loaded.savedAtMs).toBeNull();
    }
  });

  it("clamps and normalizes corrupt fields instead of throwing", () => {
    const state = normalizeGameState({
      hub: {
        credits: "-50",
        data: "abc",
        hardware: { clock: 99999, ram: -3, bogus: 4 },
        research: { completed: ["bugBounty", "nope", "bugBounty"] },
        stats: { runs: -1 },
        rebootRemainingBits: "x",
      },
      run: { floor: { width: 2, height: 2, tiles: [1, 1, 1] } },
      rng: { algorithm: "wrong" },
      watchdog: { ownedLevelId: "bogus", offlineProcessedMs: -5 },
      time: { lastSavedAtMs: "z", departedAtMs: 12 },
    });
    expect(state.hub.credits).toBe("0");
    expect(state.hub.data).toBe("0");
    expect(state.hub.hardware.clock).toBe(60);
    expect(state.hub.hardware.ram).toBe(0);
    expect(state.hub.research.completed).toEqual(["bugBounty"]);
    expect(state.hub.stats.runs).toBe(0);
    expect(state.hub.rebootRemainingBits).toBeNull();
    expect(state.run).toBeNull();
    expect(state.rng.algorithm).toBe("xoshiro128**");
    expect(state.watchdog.ownedLevelId).toBe("none");
    expect(state.watchdog.offlineProcessedMs).toBe(0);
    expect(state.time).toEqual({ lastSavedAtMs: null, departedAtMs: 12 });
  });
});
