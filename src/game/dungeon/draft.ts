/**
 * Mutable per-turn draft helpers. `cloneRunForTurn` copies every container the
 * resolver may touch so the input RunState is never mutated; the draft is then
 * edited in place and returned as the next immutable state.
 */
import type { RunEvent } from "../renderSnapshot";
import { nextRngFloat, nextRngInt } from "../rng";
import type { Enemy, FloorItem, RunState } from "../types";
import { isWalkableAt, toIndex } from "./grid";

export const EVENT_RING_SIZE = 64;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RunEventInput = DistributiveOmit<RunEvent, "seq" | "turn">;

export const cloneRunForTurn = (run: RunState): RunState => ({
  ...run,
  hero: { ...run.hero, items: [...run.hero.items], buffs: run.hero.buffs.map((buff) => ({ ...buff })) },
  floor: { ...run.floor },
  enemies: run.enemies.map((enemy) => ({ ...enemy })),
  items: [...run.items],
  sites: run.sites.map((site) => ({ ...site })),
  payloads: run.payloads.map((payload) => ({ ...payload })),
  leaks: [...run.leaks],
  quota: { ...run.quota },
  gcChannel: run.gcChannel ? { ...run.gcChannel } : null,
  events: [...run.events],
});

export const pushEvent = (run: RunState, event: RunEventInput) => {
  const full = { ...event, seq: run.nextEventSeq, turn: run.turn } as RunEvent;
  run.nextEventSeq += 1;
  run.events.push(full);
  if (run.events.length > EVENT_RING_SIZE) run.events.splice(0, run.events.length - EVENT_RING_SIZE);
};

export const drawInt = (run: RunState, min: number, maxExclusive: number) => {
  const next = nextRngInt(run.rng, min, maxExclusive);
  run.rng = next.state;
  return next.value;
};

export const drawFloat = (run: RunState) => {
  const next = nextRngFloat(run.rng);
  run.rng = next.state;
  return next.value;
};

export const isEnemyActive = (enemy: Enemy) => enemy.dormantTurns === 0 && enemy.hp > 0;

export const findEnemyAt = (run: RunState, x: number, y: number): Enemy | undefined =>
  run.enemies.find((enemy) => isEnemyActive(enemy) && enemy.x === x && enemy.y === y);

export const findItemAt = (run: RunState, x: number, y: number): FloorItem | undefined =>
  run.items.find((item) => item.x === x && item.y === y);

export const isHeroAt = (run: RunState, x: number, y: number) => run.hero.x === x && run.hero.y === y;

export const isCellFreeForEnemy = (run: RunState, x: number, y: number) =>
  isWalkableAt(run.floor, x, y) && !findEnemyAt(run, x, y) && !isHeroAt(run, x, y);

/**
 * Transient occupancy grid (enemy id + 1 per cell, 0 = empty) for the enemy
 * phase, so stepping is O(1) instead of scanning every enemy. Built once per
 * turn; the enemy movers keep it current.
 */
export type Occupancy = Int32Array;

export const buildOccupancy = (run: RunState): Occupancy => {
  const occupancy = new Int32Array(run.floor.width * run.floor.height);
  for (const enemy of run.enemies) {
    if (isEnemyActive(enemy)) occupancy[toIndex(enemy.x, enemy.y, run.floor.width)] = enemy.id + 1;
  }
  return occupancy;
};

export const isCellFreeForEnemyFast = (run: RunState, occupancy: Occupancy, x: number, y: number) =>
  isWalkableAt(run.floor, x, y) &&
  occupancy[toIndex(x, y, run.floor.width)] === 0 &&
  !isHeroAt(run, x, y);

export const heroIndex = (run: RunState) => toIndex(run.hero.x, run.hero.y, run.floor.width);

export const hurtHero = (run: RunState, damage: number, sourceId: number | null, cause: string) => {
  if (damage <= 0 || run.hero.hp <= 0) return;
  run.hero.hp = Math.max(0, run.hero.hp - damage);
  pushEvent(run, { kind: "heroHurt", sourceId, damage, hp: run.hero.hp });
  if (run.hero.hp === 0 && run.deathCause === null) run.deathCause = cause;
};
