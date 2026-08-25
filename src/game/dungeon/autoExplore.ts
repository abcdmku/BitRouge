/**
 * Auto-explore, redesign v2 (§5). Priority table (scheduler level unlocks rows):
 *
 *   1  survival: patch below threshold, retreat (retreat at L1+)      L0/L1
 *   2  adjacent fault: attack (deadlock only when it blocks the plan) L0
 *   3  continue an in-progress channel if no fault within 2 cells     L0
 *   4  carrying: deliver by shortest route; L1+ re-routes around
 *      fault-adjacent cells                                           L0/L1
 *   5  intercept: bitFlip within 6 of an in-progress node; forkBomb
 *      past turn 8 of its duplication window                          L2
 *   6  start next task: nearest site (L0) or best credits-or-data
 *      per turn (L2); default order mine > execute > haul             L0
 *   7  GC leak cells that block the current path (always, folded into
 *      routing) or pay well (L1)                                      L0/L1
 *   8  explore nearest frontier                                       L0
 *   9  quota met: path to the bus gate, flush                         L0
 *  10  anti-stall: forceFlush (forceDescend), unchanged semantics     L0
 *
 * L3 additionally auto-overclocks when heat < 4 and a job is executing.
 * Once the quota is met the scheduler stops starting new work (greedy quota
 * fill, §5) and heads for the flush; rows 3-4 still finish commitments.
 * Plans are cached in run.autoPath and followed to their end (re-planning
 * every turn made the hero flip-flop); an urgent bitFlip threat invalidates
 * the cache at L2+.
 */
import { MAX_ITEM_SLOTS, RETREAT_TURN_BUDGET, THROTTLE_OFF_HEAT } from "../hero";
import { amountToSafeNumber } from "../amount";
import type { Enemy, HeroAction, HeroStats, Point, RunState, WorkSite } from "../types";
import { findEnemyAt, isEnemyActive } from "./draft";
import { FORK_BOMB_DUP_TURNS } from "./enemies";
import {
  chebyshev,
  dirTo,
  DIRS,
  DIR_VECTORS,
  isAdjacent,
  isWalkableTile,
  manhattan,
  neighbors4,
  toIndex,
} from "./grid";
import { findHazardAt } from "./hazards";
import { itemDefinitions } from "./items";
import { bfsDistances, bfsSearch, type PassableFn } from "./path";
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
/** row 5: intercept a bitFlip this close (manhattan) to an in-progress node */
export const BITFLIP_INTERCEPT_RANGE = 6;
/** row 5: intercept a forkBomb once its duplication window is this old */
export const FORK_INTERCEPT_TURN = 8;
/** row 3: keep channeling only when no fault is within this range */
export const CHANNEL_CLEAR_RADIUS = 2;
/** L2 task scoring: 1 Data is worth this many credits per turn */
export const DATA_CREDIT_VALUE = 10;
/** row 7 (L1): collect paying leaks within this path length */
export const LEAK_GC_RADIUS = 8;

const activeEnemies = (run: RunState) => run.enemies.filter(isEnemyActive);

const isVisible = (run: RunState, point: Point) =>
  run.floor.visible[toIndex(point.x, point.y, run.floor.width)] === true;

const isExplored = (run: RunState, index: number) => run.floor.explored[index] === true;

const pointOf = (run: RunState, index: number): Point => {
  const x = index % run.floor.width;
  return { x, y: (index - x) / run.floor.width };
};

const interactDecision = (): AutoDecision => ({ action: { type: "interact" }, autoPath: null });

interface PlanContext {
  deadlockCells: Set<number>;
  nearDeadlock: Set<number>;
  hazardCells: Set<number>;
  leakCells: Set<number>;
  /** cells within 1 of an active fault (L1+ carry re-routing) */
  nearFault: Set<number>;
}

