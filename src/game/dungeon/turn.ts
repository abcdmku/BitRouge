import { amountAdd, amountMultiply } from "../amount";
import { getKillCredits } from "../economy";
import {
  ATTACK_HEAT,
  getHeroAttack,
  getHeroPowerDraw,
  THROTTLE_OFF_HEAT,
  THROTTLE_ON_HEAT,
} from "../hero";
import { getTier } from "../renderSnapshot";
import type { Enemy, HeroAction, HeroStats, Point, RunState } from "../types";
import {
  cloneRunForTurn,
  findEnemyAt,
  heroIndex,
  isCellFreeForEnemy,
  isEnemyActive,
  pushEvent,
} from "./draft";
import {
  actEnemy,
  beginEnemyPhase,
  createEnemy,
  KERNEL_PANIC_BOUNTY_MULTIPLIER,
  KERNEL_PANIC_SPLIT_COUNT,
  MAX_FORK_BOMBS,
  ZOMBIE_REVIVE_TURNS,
} from "./enemies";
import { computeFov, revealExplored } from "./fov";
import { generateFloor } from "./generate";
import { DIR_VECTORS, facingForDir, isAdjacent, isWalkableAt, neighbors4, toIndex, toPoint } from "./grid";
import { findHazardAt, triggerHazard } from "./hazards";
import { pickUpItem, useItem } from "./items";
import {
  computeQuotaRequired,
  DAEMON_CARRY_BOUNTY_MULTIPLIER,
  FORK_BOMB_DUP_TURNS,
  isHeroOnVent,
  isLeakAt,
  OVERCLOCK_TURNS,
  OVERCLOCK_WATTS,
  breakChannelOnDamage,
  collectLeak,
  resolveInteract,
  updateGateLock,
  VENT_DISSIPATION,
  type GeneratedWork,
} from "./worksites";

export const GARBAGE_COLLECTOR_PERIOD = 4;

/** Recompute FOV from the hero's position and merge into explored. */
export const refreshVision = (run: RunState, stats: HeroStats) => {
  const fov = computeFov(run.floor, run.hero, stats.fovRadius);
  run.floor.visible = fov.visible;
  run.floor.explored = revealExplored(run.floor.explored, fov.marked);
};

/** prefetchDaemon (v2): reveals work sites and payloads instead of items. */
const revealSitesForPrefetch = (run: RunState, stats: HeroStats) => {
  if (!stats.activeDaemons.includes("prefetchDaemon")) return;
  const explored = run.floor.explored.slice();
  for (const site of run.sites) explored[toIndex(site.x, site.y, run.floor.width)] = true;
  for (const payload of run.payloads) {
    if (payload.heldBy === "floor") explored[toIndex(payload.x, payload.y, run.floor.width)] = true;
  }
  run.floor.explored = explored;
};

/** Replace the floor with a freshly generated one at `depth` and place the hero. Mutates the draft. */
export const enterFloor = (run: RunState, stats: HeroStats, depth: number) => {
  const generated = generateFloor(run.rng, depth, run.nextEntityId) as ReturnType<
    typeof generateFloor
  > &
    Partial<GeneratedWork>;
  run.rng = generated.rng;
  run.depth = depth;
  run.maxDepthReached = Math.max(run.maxDepthReached, depth);
  run.floor = generated.floor;
  run.enemies = generated.enemies;
  run.items = generated.items;
  run.nextEntityId = generated.nextEntityId;
  // v2 work state (workstream B's generator provides sites/payloads; an empty
  // floor degrades to quota 0 = open gate, matching v1 behavior)
  run.sites = generated.sites ?? [];
  run.payloads = generated.payloads ?? [];
  run.leaks = [];
  run.gcChannel = null;
  run.quota = { required: computeQuotaRequired(depth, run.sites, run.payloads), done: 0 };
  run.floor.stairsLocked = run.floor.stairsLocked || run.quota.required > 0;
  run.hero.x = generated.spawn.x;
  run.hero.y = generated.spawn.y;
  run.hero.maxHp = stats.maxHp;
  run.hero.hp = Math.min(run.hero.hp, run.hero.maxHp);
  run.hero.lockedTurns = 0;
  run.hero.retreatTurns = 0;
  run.hero.channelSiteId = null;
  run.hero.carryingPayloadId = null;
  run.hero.channelShield = false;
  run.pendingPath = null;
  run.autoPath = null;
  // turn 0 is the initial deploy, not a descent; the console/renderer skip it
  if (run.turn > 0) pushEvent(run, { kind: "descended", depth });
  refreshVision(run, stats);
  revealSitesForPrefetch(run, stats);
};

