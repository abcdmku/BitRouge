import { amount } from "../amount";
import type { EnemyKind } from "../renderSnapshot";
import { nextRngFloat, type RngResult, type Xoshiro128State } from "../rng";
import type { Enemy, HeroStats, RunState, WorkSite } from "../types";
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
  manhattan,
  toIndex,
} from "./grid";
import { getTierEnemyWeight } from "./tiers";
import {
  applyBitFlipCorruption,
  DAEMON_STEAL_TURNS,
  FORK_BOMB_DUP_TURNS,
  isLeakAt,
  LEAK_ALLOC_TURNS,
  losePayload,
} from "./worksites";
import type { Dir as DirType } from "../renderSnapshot";

export { FORK_BOMB_DUP_TURNS };

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
  daemon: { kind: "daemon", name: "Rogue Daemon", baseHp: 3, baseDamage: 1, slow: false, minDepth: 2, weight: 2 },
  zombieProcess: { kind: "zombieProcess", name: "Zombie Process", baseHp: 4, baseDamage: 1, slow: true, minDepth: 3, weight: 2 },
  // Boss: weight 0 keeps it out of the random pool; generation places it on controller floors.
  kernelPanic: { kind: "kernelPanic", name: "Kernel Panic", baseHp: 20, baseDamage: 2, slow: true, minDepth: 3, weight: 0 },
};

/**
 * v2 death causes read as named failures ("the death screen names a real
 * failure mode"). Deadlock deals no damage; bitFlips ignore the hero unless no
 * node is left to corrupt.
 */
export const deathCauses: Record<EnemyKind, string> = {
  bitFlip: "Uncorrectable bit flip",
  nullPointer: "Segmentation fault",
  memoryLeak: "Out of memory",
  deadlock: "Deadlock",
  forkBomb: "Fork bomb cascade",
  daemon: "Rogue daemon",
  zombieProcess: "Defunct process",
  kernelPanic: "Kernel panic",
};

export const deathCauseFor = (kind: EnemyKind): string => deathCauses[kind];

/** Boss bounty: kill credits are multiplied by this on a kernelPanic kill. */
export const KERNEL_PANIC_BOUNTY_MULTIPLIER = 20;
/** bitFlips spawned when the boss first drops to half HP (cache/ram/disk tiers). */
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
  targetSiteId: null,
  stolenPayloadId: null,
  stealTimer: 0,
  workTimer: kind === "forkBomb" ? FORK_BOMB_DUP_TURNS : kind === "memoryLeak" ? LEAK_ALLOC_TURNS : 0,
  spawnX: x,
  spawnY: y,
});

