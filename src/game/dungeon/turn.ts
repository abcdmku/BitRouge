import { amountAdd, amountMultiply, amountSubtract } from "../amount";
import { getKillCredits } from "../economy";
import {
  ATTACK_HEAT,
  DEADLOCK_LOCK_TURNS,
  getHeroAttack,
  getHeroPowerDraw,
  THROTTLE_OFF_HEAT,
  THROTTLE_ON_HEAT,
} from "../hero";
import type { Enemy, HeroAction, HeroStats, Point, RunState } from "../types";
import {
  cloneRunForTurn,
  findEnemyAt,
  findItemAt,
  heroIndex,
  isCellFreeForEnemy,
  isEnemyActive,
  pushEvent,
} from "./draft";
import { actEnemy, beginEnemyPhase, MAX_FORK_BOMBS, ZOMBIE_REVIVE_TURNS } from "./enemies";
import { computeFov, revealExplored } from "./fov";
import { generateFloor } from "./generate";
import { DIR_VECTORS, facingForDir, isAdjacent, isWalkableAt, neighbors4, toIndex } from "./grid";
import { findHazardAt, triggerHazard } from "./hazards";
import { pickUpItem, useItem } from "./items";

export const DEADLOCK_PENALTY_FRACTION = "0.25";
export const GARBAGE_COLLECTOR_PERIOD = 4;

/** Recompute FOV from the hero's position and merge into explored. */
export const refreshVision = (run: RunState, stats: HeroStats) => {
  const fov = computeFov(run.floor, run.hero, stats.fovRadius);
  run.floor.visible = fov.visible;
  run.floor.explored = revealExplored(run.floor.explored, fov.marked);
};

const revealItemsForPrefetch = (run: RunState, stats: HeroStats) => {
  if (!stats.activeDaemons.includes("prefetchDaemon")) return;
  const explored = run.floor.explored.slice();
  for (const item of run.items) explored[toIndex(item.x, item.y, run.floor.width)] = true;
  run.floor.explored = explored;
};

/** Replace the floor with a freshly generated one at `depth` and place the hero. Mutates the draft. */
export const enterFloor = (run: RunState, stats: HeroStats, depth: number) => {
  const generated = generateFloor(run.rng, depth, run.nextEntityId);
  run.rng = generated.rng;
  run.depth = depth;
  run.maxDepthReached = Math.max(run.maxDepthReached, depth);
  run.floor = generated.floor;
  run.enemies = generated.enemies;
  run.items = generated.items;
  run.nextEntityId = generated.nextEntityId;
  run.hero.x = generated.spawn.x;
  run.hero.y = generated.spawn.y;
  run.hero.maxHp = stats.maxHp;
  run.hero.hp = Math.min(run.hero.hp, run.hero.maxHp);
  run.hero.lockedTurns = 0;
  run.hero.retreatTurns = 0;
  run.pendingPath = null;
  run.autoPath = null;
  pushEvent(run, { kind: "descended", depth });
  refreshVision(run, stats);
  revealItemsForPrefetch(run, stats);
};

const findFreeNeighbor = (run: RunState, origin: Point): Point | null => {
  for (const cell of neighbors4(run.floor, origin.x, origin.y)) {
    if (isCellFreeForEnemy(run, cell.x, cell.y)) return cell;
  }
  return null;
};

const killEnemy = (run: RunState, stats: HeroStats, enemy: Enemy) => {
  const credits = getKillCredits(run.depth, stats.killCreditMultiplier);
  run.credits = amountAdd(run.credits, credits);
  run.kills += 1;
  pushEvent(run, { kind: "enemyDied", id: enemy.id, enemyKind: enemy.kind, x: enemy.x, y: enemy.y, credits });
  if (enemy.kind === "zombieProcess" && !enemy.revived && stats.zombiesRevive) {
    enemy.hp = 0;
    enemy.dormantTurns = ZOMBIE_REVIVE_TURNS;
    return;
  }
  run.enemies = run.enemies.filter((candidate) => candidate.id !== enemy.id);
};