const findFreeNeighbor = (run: RunState, origin: Point): Point | null => {
  for (const cell of neighbors4(run.floor, origin.x, origin.y)) {
    if (isCellFreeForEnemy(run, cell.x, cell.y) && !isLeakAt(run, cell.x, cell.y)) return cell;
  }
  return null;
};

/** Nearest walkable, unoccupied cell to `origin` (spiral scan; origin first). */
const nearestFreeCell = (
  run: RunState,
  origin: Point,
  taken: Set<number>,
): Point => {
  const { width, height } = run.floor;
  for (let radius = 0; radius < Math.max(width, height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = origin.x + dx;
        const y = origin.y + dy;
        if (!isWalkableAt(run.floor, x, y)) continue;
        const index = toIndex(x, y, width);
        if (taken.has(index)) continue;
        taken.add(index);
        return { x, y };
      }
    }
  }
  return origin;
};

/**
 * kernel-tier kernelPanic: instead of shedding adds, the floor scrambles.
 * Walls re-carve with a fresh rng draw; the hero, faults, sites, payloads and
 * items re-place on the nearest walkable cell; quota/site progress preserved.
 */
const scrambleFloor = (run: RunState, stats: HeroStats) => {
  const generated = generateFloor(run.rng, run.depth, run.nextEntityId);
  run.rng = generated.rng;
  run.nextEntityId = generated.nextEntityId;
  run.floor = generated.floor;
  run.floor.stairsLocked = true; // the controller still lives; gate stays shut
  run.leaks = [];
  run.gcChannel = null;
  const taken = new Set<number>();
  const place = <T extends { x: number; y: number }>(entity: T) => {
    const cell = nearestFreeCell(run, entity, taken);
    entity.x = cell.x;
    entity.y = cell.y;
  };
  place(run.hero);
  for (const enemy of run.enemies) place(enemy);
  for (const site of run.sites) place(site);
  for (const payload of run.payloads) {
    if (payload.heldBy === "floor") place(payload);
  }
  for (const item of run.items) place(item);
  run.pendingPath = null;
  run.autoPath = null;
  pushEvent(run, { kind: "floorScrambled" });
  refreshVision(run, stats);
  revealSitesForPrefetch(run, stats);
};

const dropStolenPayload = (run: RunState, enemy: Enemy) => {
  if (enemy.stolenPayloadId === null) return;
  const payload = run.payloads.find((candidate) => candidate.id === enemy.stolenPayloadId);
  enemy.stolenPayloadId = null;
  enemy.stealTimer = 0;
  if (payload && payload.heldBy === enemy.id) {
    payload.heldBy = "floor";
    payload.x = enemy.x;
    payload.y = enemy.y;
  }
};

const clearSquat = (run: RunState, enemy: Enemy) => {
  for (const site of run.sites) {
    if (site.squattedBy === enemy.id) site.squattedBy = null;
  }
};

const killEnemy = (run: RunState, stats: HeroStats, enemy: Enemy) => {
  const base = getKillCredits(run.depth, stats.killCreditMultiplier);
  // bounties: a kernelPanic pays out like a small run; a payload thief pays 5x
  const credits =
    enemy.kind === "kernelPanic"
      ? amountMultiply(base, KERNEL_PANIC_BOUNTY_MULTIPLIER)
      : enemy.kind === "daemon" && enemy.stolenPayloadId !== null
        ? amountMultiply(base, DAEMON_CARRY_BOUNTY_MULTIPLIER)
        : base;
  dropStolenPayload(run, enemy);
  run.credits = amountAdd(run.credits, credits);
  run.kills += 1;
  pushEvent(run, { kind: "enemyDied", id: enemy.id, enemyKind: enemy.kind, x: enemy.x, y: enemy.y, credits });
  if (enemy.kind === "deadlock") run.deadlocksSurvived += 1;
  if (enemy.kind === "kernelPanic") {
    run.bossKills += 1;
    // guaranteed coreDump drop where the boss stood
    run.items.push({ id: run.nextEntityId, kind: "coreDump", x: enemy.x, y: enemy.y });
    run.nextEntityId += 1;
  }
  if (enemy.kind === "zombieProcess" && !enemy.revived && stats.zombiesRevive) {
    enemy.hp = 0;
    enemy.dormantTurns = ZOMBIE_REVIVE_TURNS;
    return;
  }
  clearSquat(run, enemy);
  run.enemies = run.enemies.filter((candidate) => candidate.id !== enemy.id);
  // controller death may open the bus gate (quota permitting)
  if (enemy.kind === "kernelPanic") updateGateLock(run);
};