/** Weighted by depth gate and per-tier fault-mix multipliers; zero weights never roll. */
export const pickEnemyKind = (rng: Xoshiro128State, depth: number): RngResult<EnemyKind> => {
  const pool = Object.values(enemyDefinitions)
    .map((definition) => ({
      kind: definition.kind,
      weight: definition.minDepth <= depth ? getTierEnemyWeight(definition.kind, definition.weight, depth) : 0,
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
    if (!isCellFreeForEnemyFast(run, occupancy, nx, ny) || isLeakAt(run, nx, ny)) continue;
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

const attackHero = (run: RunState, enemy: Enemy) => {
  const damage = getEnemyDamage(enemy.kind, run.depth);
  enemy.facing = facingToward(enemy, run.hero, enemy.facing);
  hurtHero(run, damage, enemy.id, deathCauseFor(enemy.kind));
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

// ---- v2 behaviors -----------------------------------------------------------

/** bitFlip target: nearest uncompleted data node, preferring ones in progress. */
const pickBitFlipTarget = (run: RunState, enemy: Enemy): WorkSite | null => {
  const nodes = run.sites.filter((site) => site.kind === "dataNode" && !site.resolved);
  if (nodes.length === 0) return null;
  const current = nodes.find((site) => site.id === enemy.targetSiteId);
  if (current) return current;
  const scored = [...nodes].sort((a, b) => {
    const aProgress = a.remainingUnits < a.totalUnits ? 0 : 1;
    const bProgress = b.remainingUnits < b.totalUnits ? 0 : 1;
    return aProgress - bProgress || manhattan(a, enemy) - manhattan(b, enemy) || a.id - b.id;
  });
  return scored[0] ?? null;
};

/** bitFlip reached its node: corrupt it and despawn (filtered after the phase). */
const bitFlipArrive = (run: RunState, stats: HeroStats, occupancy: Occupancy, enemy: Enemy, site: WorkSite) => {
  applyBitFlipCorruption(run, stats, site);
  occupancy[toIndex(enemy.x, enemy.y, run.floor.width)] = 0;
  enemy.hp = 0;
  pushEvent(run, { kind: "enemyDied", id: enemy.id, enemyKind: enemy.kind, x: enemy.x, y: enemy.y, credits: amount(0) });
};

/** memoryLeak allocation: every 8 turns, one adjacent free cell becomes a leak cell. */
const tickLeakAllocator = (run: RunState, occupancy: Occupancy, enemy: Enemy) => {
  enemy.workTimer -= 1;
  if (enemy.workTimer > 0) return;
  enemy.workTimer = LEAK_ALLOC_TURNS;
  const { width } = run.floor;
  const stairsIndex = toIndex(run.floor.stairs.x, run.floor.stairs.y, width);
  const candidates: number[] = [];
  for (const dir of DIRS) {
    const x = enemy.x + DIR_VECTORS[dir].x;
    const y = enemy.y + DIR_VECTORS[dir].y;
    if (!isCellFreeForEnemyFast(run, occupancy, x, y)) continue;
    const index = toIndex(x, y, width);
    if (index === stairsIndex || run.leaks.includes(index)) continue;
    candidates.push(index);
  }
  if (candidates.length === 0) return;
  const index = candidates[drawInt(run, 0, candidates.length)]!;
  run.leaks = [...run.leaks, index];
  pushEvent(run, { kind: "leakSpawned", index });
};

/** forkBomb duplication: splits every 12 turns unless a copy was damaged in that span. */
const tickForkBombTimer = (run: RunState, occupancy: Occupancy, enemy: Enemy) => {
  enemy.workTimer -= 1;
  if (enemy.workTimer > 0) return;
  for (const fork of run.enemies) {
    if (fork.kind === "forkBomb") fork.workTimer = FORK_BOMB_DUP_TURNS;
  }
  const forkCount = run.enemies.filter((candidate) => candidate.kind === "forkBomb").length;
  if (forkCount >= MAX_FORK_BOMBS) return;
  for (const dir of DIRS) {
    const x = enemy.x + DIR_VECTORS[dir].x;
    const y = enemy.y + DIR_VECTORS[dir].y;
    if (!isCellFreeForEnemyFast(run, occupancy, x, y) || isLeakAt(run, x, y)) continue;
    const child: Enemy = {
      ...enemy,
      id: run.nextEntityId,
      x,
      y,
      alerted: enemy.alerted,
      cooldown: 0,
      workTimer: FORK_BOMB_DUP_TURNS,
      stolenPayloadId: null,
      targetSiteId: null,
      spawnX: x,
      spawnY: y,
    };
    run.nextEntityId += 1;
    run.enemies.push(child);
    occupancy[toIndex(x, y, run.floor.width)] = child.id + 1;
    pushEvent(run, { kind: "enemySpawned", id: child.id, enemyKind: child.kind, x: child.x, y: child.y });
    return;
  }
};

/** zombieProcess: walk to the nearest job station and squat it. */
const zombieTargetStation = (run: RunState, enemy: Enemy): WorkSite | null => {
  const squattedByThis = run.sites.find((site) => site.squattedBy === enemy.id);
  if (squattedByThis) return squattedByThis;
  const stations = run.sites
    .filter((site) => site.kind === "jobStation" && !site.resolved && site.squattedBy === null)
    .sort((a, b) => manhattan(a, enemy) - manhattan(b, enemy) || a.id - b.id);
  return stations[0] ?? null;
};

/** One enemy action. Mutates the turn draft and keeps `occupancy` current. */
export const actEnemy = (run: RunState, stats: HeroStats, enemy: Enemy, occupancy: Occupancy = buildOccupancy(run)) => {
  if (enemy.hp <= 0 && enemy.dormantTurns === 0) return; // despawned this phase
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
  // v1 rule: alert when within range and inside the hero's FOV. Hauling
  // doubles the radius and skips the FOV gate (DMA Controller removes that).
  const hauling = hero.carryingPayloadId !== null && !stats.dmaController;
  if (!enemy.alerted) {
    if (distance <= ENEMY_AGGRO_RANGE && run.floor.visible[toIndex(enemy.x, enemy.y, run.floor.width)]) {
      enemy.alerted = true;
    } else if (hauling && distance <= ENEMY_AGGRO_RANGE * 2) {
      enemy.alerted = true;
    }
  }
  // ambient work timers tick regardless of the slow-cooldown gate
  if (enemy.kind === "memoryLeak") tickLeakAllocator(run, occupancy, enemy);
  if (enemy.kind === "forkBomb") tickForkBombTimer(run, occupancy, enemy);
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
      // gate latch: high HP, deals no damage, costs turns not blood
      return;
    case "bitFlip": {
      // cosmic-ray flip: ignores the hero and seeks the nearest data node
      const target = pickBitFlipTarget(run, enemy);
      if (target) {
        enemy.targetSiteId = target.id;
        if (enemy.x === target.x && enemy.y === target.y) {
          bitFlipArrive(run, stats, occupancy, enemy, target);
          return;
        }
        if (tryStep(run, occupancy, enemy, dirsToward(enemy, target))) {
          if (enemy.x === target.x && enemy.y === target.y) bitFlipArrive(run, stats, occupancy, enemy, target);
          return;
        }
        return; // body-blocked: intercept counterplay
      }
      // no nodes left: fall back to the v1 chaser so it is never inert
      enemy.targetSiteId = null;
      if (adjacent) attackHero(run, enemy);
      else if (enemy.alerted) tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    case "memoryLeak": {
      // stationary allocator: attacks when adjacent, never moves, no maxHp drain
      if (adjacent) attackHero(run, enemy);
      return;
    }
    case "forkBomb":
    case "kernelPanic": {
      if (adjacent) attackHero(run, enemy);
      else if (enemy.alerted) tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    case "zombieProcess": {
      const station = zombieTargetStation(run, enemy);
      if (station) {
        enemy.targetSiteId = station.id;
        if (enemy.x === station.x && enemy.y === station.y) {
          if (station.squattedBy !== enemy.id) {
            station.squattedBy = enemy.id;
            pushEvent(run, { kind: "siteSquatted", siteId: station.id, byId: enemy.id });
          }
          if (adjacent) attackHero(run, enemy);
          return; // squatting: holds the resource until it dies (twice)
        }
        if (adjacent) {
          attackHero(run, enemy);
          return;
        }
        tryStep(run, occupancy, enemy, dirsToward(enemy, station));
        return;
      }
      enemy.targetSiteId = null;
      if (adjacent) attackHero(run, enemy);
      else if (enemy.alerted) tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    case "nullPointer": {
      if (adjacent) {
        attackHero(run, enemy);
        return;
      }
      const aligned = enemy.x === hero.x || enemy.y === hero.y;
      if (enemy.alerted && aligned && distance <= NULL_POINTER_LUNGE_RANGE && hasLineOfSight(run.floor, enemy, hero)) {
        for (let step = 0; step < 2 && !isAdjacent(enemy, hero); step += 1) {
          if (!tryStep(run, occupancy, enemy, dirsToward(enemy, hero).slice(0, 1))) break;
        }
        if (isAdjacent(enemy, hero)) attackHero(run, enemy);
        return;
      }
      if (drawFloat(run) < 0.7) randomStep(run, occupancy, enemy);
      return;
    }
    case "daemon": {
      // carrying a stolen payload: flee toward spawn; 20 turns to catch it
      if (enemy.stolenPayloadId !== null) {
        const payload = run.payloads.find((candidate) => candidate.id === enemy.stolenPayloadId);
        if (!payload || payload.heldBy !== enemy.id) {
          enemy.stolenPayloadId = null;
          enemy.stealTimer = 0;
        } else {
          enemy.stealTimer -= 1;
          if (enemy.stealTimer <= 0) {
            enemy.stolenPayloadId = null;
            losePayload(run, payload);
            return;
          }
          tryStep(run, occupancy, enemy, dirsToward(enemy, { x: enemy.spawnX, y: enemy.spawnY }));
          return;
        }
      }
      if (!enemy.alerted) return;
      // adjacent to a hauling hero: snatch the payload and run
      if (adjacent && hero.carryingPayloadId !== null) {
        const payload = run.payloads.find((candidate) => candidate.id === hero.carryingPayloadId);
        if (payload) {
          payload.heldBy = enemy.id;
          payload.x = enemy.x;
          payload.y = enemy.y;
          hero.carryingPayloadId = null;
          enemy.stolenPayloadId = payload.id;
          enemy.stealTimer = DAEMON_STEAL_TURNS;
          pushEvent(run, { kind: "payloadStolen", id: payload.id, byId: enemy.id });
          tryStep(run, occupancy, enemy, dirsToward(enemy, { x: enemy.spawnX, y: enemy.spawnY }));
          return;
        }
      }
      if (distance <= 1) {
        // Keeps its distance about half the time; otherwise fires point-blank, so a
        // pursuing hero catches it instead of chasing forever.
        if (drawFloat(run) < 0.5 && tryStep(run, occupancy, enemy, dirsAway(enemy, hero))) return;
        attackHero(run, enemy);
        return;
      }
      if (distance <= DAEMON_RANGE && hasLineOfSight(run.floor, enemy, hero)) {
        enemy.facing = facingToward(enemy, hero, enemy.facing);
        pushEvent(run, { kind: "projectile", from: { x: enemy.x, y: enemy.y }, to: { x: hero.x, y: hero.y } });
        hurtHero(run, getEnemyDamage(enemy.kind, run.depth), enemy.id, deathCauseFor(enemy.kind));
        return;
      }
      tryStep(run, occupancy, enemy, dirsToward(enemy, hero));
      return;
    }
    default:
      return;
  }
};