const buildPlanContext = (run: RunState): PlanContext => {
  const width = run.floor.width;
  const deadlockCells = new Set<number>();
  const nearDeadlock = new Set<number>();
  const nearFault = new Set<number>();
  for (const enemy of run.enemies) {
    if (!isEnemyActive(enemy)) continue;
    if (enemy.kind === "deadlock") {
      deadlockCells.add(toIndex(enemy.x, enemy.y, width));
      for (const n of neighbors4(run.floor, enemy.x, enemy.y)) nearDeadlock.add(toIndex(n.x, n.y, width));
      continue;
    }
    nearFault.add(toIndex(enemy.x, enemy.y, width));
    for (const n of neighbors4(run.floor, enemy.x, enemy.y)) nearFault.add(toIndex(n.x, n.y, width));
  }
  return {
    deadlockCells,
    nearDeadlock,
    nearFault,
    hazardCells: new Set(run.floor.hazards.map((hazard) => hazard.index)),
    leakCells: new Set(run.leaks),
  };
};

interface PassOptions {
  hazards: boolean;
  deadlockZone: boolean;
  faults: boolean;
  leaks: boolean;
}

/**
 * Known, walkable cells for planning. Moving enemies are NOT obstacles here
 * (treating them as walls made plans flip-flop as they wandered); deadlocks
 * always are, since walking next to one is a trap. Leak cells are impassable
 * for real; when only a leak-crossing route exists, `routePlan` walks up to
 * the first leak and GCs it (row 7's "blocking" case).
 */
const knownPassable =
  (run: RunState, ctx: PlanContext, options: PassOptions): PassableFn =>
  (index) =>
    isExplored(run, index) &&
    isWalkableTile(run.floor.tiles[index] ?? null) &&
    !ctx.deadlockCells.has(index) &&
    (options.leaks || !ctx.leakCells.has(index)) &&
    (!options.hazards || !ctx.hazardCells.has(index)) &&
    (!options.deadlockZone || !ctx.nearDeadlock.has(index)) &&
    (!options.faults || !ctx.nearFault.has(index));

type RoutePlan = { kind: "step"; path: Point[] } | { kind: "gc" };

const searchWithFallback = (
  run: RunState,
  ctx: PlanContext,
  search: (passable: PassableFn) => Point[] | null,
  avoidFaults = false,
): Point[] | null =>
  (avoidFaults
    ? search(knownPassable(run, ctx, { hazards: true, deadlockZone: true, faults: true, leaks: false }))
    : null) ??
  search(knownPassable(run, ctx, { hazards: true, deadlockZone: true, faults: false, leaks: false })) ??
  search(knownPassable(run, ctx, { hazards: false, deadlockZone: true, faults: false, leaks: false })) ??
  search(knownPassable(run, ctx, { hazards: false, deadlockZone: false, faults: false, leaks: false }));

/**
 * Route toward a goal set. When every leak-free route is blocked, fall back to
 * a leak-crossing route: walk up to the first leak cell, then GC it (interact).
 * Not while carrying: hauling blocks GC channels (worksites.ts), so a "gc"
 * decision would no-op forever — the route simply fails instead.
 */
const routePlan = (
  run: RunState,
  ctx: PlanContext,
  isGoal: (index: number) => boolean,
  avoidFaults = false,
): RoutePlan | null => {
  const width = run.floor.width;
  // BFS goal cells are exempt from passability (attack/step-onto semantics),
  // so even a "leak-free" path can END on a leak cell (a payload or frontier
  // buried under one). Truncate at the first leak and GC it — unless carrying,
  // which blocks GC channels and would no-op forever.
  const resolveLeaks = (path: Point[]): RoutePlan | null => {
    const firstLeak = path.findIndex((cell) => ctx.leakCells.has(toIndex(cell.x, cell.y, width)));
    if (firstLeak === -1) return { kind: "step", path };
    if (run.hero.carryingPayloadId !== null) return null;
    if (firstLeak === 0) return { kind: "gc" };
    return { kind: "step", path: path.slice(0, firstLeak) };
  };
  const clean = searchWithFallback(
    run,
    ctx,
    (passable) => bfsSearch(run.floor, run.hero, passable, isGoal),
    avoidFaults,
  );
  if (clean) return resolveLeaks(clean);
  if (run.hero.carryingPayloadId !== null) return null;
  const crossing = bfsSearch(
    run.floor,
    run.hero,
    knownPassable(run, ctx, { hazards: false, deadlockZone: false, faults: false, leaks: true }),
    isGoal,
  );
  if (!crossing) return null;
  return resolveLeaks(crossing);
};

