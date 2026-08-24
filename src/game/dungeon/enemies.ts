import type { EnemyKind } from "../renderSnapshot";
import { nextRngFloat, type RngResult, type Xoshiro128State } from "../rng";
import type { Enemy, HeroStats, RunState } from "../types";
import { getBiomeEnemyWeight } from "./biomes";
import {
  buildOccupancy,
  drawFloat,
  drawInt,
  hurtHero,
  isCellFreeForEnemyFast,
  isEnemyActive,
  pushEvent,
  type Occupancy,
} from "./draft";
import {
  chebyshev,
  DIRS,
  DIR_VECTORS,
  dirsAway,
  dirsToward,
  facingToward,
  hasLineOfSight,
  isAdjacent,
  toIndex,
} from "./grid";
import type { Dir as DirType } from "../renderSnapshot";

export interface EnemyDefinition {
  kind: EnemyKind;
  name: string;
  baseHp: number;
  baseDamage: number;
  /** acts every other turn */
  slow: boolean;
  minDepth: number;
  weight: number;
}

export const enemyDefinitions: Record<EnemyKind, EnemyDefinition> = {
  bitFlip: { kind: "bitFlip", name: "Bit Flip", baseHp: 2, baseDamage: 1, slow: false, minDepth: 1, weight: 5 },
  nullPointer: { kind: "nullPointer", name: "Null Pointer", baseHp: 1, baseDamage: 1, slow: false, minDepth: 1, weight: 2 },
  memoryLeak: { kind: "memoryLeak", name: "Memory Leak", baseHp: 3, baseDamage: 1, slow: true, minDepth: 1, weight: 1 },
  deadlock: { kind: "deadlock", name: "Deadlock", baseHp: 4, baseDamage: 0, slow: false, minDepth: 2, weight: 1 },
  forkBomb: { kind: "forkBomb", name: "Fork Bomb", baseHp: 4, baseDamage: 1, slow: false, minDepth: 2, weight: 2 },
  daemon: { kind: "daemon", name: "Daemon", baseHp: 3, baseDamage: 1, slow: false, minDepth: 2, weight: 2 },
  zombieProcess: { kind: "zombieProcess", name: "Zombie Process", baseHp: 4, baseDamage: 1, slow: true, minDepth: 3, weight: 2 },
  // Boss: weight 0 keeps it out of the random pool; generate.ts places it on every 5th floor.
  kernelPanic: { kind: "kernelPanic", name: "Kernel Panic", baseHp: 20, baseDamage: 2, slow: true, minDepth: 5, weight: 0 },
};

/** Boss bounty: kill credits are multiplied by this on a kernelPanic kill. */
export const KERNEL_PANIC_BOUNTY_MULTIPLIER = 20;
/** bitFlips spawned when the boss first drops to half HP. */
export const KERNEL_PANIC_SPLIT_COUNT = 2;

export const ENEMY_AGGRO_RANGE = 8;
export const DAEMON_RANGE = 4;
export const NULL_POINTER_LUNGE_RANGE = 3;
export const ZOMBIE_REVIVE_TURNS = 3;
export const MAX_FORK_BOMBS = 8;

export const getEnemyMaxHp = (kind: EnemyKind, depth: number) =>
  Math.max(1, Math.round(enemyDefinitions[kind].baseHp * Math.pow(1.15, depth)));

export const getEnemyDamage = (kind: EnemyKind, depth: number) =>
  enemyDefinitions[kind].baseDamage + (enemyDefinitions[kind].baseDamage > 0 ? Math.floor(depth / 3) : 0);

export const createEnemy = (kind: EnemyKind, depth: number, id: number, x: number, y: number): Enemy => ({
  id,
  kind,
  x,
  y,
  hp: getEnemyMaxHp(kind, depth),
  maxHp: getEnemyMaxHp(kind, depth),
  facing: "l",
  alerted: false,
  dormantTurns: 0,
  revived: false,
  cooldown: 0,
  splitTriggered: false,
});

/** Weighted by depth gate and biome multipliers; zero-weight kinds (bosses) never roll. */
export const pickEnemyKind = (rng: Xoshiro128State, depth: number): RngResult<EnemyKind> => {
  const pool = Object.values(enemyDefinitions)
    .map((definition) => ({
      kind: definition.kind,
      weight: definition.minDepth <= depth ? getBiomeEnemyWeight(definition.kind, definition.weight, depth) : 0,
    }))
    .filter((candidate) => candidate.weight > 0);
  const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
  const next = nextRngFloat(rng);
  let roll = next.value * total;
  for (const candidate of pool) {
    roll -= candidate.weight;
    if (roll < 0) return { state: next.state, value: candidate.kind };
  }
  return { state: next.state, value: pool[pool.length - 1]!.kind };
};

const tryStep = (run: RunState, occupancy: Occupancy, enemy: Enemy, dirs: readonly DirType[]) => {
  for (const dir of dirs) {
    const nx = enemy.x + DIR_VECTORS[dir].x;
    const ny = enemy.y + DIR_VECTORS[dir].y;
    if (!isCellFreeForEnemyFast(run, occupancy, nx, ny)) continue;
    pushEvent(run, { kind: "enemyMoved", id: enemy.id, from: { x: enemy.x, y: enemy.y }, to: { x: nx, y: ny } });
    enemy.facing = facingToward(enemy, { x: nx, y: ny }, enemy.facing);
    occupancy[toIndex(enemy.x, enemy.y, run.floor.width)] = 0;
    enemy.x = nx;
    enemy.y = ny;
    occupancy[toIndex(nx, ny, run.floor.width)] = enemy.id + 1;
    return true;
  }
  return false;
};

