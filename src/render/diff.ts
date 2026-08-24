import type { RenderEntity, RenderItem, RunEvent } from "../game/renderSnapshot";

export interface EntityDiff<T> {
  added: T[];
  removed: number[];
  /** Entities present in both; `prev` is the old record. */
  updated: { prev: T; next: T }[];
}

interface HasId {
  id: number;
}

/**
 * Diff two id-keyed lists. Order is by `next` for added/updated, by `prev` for removed.
 * Pure; safe to unit test without Phaser.
 */
export function diffEntities<T extends HasId>(prev: readonly T[], next: readonly T[]): EntityDiff<T> {
  const prevById = new Map<number, T>();
  for (const e of prev) prevById.set(e.id, e);
  const nextIds = new Set<number>();
  const added: T[] = [];
  const updated: { prev: T; next: T }[] = [];
  for (const e of next) {
    nextIds.add(e.id);
    const old = prevById.get(e.id);
    if (old === undefined) added.push(e);
    else updated.push({ prev: old, next: e });
  }
  const removed: number[] = [];
  for (const e of prev) if (!nextIds.has(e.id)) removed.push(e.id);
  return { added, removed, updated };
}

export type EntityListDiff = EntityDiff<RenderEntity>;
export type ItemListDiff = EntityDiff<RenderItem>;

/**
 * Events with `seq > lastSeq`, ascending. Returns the new lastSeq so callers
 * stay idempotent across remounts and dropped frames.
 */
export function selectNewEvents(
  events: readonly RunEvent[],
  lastSeq: number,
): { events: RunEvent[]; lastSeq: number } {
  const fresh: RunEvent[] = [];
  let max = lastSeq;
  for (const ev of events) {
    if (ev.seq > lastSeq) {
      fresh.push(ev);
      if (ev.seq > max) max = ev.seq;
    }
  }
  fresh.sort((a, b) => a.seq - b.seq);
  return { events: fresh, lastSeq: max };
}

/** True when the position changed between two records. */
export function moved(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x !== b.x || a.y !== b.y;
}