const stepAlong = (run: RunState, path: Point[]): AutoDecision | null => {
  const next = path[0];
  if (!next) return null;
  const dir = dirTo(run.hero, next);
  if (!dir) return null;
  return { action: { type: "move", dir }, autoPath: path.length > 1 ? path.slice(1) : null };
};

const planDecision = (run: RunState, plan: RoutePlan | null): AutoDecision | null => {
  if (!plan) return null;
  if (plan.kind === "gc") return interactDecision();
  return stepAlong(run, plan.path);
};

const isFrontier = (run: RunState, index: number) => {
  if (!isExplored(run, index) || !isWalkableTile(run.floor.tiles[index] ?? null)) return false;
  const point = pointOf(run, index);
  return neighbors4(run.floor, point.x, point.y).some(
    (n) => !isExplored(run, toIndex(n.x, n.y, run.floor.width)),
  );
};

// ---------------------------------------------------------------------------
// work-site helpers
// ---------------------------------------------------------------------------

const siteById = (run: RunState, id: number | null): WorkSite | undefined =>
  id === null ? undefined : run.sites.find((site) => site.id === id);

const nodeInProgress = (site: WorkSite) =>
  site.kind === "dataNode" && !site.resolved && site.remainingUnits < site.totalUnits;

/** Corruption knocks 25% of the original yield off per unanswered flip (§3). */
const effectiveNodeYield = (site: WorkSite) =>
  Math.max(0, site.yieldData * (1 - 0.25 * site.corrupted));

/**
 * Elapsed turns of a forkBomb's duplication timer; `workTimer` counts down
 * from FORK_BOMB_DUP_TURNS to the next split (enemies.ts).
 */
const forkWindowTurns = (enemy: Enemy): number =>
  enemy.kind === "forkBomb" && enemy.workTimer > 0 ? FORK_BOMB_DUP_TURNS - enemy.workTimer : 0;

const hasBitFlipThreat = (run: RunState): boolean => {
  const targets = run.sites.filter(nodeInProgress);
  if (targets.length === 0) return false;
  return activeEnemies(run).some(
    (enemy) =>
      enemy.kind === "bitFlip" &&
      isVisible(run, enemy) &&
      targets.some((site) => manhattan(enemy, site) <= BITFLIP_INTERCEPT_RANGE),
  );
};

/** Something `interact` can do from the hero's current cell. */
const canWorkInPlace = (run: RunState): boolean => {
  const hero = run.hero;
  if (hero.carryingPayloadId !== null) {
    const payload = run.payloads.find((candidate) => candidate.id === hero.carryingPayloadId);
    const port = payload ? siteById(run, payload.portId) : undefined;
    if (port && hero.x === port.x && hero.y === port.y) return true;
  } else if (run.payloads.some((p) => p.heldBy === "floor" && p.x === hero.x && p.y === hero.y)) {
    return true;
  }
  if (
    run.sites.some(
      (site) =>
        site.kind === "jobStation" &&
        !site.resolved &&
        site.squattedBy === null &&
        site.x === hero.x &&
        site.y === hero.y,
    )
  ) {
    return true;
  }
  return run.sites.some((site) => site.kind === "dataNode" && !site.resolved && isAdjacent(site, hero));
};

// ---------------------------------------------------------------------------
// row 2: adjacent faults
// ---------------------------------------------------------------------------

