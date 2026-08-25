import { describe, expect, it } from "vitest";
import { advanceGame } from "./advance";
import { toIndex } from "./board";
import { getBacklogCap } from "./economy";
import { deriveRenderSnapshot } from "./renderSnapshot";
import { deriveVisibleState } from "./selectors";
import { addTask, buildState, eventsOfKind, TICK } from "./testHelpers";

describe("integrity and crash", () => {
  it("dropped tasks on a full backlog cost 2 integrity each", () => {
    const state = buildState({ seed: 1, uptimeMs: 0 });
    const cap = getBacklogCap(state.meta.architecture);
    for (let i = 0; i < cap; i += 1) addTask(state, "bulk", 1);
    // Next arrival (~6 s) overflows.
    const later = advanceGame(state, 6_500, "foreground").state;
    expect(later.run.damageLog.backlogOverflow).toBeGreaterThanOrEqual(2);
    expect(later.run.integrity).toBeLessThan(100);
    expect(eventsOfKind(later, "taskDropped").some((e) => e.reason === "backlogFull")).toBe(
      true,
    );
  });

  it("expired PRIORITY tasks cost 5 integrity", () => {
    const state = buildState({ seed: 2 });
    addTask(state, "priority", 5, state.run.uptimeMs + 1_000);
    const later = advanceGame(state, 2_000, "foreground").state;
    expect(later.run.backlog).toHaveLength(0);
    expect(later.run.damageLog.priorityExpired).toBe(5);
  });

  it("sockets pinned at 100 heat bleed 1 integrity per second", () => {
    const state = buildState({ seed: 3, clearBootCore: true });
    let current = state;
    for (let i = 0; i < 10; i += 1) {
      current.run.board.sockets[toIndex(0, 0, 5)].heat = 100;
      // Re-heat before each tick so the socket stays clamped at 100.
      const draft = advanceGame(current, TICK, "foreground").state;
      current = draft;
    }
    expect(current.run.damageLog.overheat).toBeGreaterThan(2);
  });

  it("regenerates 1 integrity per 30 s while backlog < 6 and no fault is active", () => {
    const calm = buildState({ seed: 4, integrity: 50 });
    const later = advanceGame(calm, 30_000, "foreground").state;
    expect(later.run.integrity).toBeCloseTo(51, 1);

    const faulty = buildState({
      seed: 4,
      integrity: 50,
      chips: [{ x: 0, y: 0, kind: "cache", faulted: true }],
    });
    const stuck = advanceGame(faulty, 15_000, "foreground").state;
    expect(stuck.run.integrity).toBeLessThanOrEqual(50);
  });

  it("crash at 0 integrity freezes the run and fills the ranked damage report", () => {
    const state = buildState({ seed: 5, integrity: 3, uptimeMs: 25 * 60_000 });
    let current = state;
    for (let i = 0; i < 600 && current.run.integrity > 0; i += 1) {
      current = advanceGame(current, 1_000, "foreground").state;
    }
    expect(current.run.integrity).toBe(0);
    expect(eventsOfKind(current, "crash")).toHaveLength(1);

    // Frozen: further time changes nothing.
    const after = advanceGame(current, 60_000, "foreground");
    expect(after.state).toBe(current);

    const snapshot = deriveRenderSnapshot(current);
    expect(snapshot.crash).not.toBeNull();
    expect(snapshot.crash!.damage.length).toBeGreaterThan(0);
    expect(snapshot.crash!.damage[0].source).toBe("backlogOverflow");
    expect(snapshot.duty).toBe(0);

    const visible = deriveVisibleState(current);
    expect(visible.crash).not.toBeNull();
    expect(visible.crash!.killedBy).toBe("BACKLOG OVERFLOW");
    expect(visible.crash!.rows[0].percent).toBeGreaterThan(0);
    expect(visible.reflow.available).toBe(true);
  });
});
