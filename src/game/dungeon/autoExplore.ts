import { MAX_ITEM_SLOTS, RETREAT_TURN_BUDGET } from "../hero";
import type { Enemy, HeroAction, HeroStats, Point, RunState } from "../types";
import { findEnemyAt, isEnemyActive } from "./draft";
import { dirTo, DIRS, DIR_VECTORS, isAdjacent, isWalkableTile, manhattan, neighbors4, toIndex } from "./grid";
import { findHazardAt } from "./hazards";
import { itemDefinitions } from "./items";
import { bfsSearch, findPath, type PassableFn } from "./path";
import { isHeroOnStairs } from "./turn";

export interface AutoDecision {
  action: HeroAction;
  /** remaining cached path after the chosen step (null when not following a path) */
  autoPath: Point[] | null;
}

export const RETREAT_HP_FRACTION = 0.3;
/** L0 heals only as an emergency; L2 heals preemptively. */
export const EMERGENCY_PATCH_HP_FRACTION = 0.35;
export const PATCH_HP_FRACTION = 0.5;
export const APPROACH_PATH_LIMIT = 8;

const activeEnemies = (run: RunState) => run.enemies.filter(isEnemyActive);

const isVisible = (run: RunState, point: Point) =>
  run.floor.visible[toIndex(point.x, point.y, run.floor.width)] === true;

const isExplored = (run: RunState, index: number) => run.floor.explored[index] === true;

const pointOf = (run: RunState, index: number): Point => {
  const x = index % run.floor.width;
  return { x, y: (index - x) / run.floor.width };
};

interface PlanContext {
  deadlockCells: Set<number>;
  nearDeadlock: Set<number>;
  hazardCells: Set<number>;
}

const buildPlanContext = (run: RunState): PlanContext => {
  const width = run.floor.width;
  const deadlockCells = new Set<number>();
  const nearDeadlock = new Set<number>();
  for (const enemy of run.enemies) {
    if (enemy.kind !== "deadlock" || !isEnemyActive(enemy)) continue;
    deadlockCells.add(toIndex(enemy.x, enemy.y, width));
    for (const n of neighbors4(run.floor, enemy.x, enemy.y)) nearDeadlock.add(toIndex(n.x, n.y, width));
  }
  return { deadlockCells, nearDeadlock, hazardCells: new Set(run.floor.hazards.map((hazard) => hazard.index)) };
};

/**
 * Known, walkable cells for planning. Moving enemies are NOT obstacles here
 * (treating them as walls made plans flip-flop as they wandered); only
 * deadlocks are, since walking into one is a trap. Hazards and deadlock zones
 * are avoided when a route exists without them.
 */
const knownPassable =
  (run: RunState, ctx: PlanContext, avoidHazards: boolean, avoidDeadlocks: boolean): PassableFn =>
  (index) =>
    isExplored(run, index) &&
    isWalkableTile(run.floor.tiles[index] ?? null) &&
    !ctx.deadlockCells.has(index) &&
    (!avoidHazards || !ctx.hazardCells.has(index)) &&
    (!avoidDeadlocks || !ctx.nearDeadlock.has(index));

const searchWithFallback = (
  run: RunState,
  ctx: PlanContext,
  search: (passable: PassableFn) => Point[] | null,
): Point[] | null =>
  search(knownPassable(run, ctx, true, true)) ??
  search(knownPassable(run, ctx, false, true)) ??
  search(knownPassable(run, ctx, false, false));

const stepAlong = (run: RunState, path: Point[]): AutoDecision | null => {
  const next = path[0];
  if (!next) return null;
  const dir = dirTo(run.hero, next);
  if (!dir) return null;
  return { action: { type: "move", dir }, autoPath: path.length > 1 ? path.slice(1) : null };
};

const isFrontier = (run: RunState, index: number) => {
  if (!isExplored(run, index) || !isWalkableTile(run.floor.tiles[index] ?? null)) return false;
  const point = pointOf(run, index);
  return neighbors4(run.floor, point.x, point.y).some(
    (n) => !isExplored(run, toIndex(n.x, n.y, run.floor.width)),
  );
};

const chooseCombat = (run: RunState, stats: HeroStats, adjacent: Enemy[]): AutoDecision => {
  const hero = run.hero;
  const level = stats.schedulerLevel;
  if (level >= 1 && hero.throttled) {
    const slot = hero.items.indexOf("heatsink");
    if (slot >= 0) return { action: { type: "useItem", slot }, autoPath: null };
  }
  const patchFraction = level >= 2 ? PATCH_HP_FRACTION : EMERGENCY_PATCH_HP_FRACTION;
  if (hero.hp < hero.maxHp * patchFraction) {
    const slot = hero.items.indexOf("patch");
    if (slot >= 0) return { action: { type: "useItem", slot }, autoPath: null };
  }
  const locked = adjacent.some((enemy) => enemy.kind === "deadlock");
  if (
    level >= 1 &&
    !locked &&
    hero.hp < hero.maxHp * RETREAT_HP_FRACTION &&
    hero.retreatTurns < RETREAT_TURN_BUDGET
  ) {
    for (const dir of DIRS) {
      const cell = { x: hero.x + DIR_VECTORS[dir].x, y: hero.y + DIR_VECTORS[dir].y };
      const index = toIndex(cell.x, cell.y, run.floor.width);
      if (!isWalkableTile(run.floor.tiles[index] ?? null) || findEnemyAt(run, cell.x, cell.y)) continue;
      if (findHazardAt(run.floor, index)) continue;
      const safe = activeEnemies(run).every((enemy) => manhattan(enemy, cell) > 1);
      if (safe) return { action: { type: "move", dir }, autoPath: null };
    }
  }
  const target =
    adjacent.find((enemy) => enemy.kind === "deadlock") ??
    [...adjacent].sort((a, b) => a.hp - b.hp || a.id - b.id)[0]!;
  const dir = dirTo(hero, target) ?? "e";
  return { action: { type: "move", dir }, autoPath: null };
};