const chooseCombat = (run: RunState, stats: HeroStats, adjacent: Enemy[]): AutoDecision => {
  const hero = run.hero;
  const level = stats.schedulerLevel;
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
      if (run.leaks.includes(index)) continue;
      const safe = activeEnemies(run).every((enemy) => manhattan(enemy, cell) > 1);
      if (safe) return { action: { type: "move", dir }, autoPath: null };
    }
  }
  // a daemon next to a carried payload steals it: kill it before anything else
  if (hero.carryingPayloadId !== null) {
    const thief = adjacent.find((enemy) => enemy.kind === "daemon");
    if (thief) {
      const dir = dirTo(hero, thief) ?? "e";
      return { action: { type: "move", dir }, autoPath: null };
    }
  }
  const fighters = adjacent.filter((enemy) => enemy.kind !== "deadlock");
  if (fighters.length > 0) {
    const target = [...fighters].sort((a, b) => a.hp - b.hp || a.id - b.id)[0]!;
    const dir = dirTo(hero, target) ?? "e";
    return { action: { type: "move", dir }, autoPath: null };
  }
  // only deadlocks adjacent: the lock rule blocks every move, so it blocks any
  // plan that needs one — unless the current task resolves in place.
  if (canWorkInPlace(run)) return interactDecision();
  const target = [...adjacent].sort((a, b) => a.hp - b.hp || a.id - b.id)[0]!;
  const dir = dirTo(hero, target) ?? "e";
  return { action: { type: "move", dir }, autoPath: null };
};

// ---------------------------------------------------------------------------
// row 6: task selection
// ---------------------------------------------------------------------------

interface TaskCandidate {
  /** default priority: mine 0 > execute 1 > haul 2 */
  order: number;
  id: number;
  goals: Set<number>;
  distance: number;
  /** L2: credits-or-data per turn */
  score: number;
}