const attackHero = (run: RunState, enemy: Enemy, cause: string) => {
  const damage = getEnemyDamage(enemy.kind, run.depth);
  enemy.facing = facingToward(enemy, run.hero, enemy.facing);
  if (enemy.kind === "memoryLeak") {
    run.hero.maxHp = Math.max(1, run.hero.maxHp - 1);
    run.hero.hp = Math.min(run.hero.hp, run.hero.maxHp);
  }
  hurtHero(run, damage, enemy.id, cause);
};

const randomStep = (run: RunState, occupancy: Occupancy, enemy: Enemy) => {
  const start = drawInt(run, 0, DIRS.length);
  const dirs: DirType[] = [];
  for (let offset = 0; offset < DIRS.length; offset += 1) dirs.push(DIRS[(start + offset) % DIRS.length]!);
  tryStep(run, occupancy, enemy, dirs);
};

const reviveZombie = (run: RunState, occupancy: Occupancy, enemy: Enemy) => {
  const cell = toIndex(enemy.x, enemy.y, run.floor.width);
  const occupied = occupancy[cell] !== 0 || (run.hero.x === enemy.x && run.hero.y === enemy.y);
  if (occupied) return; // wait for the cell to clear
  enemy.dormantTurns = 0;
  enemy.revived = true;
  enemy.hp = Math.max(1, Math.ceil(enemy.maxHp / 2));
  enemy.alerted = true;
  occupancy[cell] = enemy.id + 1;
  pushEvent(run, { kind: "enemySpawned", id: enemy.id, enemyKind: enemy.kind, x: enemy.x, y: enemy.y });
};

/** Build the occupancy grid for an enemy phase. */
export const beginEnemyPhase = (run: RunState): Occupancy => buildOccupancy(run);

/** One enemy action. Mutates the turn draft and keeps `occupancy` current. */
export const actEnemy = (run: RunState, _stats: HeroStats, enemy: Enemy, occupancy: Occupancy = buildOccupancy(run)) => {
  if (enemy.dormantTurns > 0) {
    enemy.dormantTurns -= 1;
    if (enemy.dormantTurns === 0) {
      enemy.dormantTurns = 1;
      reviveZombie(run, occupancy, enemy);
    }
    return;
  }
  if (!isEnemyActive(enemy)) return;
  const hero = run.hero;
  const distance = chebyshev(enemy, hero);
  if (!enemy.alerted && distance <= ENEMY_AGGRO_RANGE && run.floor.visible[toIndex(enemy.x, enemy.y, run.floor.width)]) {
    enemy.alerted = true;
  }
  const definition = enemyDefinitions[enemy.kind];
  if (definition.slow) {
    if (enemy.cooldown > 0) {
      enemy.cooldown -= 1;
      return;
    }
    enemy.cooldown = 1;
  }
  const adjacent = isAdjacent(enemy, hero);
  switch (enemy.kind) {
    case "deadlock":
      return;
    case "bitFlip":
    case "forkBomb":
    case "memoryLeak":
    case "zombieProcess":
    case "kernelPanic": {
      if (adjacent) attackHero(run, enemy, definition.name);
      else if (enemy.alerted) tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    case "nullPointer": {
      if (adjacent) {
        attackHero(run, enemy, definition.name);
        return;
      }
      const aligned = enemy.x === hero.x || enemy.y === hero.y;
      if (enemy.alerted && aligned && distance <= NULL_POINTER_LUNGE_RANGE && hasLineOfSight(run.floor, enemy, hero)) {
        for (let step = 0; step < 2 && !isAdjacent(enemy, hero); step += 1) {
          if (!tryStep(run, occupancy, enemy, dirsToward(enemy, hero).slice(0, 1))) break;
        }
        if (isAdjacent(enemy, hero)) attackHero(run, enemy, definition.name);
        return;
      }
      if (drawFloat(run) < 0.7) randomStep(run, occupancy, enemy);
      return;
    }
    case "daemon": {
      if (!enemy.alerted) return;
      if (distance <= 1) {
        // Keeps its distance about half the time; otherwise fires point-blank, so a
        // pursuing hero catches it instead of chasing forever.
        if (drawFloat(run) < 0.5 && tryStep(run, occupancy, enemy, dirsAway(enemy, hero))) return;
        attackHero(run, enemy, definition.name);
        return;
      }
      if (distance <= DAEMON_RANGE && hasLineOfSight(run.floor, enemy, hero)) {
        enemy.facing = facingToward(enemy, hero, enemy.facing);
        pushEvent(run, { kind: "projectile", from: { x: enemy.x, y: enemy.y }, to: { x: hero.x, y: hero.y } });
        hurtHero(run, getEnemyDamage(enemy.kind, run.depth), enemy.id, definition.name);
        return;
      }
      tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    default:
      return;
  }
};