const heroAttack = (run: RunState, stats: HeroStats, enemy: Enemy) => {
  const damage = getHeroAttack(run.hero, stats);
  run.hero.heat += ATTACK_HEAT;
  run.hero.facing = enemy.x > run.hero.x ? "r" : enemy.x < run.hero.x ? "l" : run.hero.facing;
  pushEvent(run, { kind: "heroAttacked", targetId: enemy.id, damage });
  enemy.hp = Math.max(0, enemy.hp - damage);
  pushEvent(run, { kind: "enemyHurt", id: enemy.id, damage, hp: enemy.hp });
  if (enemy.hp <= 0) {
    killEnemy(run, stats, enemy);
    return;
  }
  if (enemy.kind === "forkBomb" && enemy.hp > 1) {
    const forkCount = run.enemies.filter((candidate) => candidate.kind === "forkBomb").length;
    const cell = findFreeNeighbor(run, enemy);
    if (cell && forkCount < MAX_FORK_BOMBS) {
      const childHp = Math.floor(enemy.hp / 2);
      enemy.hp -= childHp;
      const child: Enemy = {
        ...enemy,
        id: run.nextEntityId,
        x: cell.x,
        y: cell.y,
        hp: childHp,
        alerted: true,
        cooldown: 0,
      };
      run.nextEntityId += 1;
      run.enemies.push(child);
      pushEvent(run, { kind: "enemySpawned", id: child.id, enemyKind: child.kind, x: child.x, y: child.y });
    }
  }
};

const hasAdjacentDeadlock = (run: RunState) =>
  run.enemies.some((enemy) => enemy.kind === "deadlock" && isEnemyActive(enemy) && isAdjacent(enemy, run.hero));

type HeroActionOutcome = "acted" | "descended";

const performHeroAction = (run: RunState, stats: HeroStats, action: HeroAction): HeroActionOutcome => {
  const hero = run.hero;
  switch (action.type) {
    case "wait":
      return "acted";
    case "useItem":
      useItem(run, action.slot);
      return "acted";
    case "descend": {
      const onStairs = hero.x === run.floor.stairs.x && hero.y === run.floor.stairs.y;
      if (!onStairs) return "acted";
      enterFloor(run, stats, run.depth + 1);
      return "descended";
    }
    case "forceDescend":
      enterFloor(run, stats, run.depth + 1);
      return "descended";
    case "move": {
      const vector = DIR_VECTORS[action.dir];
      const tx = hero.x + vector.x;
      const ty = hero.y + vector.y;
      hero.facing = facingForDir(action.dir, hero.facing);
      const enemy = findEnemyAt(run, tx, ty);
      if (enemy) {
        heroAttack(run, stats, enemy);
        return "acted";
      }
      if (hasAdjacentDeadlock(run) || !isWalkableAt(run.floor, tx, ty)) return "acted";
      const hadAdjacentEnemy = run.enemies.some((candidate) => isEnemyActive(candidate) && isAdjacent(candidate, hero));
      pushEvent(run, { kind: "heroMoved", from: { x: hero.x, y: hero.y }, to: { x: tx, y: ty } });
      hero.x = tx;
      hero.y = ty;
      hero.retreatTurns = hadAdjacentEnemy ? hero.retreatTurns + 1 : 0;
      const item = findItemAt(run, tx, ty);
      if (item) pickUpItem(run, stats, item);
      const hazard = findHazardAt(run.floor, toIndex(tx, ty, run.floor.width));
      if (hazard) triggerHazard(run, hazard);
      return "acted";
    }
    default:
      return "acted";
  }
};

const applyPowerBudget = (run: RunState, stats: HeroStats) => {
  const draw = getHeroPowerDraw(run.hero, stats);
  if (draw <= stats.powerBudget) {
    run.hero.powerDebt = 0;
    return;
  }
  run.hero.powerDebt += draw - stats.powerBudget;
  if (run.hero.powerDebt >= stats.powerBudget) {
    run.hero.powerDebt -= stats.powerBudget;
    run.hero.skipNextTurn = true;
    pushEvent(run, { kind: "tripped" });
  }
};