const chooseTask = (run: RunState, stats: HeroStats, ctx: PlanContext): AutoDecision | null => {
  const hero = run.hero;
  const level = stats.schedulerLevel;
  const width = run.floor.width;
  const passable = knownPassable(run, ctx, {
    hazards: false,
    deadlockZone: false,
    faults: false,
    leaks: false,
  });
  const distances = bfsDistances(run.floor, hero, passable);
  const distanceTo = (goals: Set<number>): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const goal of goals) {
      const direct = distances[goal]!;
      if (direct < best) best = direct;
    }
    return best;
  };
  const tasks: TaskCandidate[] = [];
  const carrying = hero.carryingPayloadId !== null;
  for (const site of run.sites) {
    if (site.resolved) continue;
    const siteIndex = toIndex(site.x, site.y, width);
    if (!isExplored(run, siteIndex)) continue;
    // hauling blocks channels: no mining while carrying (jobs still execute)
    if (site.kind === "dataNode" && carrying) continue;
    if (site.kind === "dataNode") {
      const goals = new Set<number>();
      for (const n of neighbors4(run.floor, site.x, site.y)) {
        const index = toIndex(n.x, n.y, width);
        if (isWalkableTile(run.floor.tiles[index] ?? null)) goals.add(index);
      }
      if (goals.size === 0) continue;
      const distance = distanceTo(goals);
      const turns = distance + site.remainingUnits + 1;
      tasks.push({
        order: 0,
        id: site.id,
        goals,
        distance,
        score: (effectiveNodeYield(site) * DATA_CREDIT_VALUE) / turns,
      });
    } else if (site.kind === "jobStation" && site.squattedBy === null) {
      const goals = new Set([siteIndex]);
      const distance = distanceTo(goals);
      // cache is bandwidth: jobs process at 1 + cacheLevel units per turn (§3)
      const workTurns = Math.ceil(site.remainingUnits / Math.max(1, 1 + stats.cacheLevel));
      tasks.push({
        order: 1,
        id: site.id,
        goals,
        distance,
        score: amountToSafeNumber(site.payoutCredits) / (distance + workTurns + 1),
      });
    }
  }
  if (hero.carryingPayloadId === null) {
    for (const payload of run.payloads) {
      const port = siteById(run, payload.portId);
      if (!port || port.resolved) continue;
      if (payload.heldBy === "floor") {
        const index = toIndex(payload.x, payload.y, width);
        if (!isExplored(run, index)) continue;
        const goals = new Set([index]);
        const distance = distanceTo(goals);
        const turns = distance + manhattan(payload, port) + 2;
        tasks.push({
          order: 2,
          id: payload.id,
          goals,
          distance,
          score: amountToSafeNumber(payload.payoutCredits) / turns,
        });
      } else if (typeof payload.heldBy === "number") {
        // a rogue daemon ran off with it: 20 turns to catch the thief (§4)
        const thief = run.enemies.find((enemy) => enemy.id === payload.heldBy && isEnemyActive(enemy));
        if (!thief || !isVisible(run, thief)) continue;
        const goals = new Set([toIndex(thief.x, thief.y, width)]);
        tasks.push({
          order: 2,
          id: payload.id,
          goals,
          distance: distanceTo(goals),
          score: (2 * amountToSafeNumber(payload.payoutCredits)) / (distanceTo(goals) + 1),
        });
      }
    }
  }
  if (tasks.length === 0) {
    // squatted stations: kill the zombie holding the resource
    for (const site of run.sites) {
      if (site.kind !== "jobStation" || site.resolved || site.squattedBy === null) continue;
      const squatter = run.enemies.find((enemy) => enemy.id === site.squattedBy);
      if (!squatter) continue;
      const goal = toIndex(squatter.x, squatter.y, width);
      const plan = routePlan(run, ctx, (index) => index === goal);
      const decision = planDecision(run, plan);
      if (decision) return decision;
    }
    return null;
  }
  const byPreference =
    level >= 2
      ? [...tasks].sort((a, b) => b.score - a.score || a.order - b.order || a.id - b.id)
      : [...tasks].sort((a, b) => a.distance - b.distance || a.order - b.order || a.id - b.id);
  const heroIndex = toIndex(hero.x, hero.y, width);
  for (const task of byPreference) {
    if (task.goals.has(heroIndex)) return interactDecision();
    const plan = routePlan(run, ctx, (index) => task.goals.has(index));
    const decision = planDecision(run, plan);
    if (decision) return decision;
  }
  // every remaining task is walled off: a deadlock latched on a gate blocks the
  // plan, so it earns an attack (row 2's exception). Walk up to the nearest one.
  for (const cell of [...ctx.deadlockCells].sort(
    (a, b) =>
      manhattan(pointOf(run, a), hero) - manhattan(pointOf(run, b), hero) || a - b,
  )) {
    const decision = planDecision(
      run,
      routePlan(run, ctx, (index) => index === cell),
    );
    if (decision) return decision;
  }
  return null;
};

// ---------------------------------------------------------------------------
// the scheduler
// ---------------------------------------------------------------------------

