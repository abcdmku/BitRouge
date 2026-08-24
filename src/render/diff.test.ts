import { describe, expect, it } from "vitest";
import type { RenderEntity, RunEvent } from "../game/renderSnapshot";
import { diffEntities, moved, selectNewEvents } from "./diff";

function ent(id: number, x = 0, y = 0): RenderEntity {
  return { id, kind: "bitFlip", x, y, hp: 3, maxHp: 3, facing: "r", anim: "idle" };
}

describe("diffEntities", () => {
  it("reports added, removed and updated", () => {
    const prev = [ent(1), ent(2), ent(3)];
    const next = [ent(2, 5, 5), ent(3), ent(4)];
    const d = diffEntities(prev, next);
    expect(d.added.map((e) => e.id)).toEqual([4]);
    expect(d.removed).toEqual([1]);
    expect(d.updated.map((u) => u.next.id)).toEqual([2, 3]);
    expect(d.updated[0]?.prev.x).toBe(0);
    expect(d.updated[0]?.next.x).toBe(5);
  });

  it("handles empty inputs", () => {
    expect(diffEntities([], [])).toEqual({ added: [], removed: [], updated: [] });
    expect(diffEntities([], [ent(1)]).added).toHaveLength(1);
    expect(diffEntities([ent(1)], []).removed).toEqual([1]);
  });
});

describe("selectNewEvents", () => {
  const ev = (seq: number): RunEvent => ({ seq, turn: seq, kind: "heroWait" as never } as RunEvent);

  it("returns only events after lastSeq, sorted, and advances lastSeq", () => {
    const events = [ev(5), ev(3), ev(7), ev(6)];
    const r = selectNewEvents(events, 5);
    expect(r.events.map((e) => e.seq)).toEqual([6, 7]);
    expect(r.lastSeq).toBe(7);
  });

  it("is idempotent when replayed", () => {
    const events = [ev(1), ev(2)];
    const first = selectNewEvents(events, 0);
    const second = selectNewEvents(events, first.lastSeq);
    expect(second.events).toEqual([]);
    expect(second.lastSeq).toBe(2);
  });

  it("keeps lastSeq when nothing is new", () => {
    expect(selectNewEvents([], 9).lastSeq).toBe(9);
  });
});

describe("moved", () => {
  it("detects position changes", () => {
    expect(moved({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(moved({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
  });
});
