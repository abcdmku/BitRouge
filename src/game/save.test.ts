import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { advanceGame } from "./advance";
import { createInitialGameState } from "./initialState";
import {
  deserializeSave,
  normalizeGameState,
  SAVE_VERSION,
  serializeSave,
} from "./save";
import { buildState } from "./testHelpers";

describe("save v4", () => {
  it("exposes SAVE_VERSION 4", () => {
    expect(SAVE_VERSION).toBe(4);
  });

  it("roundtrips a lived-in state exactly", () => {
    let state = buildState({
      seed: 77,
      railLevel: 2,
      reserveJ: 42.5,
      credits: 123.4,
      chips: [{ x: 1, y: 5, kind: "cache" }],
    });
    state = advanceGame(state, 90_000, "foreground").state;
    state.meta.research.completed.push("decodeLogic");
    state.meta.research.active = { id: "cacheMapping", workDone: 3 };
    state = applyAction(state, { type: "recordSave", timestampMs: 1_700_000_000_000 });
    const raw = serializeSave(state, 1_700_000_000_000);
    const loaded = deserializeSave(raw);
    expect(loaded.state).toEqual(state);
    expect(loaded.savedAtMs).toBe(1_700_000_000_000);
    expect(loaded.departedAtMs).toBeNull();
  });

  it("keeps envelope departure metadata", () => {
    const departed = applyAction(createInitialGameState(5), {
      type: "recordDeparture",
      timestampMs: 999,
    });
    const loaded = deserializeSave(serializeSave(departed, 1_000));
    expect(loaded.departedAtMs).toBe(999);
  });

  it("migrates v1/v2 saves: Silicon = floor(sqrt(credits)/10), fresh run", () => {
    const legacy = JSON.stringify({
      version: 2,
      savedAtMs: 123,
      departedAtMs: null,
      state: {
        version: 2,
        hub: { credits: "40000", data: "500", hardware: {}, research: { completed: [] } },
        run: null,
        time: { lastSavedAtMs: 123, departedAtMs: null },
      },
    });
    const loaded = deserializeSave(legacy);
    expect(loaded.state.meta.silicon).toBe(20); // floor(200 / 10)
    expect(loaded.state.run.uptimeMs).toBe(0);
    expect(loaded.state.run.board.sockets).toHaveLength(35);
    expect(loaded.state.meta.reflows).toBe(0);
  });

  it("fills v4 research and intervention fields on a bare v3 state", () => {
    const legacy = createInitialGameState(9) as unknown as {
      meta: { research?: unknown };
      run: { pressureMs?: number; ventCooldownMs?: number; uptimeMs: number };
    };
    delete legacy.meta.research;
    delete legacy.run.pressureMs;
    delete legacy.run.ventCooldownMs;
    legacy.run.uptimeMs = 12_000;
    const loaded = deserializeSave(JSON.stringify(legacy));
    expect(loaded.state.meta.research).toEqual({ completed: [], active: null });
    expect(loaded.state.run.pressureMs).toBe(12_000);
    expect(loaded.state.run.ventCooldownMs).toBe(0);
  });

  it("collapses garbage to the initial state", () => {
    const fallback = createInitialGameState();
    expect(deserializeSave("not json{{{").state).toEqual(fallback);
    expect(deserializeSave("").state).toEqual(fallback);
    expect(deserializeSave(null).state).toEqual(fallback);
    expect(deserializeSave(JSON.stringify({ hello: 1 })).state).toEqual(fallback);
    expect(deserializeSave(JSON.stringify([1, 2, 3])).state).toEqual(fallback);
  });

  it("clamps hostile fields instead of crashing", () => {
    const state = createInitialGameState(11);
    const hostile = JSON.parse(serializeSave(state, 50)) as Record<string, unknown>;
    const mutated = hostile.state as Record<string, unknown>;
    (mutated.run as Record<string, unknown>).integrity = 5000;
    (mutated.run as Record<string, unknown>).credits = "-999";
    (mutated.meta as Record<string, unknown>).silicon = -5;
    const loaded = deserializeSave(JSON.stringify(hostile));
    expect(loaded.state.run.integrity).toBeLessThanOrEqual(100);
    expect(loaded.state.run.credits).toBe("0");
    expect(loaded.state.meta.silicon).toBe(0);
  });

  it("normalizeGameState collapses non-record garbage", () => {
    expect(normalizeGameState(42)).toEqual(createInitialGameState());
    expect(normalizeGameState(undefined)).toEqual(createInitialGameState());
  });

  it("drops duplicate packets sharing a socket during normalization", () => {
    const state = createInitialGameState(13);
    const raw = JSON.parse(serializeSave(state, 1)) as {
      state: { run: { board: { packets: unknown[] } } };
    };
    raw.state.run.board.packets = [
      { id: 1, taskKind: "bulk", socketIndex: 3, value: "2", visitedMask: 0, hops: 0 },
      { id: 2, taskKind: "bulk", socketIndex: 3, value: "2", visitedMask: 0, hops: 0 },
    ];
    const loaded = deserializeSave(JSON.stringify(raw));
    expect(loaded.state.run.board.packets).toHaveLength(1);
  });
});