export const chooseAutoAction = (run: RunState, stats: HeroStats): AutoDecision => {
  const hero = run.hero;
  const level = stats.schedulerLevel;
  const width = run.floor.width;
  const enemies = activeEnemies(run);
  const quotaDone = run.quota.done >= run.quota.required;

  // Row 1 — survival items come before everything.
  if (level >= 1 && hero.throttled) {
    const slot = hero.items.indexOf("heatsink");
    if (slot >= 0) return { action: { type: "useItem", slot }, autoPath: null };
  }
  const patchFraction = level >= 2 ? PATCH_HP_FRACTION : EMERGENCY_PATCH_HP_FRACTION;
  if (hero.hp < hero.maxHp * patchFraction) {
    const slot = hero.items.indexOf("patch");
    if (slot >= 0) return { action: { type: "useItem", slot }, autoPath: null };
  }

  // Row 2 — adjacent faults (deadlocks only when they block, see chooseCombat).
  const adjacent = enemies.filter((enemy) => isAdjacent(enemy, hero));
  if (adjacent.length > 0) return chooseCombat(run, stats, adjacent);

  const ctx = buildPlanContext(run);

  // L3 — auto-overclock: heat is cold and a job is executing.
  if (level >= 3 && run.overclockTurns === 0 && hero.heat < THROTTLE_OFF_HEAT) {
    const site = siteById(run, hero.channelSiteId);
    if (site && site.kind === "jobStation" && !site.resolved && site.squattedBy === null) {
      return { action: { type: "overclock" }, autoPath: null };
    }
  }

  // committed path: follow to the end unless an urgent intercept invalidates it
  const urgent = level >= 2 && !quotaDone && hasBitFlipThreat(run);
  if (!urgent && run.autoPath && run.autoPath.length > 0) {
    const next = run.autoPath[0]!;
    const index = toIndex(next.x, next.y, width);
    if (
      isAdjacent(hero, next) &&
      isWalkableTile(run.floor.tiles[index] ?? null) &&
      !ctx.leakCells.has(index) &&
      !findEnemyAt(run, next.x, next.y)
    ) {
      const step = stepAlong(run, run.autoPath);
      if (step) return step;
    }
  }

  // Row 3 — continue an in-progress channel if no fault is within 2 cells.
  if (hero.channelSiteId !== null) {
    const site = siteById(run, hero.channelSiteId);
    if (site && !site.resolved && (site.kind !== "jobStation" || site.squattedBy === null)) {
      const inPosition =
        site.kind === "dataNode" ? isAdjacent(site, hero) : site.x === hero.x && site.y === hero.y;
      const clear = enemies.every((enemy) => chebyshev(enemy, hero) > CHANNEL_CLEAR_RADIUS);
      if (inPosition && clear) return interactDecision();
    }
  }

  // Row 4 — carrying: deliver by the shortest route (L1+ avoids fault-adjacent cells).
  if (hero.carryingPayloadId !== null) {
    const payload = run.payloads.find((candidate) => candidate.id === hero.carryingPayloadId);
    const port = payload ? siteById(run, payload.portId) : undefined;
    if (port && !port.resolved) {
      if ((hero.x === port.x && hero.y === port.y) || isAdjacent(hero, port)) {
        return interactDecision();
      }
      // delivery works from any adjacent cell too, so a leak on the port cell
      // itself cannot strand the haul
      const goals = new Set([toIndex(port.x, port.y, width)]);
      for (const n of neighbors4(run.floor, port.x, port.y)) {
        const index = toIndex(n.x, n.y, width);
        if (isWalkableTile(run.floor.tiles[index] ?? null) && !ctx.leakCells.has(index)) goals.add(index);
      }
      const decision = planDecision(run, routePlan(run, ctx, (index) => goals.has(index), level >= 1));
      if (decision) return decision;
    }
  }

  // Survival response: whatever hurt the hero this turn or last stays a target
  // even out of sight (a ranged daemon resetting channels forever is a stall).
  const recentAttackers = new Set<number>();
  for (const event of run.events) {
    if (event.kind === "heroHurt" && event.sourceId !== null && event.turn >= run.turn - 1) {
      recentAttackers.add(event.sourceId);
    }
  }
  if (recentAttackers.size > 0) {
    const attackers = enemies.filter(
      (enemy) => enemy.kind !== "deadlock" && (recentAttackers.has(enemy.id) || isVisible(run, enemy)),
    );
    const sorted = [...attackers].sort((a, b) => manhattan(a, hero) - manhattan(b, hero) || a.id - b.id);
    for (const enemy of sorted) {
      if (!recentAttackers.has(enemy.id)) continue;
      const goal = toIndex(enemy.x, enemy.y, width);
      const plan = routePlan(run, ctx, (index) => index === goal);
      if (plan && plan.kind === "step" && plan.path.length <= APPROACH_PATH_LIMIT) {
        const step = stepAlong(run, plan.path);
        if (step) return step;
      }
    }
  }

  // Row 5 — intercepts (L2+), while quota still needs work.
  if (level >= 2 && !quotaDone) {
    const nodesInProgress = run.sites.filter(nodeInProgress);
    const threats = enemies
      .filter(
        (enemy) =>
          (enemy.kind === "bitFlip" &&
            isVisible(run, enemy) &&
            nodesInProgress.some((site) => manhattan(enemy, site) <= BITFLIP_INTERCEPT_RANGE)) ||
          (enemy.kind === "forkBomb" &&
            isVisible(run, enemy) &&
            forkWindowTurns(enemy) >= FORK_INTERCEPT_TURN),
      )
      .sort((a, b) => manhattan(a, hero) - manhattan(b, hero) || a.id - b.id);
    for (const threat of threats) {
      const goal = toIndex(threat.x, threat.y, width);
      const decision = planDecision(run, routePlan(run, ctx, (index) => index === goal));
      if (decision) return decision;
    }
  }

  // Row 6 — start the next task (greedy until the quota is met).
  if (!quotaDone) {
    const decision = chooseTask(run, stats, ctx);
    if (decision) return decision;
  }

  // items on the way out are still worth grabbing (kept from v1)
  const hasRoom = hero.items.length < MAX_ITEM_SLOTS;
  const knownItems = run.items.filter(
    (item) =>
      isExplored(run, toIndex(item.x, item.y, width)) &&
      (hasRoom || !itemDefinitions[item.kind].usable),
  );
  if (knownItems.length > 0) {
    const goals = new Set(knownItems.map((item) => toIndex(item.x, item.y, width)));
    const decision = planDecision(run, routePlan(run, ctx, (index) => goals.has(index)));
    if (decision) return decision;
  }

  // Row 7 — GC leaks that pay (L1+); blocking leaks are handled inside routing.
  // Never while carrying: hauling blocks the GC channel.
  if (level >= 1 && !quotaDone && hero.carryingPayloadId === null && ctx.leakCells.size > 0) {
    const plan = routePlan(run, ctx, (index) => ctx.leakCells.has(index));
    if (plan && plan.kind === "gc") return interactDecision();
    if (plan && plan.kind === "step" && plan.path.length <= LEAK_GC_RADIUS) {
      const step = stepAlong(run, plan.path);
      if (step) return step;
    }
  }

  // Row 8 — explore the nearest frontier (post-quota only to find the gate).
  const stairsIndex = toIndex(run.floor.stairs.x, run.floor.stairs.y, width);
  if (!quotaDone || !isExplored(run, stairsIndex)) {
    const decision = planDecision(run, routePlan(run, ctx, (index) => isFrontier(run, index)));
    if (decision) return decision;
  }

  // Row 9 — flush: controller floors hunt the kernelPanic guarding the gate.
  if (run.floor.stairsLocked) {
    const boss = run.enemies.find((candidate) => candidate.kind === "kernelPanic" && isEnemyActive(candidate));
    if (boss) {
      const goal = toIndex(boss.x, boss.y, width);
      const decision = planDecision(run, routePlan(run, ctx, (index) => index === goal));
      if (decision) return decision;
    }
    if (!quotaDone) {
      // quota unmet with nothing actionable left: anti-stall guarantee wins
      return { action: { type: "forceDescend" }, autoPath: null };
    }
  }
  if (isHeroOnStairs(run) && !run.floor.stairsLocked) {
    return { action: { type: "descend" }, autoPath: null };
  }
  if (isExplored(run, stairsIndex)) {
    const decision = planDecision(run, routePlan(run, ctx, (index) => index === stairsIndex));
    if (decision) return decision;
  }

  // Row 10 — anti-stall: forceFlush, semantics unchanged.
  return { action: { type: "forceDescend" }, autoPath: null };
};