const heroAttack = (run: RunState, stats: HeroStats, enemy: Enemy) => {
  const damage = getHeroAttack(run.hero, stats);
  run.hero.heat += ATTACK_HEAT;
  run.hero.facing = enemy.x > run.hero.x ? "r" : enemy.x < run.hero.x ? "l" : run.hero.facing;
  pushEvent(run, { kind: "heroAttacked", targetId: enemy.id, damage });
  enemy.hp = Math.max(0, enemy.hp - damage);
  pushEvent(run, { kind: "enemyHurt", id: enemy.id, damage, hp: enemy.hp });
  if (enemy.kind === "forkBomb") {
    // damaging any copy resets every copy's duplication window
    for (const fork of run.enemies) {
      if (fork.kind === "forkBomb") fork.workTimer = FORK_BOMB_DUP_TURNS;
    }
  }
  if (enemy.hp <= 0) {
    killEnemy(run, stats, enemy);
    return;
  }
  if (enemy.kind === "kernelPanic" && !enemy.splitTriggered && enemy.hp * 2 <= enemy.maxHp) {
    enemy.splitTriggered = true;
    if (getTier(run.depth) === "kernel") {
      // kernel tier: the panic scrambles the floor instead of shedding adds
      scrambleFloor(run, stats);
    } else {
      // cache/ram/disk: crossing half HP once sheds a pair of bitFlips
      for (let spawned = 0; spawned < KERNEL_PANIC_SPLIT_COUNT; spawned += 1) {
        const cell = findFreeNeighbor(run, enemy);
        if (!cell) break;
        const child = createEnemy("bitFlip", run.depth, run.nextEntityId, cell.x, cell.y);
        child.alerted = true;
        run.nextEntityId += 1;
        run.enemies.push(child);
        pushEvent(run, { kind: "enemySpawned", id: child.id, enemyKind: child.kind, x: child.x, y: child.y });
      }
    }
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
        workTimer: FORK_BOMB_DUP_TURNS,
        stolenPayloadId: null,
        targetSiteId: null,
        spawnX: cell.x,
        spawnY: cell.y,
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
    case "interact":
      resolveInteract(run, stats);
      return "acted";
    case "overclock": {
      if (run.overclockTurns === 0) {
        run.overclockTurns = OVERCLOCK_TURNS;
        pushEvent(run, { kind: "overclocked", on: true });
      }
      return "acted";
    }
    case "descend": {
      const onStairs = hero.x === run.floor.stairs.x && hero.y === run.floor.stairs.y;
      if (!onStairs) return "acted";
      if (run.floor.stairsLocked) {
        pushEvent(run, { kind: "stairsLocked" });
        return "acted";
      }
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
      if (hasAdjacentDeadlock(run) || !isWalkableAt(run.floor, tx, ty) || isLeakAt(run, tx, ty)) {
        return "acted";
      }
      const hadAdjacentEnemy = run.enemies.some((candidate) => isEnemyActive(candidate) && isAdjacent(candidate, hero));
      pushEvent(run, { kind: "heroMoved", from: { x: hero.x, y: hero.y }, to: { x: tx, y: ty } });
      hero.x = tx;
      hero.y = ty;
      hero.retreatTurns = hadAdjacentEnemy ? hero.retreatTurns + 1 : 0;
      // items can stack (a boss drop can land on a spawned item); take them all
      for (const item of run.items.filter((candidate) => candidate.x === tx && candidate.y === ty)) {
        pickUpItem(run, stats, item);
      }
      const hazard = findHazardAt(run.floor, toIndex(tx, ty, run.floor.width));
      if (hazard) triggerHazard(run, hazard);
      return "acted";
    }
    default:
      return "acted";
  }
};