const applyDeadlockLock = (run: RunState) => {
  if (!hasAdjacentDeadlock(run)) {
    run.hero.lockedTurns = 0;
    return;
  }
  run.hero.lockedTurns += 1;
  if (run.hero.lockedTurns < DEADLOCK_LOCK_TURNS) return;
  const lost = amountMultiply(run.credits, DEADLOCK_PENALTY_FRACTION);
  run.credits = amountSubtract(run.credits, lost);
  pushEvent(run, { kind: "deadlockPenalty", creditsLost: lost });
  run.enemies = run.enemies.filter(
    (enemy) => !(enemy.kind === "deadlock" && isEnemyActive(enemy) && isAdjacent(enemy, run.hero)),
  );
  run.hero.lockedTurns = 0;
};

const applyStatuses = (run: RunState, stats: HeroStats) => {
  const hero = run.hero;
  if (
    stats.activeDaemons.includes("garbageCollector") &&
    run.turn % GARBAGE_COLLECTOR_PERIOD === 0 &&
    hero.hp > 0 &&
    hero.hp < hero.maxHp
  ) {
    hero.hp += 1;
  }
  hero.heat = Math.max(0, hero.heat - stats.heatDissipation);
  if (!hero.throttled && hero.heat >= THROTTLE_ON_HEAT) {
    hero.throttled = true;
    pushEvent(run, { kind: "throttled", on: true });
  } else if (hero.throttled && hero.heat <= THROTTLE_OFF_HEAT) {
    hero.throttled = false;
    pushEvent(run, { kind: "throttled", on: false });
  }
  hero.buffs = hero.buffs
    .map((buff) => ({ ...buff, turnsLeft: buff.turnsLeft - 1 }))
    .filter((buff) => buff.turnsLeft > 0);
};

const resolveDeath = (run: RunState) => {
  const hero = run.hero;
  if (hero.hp > 0) return;
  if (hero.checkpoint > 0) {
    hero.checkpoint -= 1;
    hero.hp = hero.maxHp;
    hero.heat = 0;
    hero.throttled = false;
    run.deathCause = null;
    pushEvent(run, { kind: "heroRevived" });
    return;
  }
  run.status = "dead";
  const cause = run.deathCause ?? "Unknown fault";
  run.deathCause = cause;
  pushEvent(run, { kind: "heroDied", cause });
};

/**
 * Resolve one turn: hero acts, each enemy acts (twice when throttled), hazards
 * and daemons tick, statuses update, vision refreshes. Pure: returns a new run.
 */
export const resolveTurn = (input: RunState, action: HeroAction, stats: HeroStats): RunState => {
  if (input.status !== "active") return input;
  const run = cloneRunForTurn(input);
  run.turn += 1;
  applyPowerBudget(run, stats);
  let heroAction = action;
  if (run.hero.skipNextTurn) {
    run.hero.skipNextTurn = false;
    heroAction = { type: "wait" };
  }
  const outcome = performHeroAction(run, stats, heroAction);
  if (outcome === "descended") {
    applyStatuses(run, stats);
    resolveDeath(run);
    return run;
  }
  const rounds = run.hero.throttled ? 2 : 1;
  const occupancy = beginEnemyPhase(run);
  for (let round = 0; round < rounds && run.hero.hp > 0; round += 1) {
    // enemies never spawn or die during their own phase, so the list is stable
    for (const enemy of run.enemies) {
      if (run.hero.hp <= 0) break;
      actEnemy(run, stats, enemy, occupancy);
    }
  }
  applyDeadlockLock(run);
  applyStatuses(run, stats);
  resolveDeath(run);
  refreshVision(run, stats);
  return run;
};

export const isHeroOnStairs = (run: RunState) =>
  run.hero.x === run.floor.stairs.x && run.hero.y === run.floor.stairs.y;

export const heroCellIndex = heroIndex;