/**
 * Auto-explore priority: adjacent enemy -> committed path -> reachable visible
 * enemy -> known item -> nearest unexplored frontier -> stairs -> forceDescend
 * (anti-stall guarantee). Every plan (chase included) is cached and followed to
 * its end before re-planning; re-planning every turn made the hero flip-flop
 * whenever a wandering enemy or a hazard detour changed the best first step.
 */
export const chooseAutoAction = (run: RunState, stats: HeroStats): AutoDecision => {
  const hero = run.hero;
  const enemies = activeEnemies(run);
  const adjacent = enemies.filter((enemy) => isAdjacent(enemy, hero));
  if (adjacent.length > 0) return chooseCombat(run, stats, adjacent);
  const ctx = buildPlanContext(run);

  if (run.autoPath && run.autoPath.length > 0) {
    const next = run.autoPath[0]!;
    const index = toIndex(next.x, next.y, run.floor.width);
    if (isAdjacent(hero, next) && isWalkableTile(run.floor.tiles[index] ?? null) && !findEnemyAt(run, next.x, next.y)) {
      const step = stepAlong(run, run.autoPath);
      if (step) return step;
    }
  }

  // Deadlocks are traps: never walk up to one on purpose. Anything that hurt the
  // hero this turn or last stays a target even if it slipped out of sight.
  const recentAttackers = new Set<number>();
  for (const event of run.events) {
    if (event.kind === "heroHurt" && event.sourceId !== null && event.turn >= run.turn - 1) {
      recentAttackers.add(event.sourceId);
    }
  }
  const chaseable = enemies.filter(
    (enemy) => enemy.kind !== "deadlock" && (isVisible(run, enemy) || recentAttackers.has(enemy.id)),
  );
  if (chaseable.length > 0) {
    const sorted = [...chaseable].sort((a, b) => manhattan(a, hero) - manhattan(b, hero) || a.id - b.id);
    for (const enemy of sorted) {
      const goal = toIndex(enemy.x, enemy.y, run.floor.width);
      // Fallback through hazards too: refusing the last hazard step next to a
      // ranged enemy made the hero re-plan away and re-spot it, an endless loop.
      const path = searchWithFallback(run, ctx, (passable) =>
        bfsSearch(run.floor, hero, passable, (index) => index === goal),
      );
      if (path && path.length <= APPROACH_PATH_LIMIT) {
        const step = stepAlong(run, path);
        if (step) return step;
      }
    }
  }

  const hasRoom = hero.items.length < MAX_ITEM_SLOTS;
  const knownItems = run.items.filter(
    (item) =>
      isExplored(run, toIndex(item.x, item.y, run.floor.width)) &&
      (hasRoom || !itemDefinitions[item.kind].usable),
  );
  if (knownItems.length > 0) {
    const goals = new Set(knownItems.map((item) => toIndex(item.x, item.y, run.floor.width)));
    const path = searchWithFallback(run, ctx, (passable) =>
      bfsSearch(run.floor, hero, passable, (index) => goals.has(index)),
    );
    if (path && path.length > 0) {
      const step = stepAlong(run, path);
      if (step) return step;
    }
  }

  const frontier = searchWithFallback(run, ctx, (passable) =>
    bfsSearch(run.floor, hero, passable, (index) => isFrontier(run, index)),
  );
  if (frontier && frontier.length > 0) {
    const step = stepAlong(run, frontier);
    if (step) return step;
  }

  // Boss floors: stairs refuse `descend` while locked, so hunt the kernelPanic
  // (no path-length limit) instead of parking on the stairs. If the boss is
  // unreachable, forceDescend anyway — the anti-stall guarantee wins.
  if (run.floor.stairsLocked) {
    const boss = run.enemies.find((candidate) => candidate.kind === "kernelPanic" && isEnemyActive(candidate));
    if (boss) {
      const goal = toIndex(boss.x, boss.y, run.floor.width);
      const path = searchWithFallback(run, ctx, (passable) =>
        bfsSearch(run.floor, hero, passable, (index) => index === goal),
      );
      if (path && path.length > 0) {
        const step = stepAlong(run, path);
        if (step) return step;
      }
    }
    return { action: { type: "forceDescend" }, autoPath: null };
  }

  if (isHeroOnStairs(run)) return { action: { type: "descend" }, autoPath: null };
  const stairsIndex = toIndex(run.floor.stairs.x, run.floor.stairs.y, run.floor.width);
  if (isExplored(run, stairsIndex)) {
    const path = searchWithFallback(run, ctx, (passable) => findPath(run.floor, hero, run.floor.stairs, passable));
    if (path && path.length > 0) {
      const step = stepAlong(run, path);
      if (step) return step;
    }
  }
  return { action: { type: "forceDescend" }, autoPath: null };
};