const applyPowerBudget = (run: RunState, stats: HeroStats) => {
  const draw =
    getHeroPowerDraw(run.hero, stats) + (run.overclockTurns > 0 ? OVERCLOCK_WATTS : 0);
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

/**
 * v2 deadlock: the "adjacent = attack or wait only" pin stays, `lockedTurns`
 * keeps counting for the UI, but the 25% credit penalty and the 10-turn
 * auto-release are cut — a deadlock costs turns until killed or routed around.
 */
const applyDeadlockAdjacency = (run: RunState) => {
  if (!hasAdjacentDeadlock(run)) {
    run.hero.lockedTurns = 0;
    return;
  }
  run.hero.lockedTurns += 1;
};

/** GC daemon (v2): auto-collect one adjacent leak cell every 4 turns. */
const applyGarbageCollectorDaemon = (run: RunState, stats: HeroStats) => {
  if (!stats.activeDaemons.includes("garbageCollector")) return;
  if (run.turn % GARBAGE_COLLECTOR_PERIOD !== 0 || run.hero.hp <= 0) return;
  const { width } = run.floor;
  const adjacent = run.leaks
    .filter((index) => isAdjacent(toPoint(index, width), run.hero))
    .sort((a, b) => a - b);
  if (adjacent.length > 0) collectLeak(run, stats, adjacent[0]!);
};

const applyStatuses = (run: RunState, stats: HeroStats) => {
  const hero = run.hero;
  applyGarbageCollectorDaemon(run, stats);
  if (run.overclockTurns > 0) {
    hero.heat += 2;
    run.overclockTurns -= 1;
    if (run.overclockTurns === 0) pushEvent(run, { kind: "overclocked", on: false });
  }
  const dissipation = stats.heatDissipation + (isHeroOnVent(run) ? VENT_DISSIPATION : 0);
  hero.heat = Math.max(0, hero.heat - dissipation);
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
  // deaths read as named failures; dying while throttled is a thermal event
  const cause = hero.throttled ? "Thermal shutdown" : (run.deathCause ?? "Unknown fault");
  run.deathCause = cause;
  pushEvent(run, { kind: "heroDied", cause });
};

/** Carried payloads track their carrier (hero or thieving daemon). */
const syncPayloadPositions = (run: RunState) => {
  for (const payload of run.payloads) {
    if (payload.heldBy === "hero") {
      payload.x = run.hero.x;
      payload.y = run.hero.y;
    } else if (typeof payload.heldBy === "number") {
      const carrier = run.enemies.find((enemy) => enemy.id === payload.heldBy);
      if (carrier) {
        payload.x = carrier.x;
        payload.y = carrier.y;
      }
    }
  }
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
  const hpBeforeHeroPhase = run.hero.hp;
  const outcome = performHeroAction(run, stats, heroAction);
  if (outcome === "descended") {
    applyStatuses(run, stats);
    resolveDeath(run);
    return run;
  }
  const rounds = run.hero.throttled ? 2 : 1;
  const occupancy = beginEnemyPhase(run);
  for (let round = 0; round < rounds && run.hero.hp > 0; round += 1) {
    // snapshot the roster: spawns (forkBomb duplication) and despawns (bitFlip
    // arrival) during the phase act next turn / are skipped via hp checks
    const roster = [...run.enemies];
    for (const enemy of roster) {
      if (run.hero.hp <= 0) break;
      if (!run.enemies.includes(enemy)) continue;
      actEnemy(run, stats, enemy, occupancy);
    }
  }
  // bitFlips that reached their node despawn (hp 0, never dormant)
  if (run.enemies.some((enemy) => enemy.hp <= 0 && enemy.dormantTurns === 0)) {
    run.enemies = run.enemies.filter((enemy) => enemy.hp > 0 || enemy.dormantTurns > 0);
  }
  // any damage this turn interrupts work (node channels reset; jobs resume)
  if (run.hero.hp < hpBeforeHeroPhase || run.events.some((event) => event.turn === run.turn && event.kind === "heroHurt")) {
    breakChannelOnDamage(run);
  }
  applyDeadlockAdjacency(run);
  applyStatuses(run, stats);
  syncPayloadPositions(run);
  resolveDeath(run);
  refreshVision(run, stats);
  return run;
};

export const isHeroOnStairs = (run: RunState) =>
  run.hero.x === run.floor.stairs.x && run.hero.y === run.floor.stairs.y;

export const heroCellIndex = heroIndex;
