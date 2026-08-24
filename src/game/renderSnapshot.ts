/**
 * Renderer contract. `src/render` (Phaser) reads ONLY this shape and dispatches
 * ONLY `RenderCommand`s. The sim owns `deriveRenderSnapshot`; the renderer must
 * never import anything else from `src/game`.
 */
export type Dir = "n" | "s" | "e" | "w";
export type Facing = "l" | "r";

export const TileKind = {
  wall: 0,
  floor: 1,
  door: 2,
  stairsDown: 3,
} as const;
export type TileKindValue = (typeof TileKind)[keyof typeof TileKind];

export type HazardKind = "hotTile" | "overloadPlate" | "corruptedSector" | "brownout";

export type EnemyKind =
  | "bitFlip"
  | "nullPointer"
  | "memoryLeak"
  | "deadlock"
  | "forkBomb"
  | "daemon"
  | "zombieProcess"
  | "kernelPanic";

/** Depth band theme: floors 1-5 network, 6-10 storage, 11+ kernel. */
export type Biome = "network" | "storage" | "kernel";

export type ItemKind = "patch" | "hotfix" | "cacheLine" | "heatsink" | "checkpoint" | "coreDump";

export type EntityAnim = "idle" | "walk" | "attack" | "hurt" | "dead";

export interface RenderHero {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  heat: number;
  throttled: boolean;
  anim: EntityAnim;
}

export interface RenderEntity {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Facing;
  anim: EntityAnim;
}

export interface RenderItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
}

/** Events are appended with a monotonically increasing `seq`; the renderer keeps `lastSeq`. */
export type RunEvent =
  | { seq: number; turn: number; kind: "heroMoved"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "heroAttacked"; targetId: number; damage: number }
  | { seq: number; turn: number; kind: "heroHurt"; sourceId: number | null; damage: number; hp: number }
  | { seq: number; turn: number; kind: "heroDied"; cause: string }
  | { seq: number; turn: number; kind: "heroRevived" }
  | { seq: number; turn: number; kind: "enemyMoved"; id: number; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "enemyHurt"; id: number; damage: number; hp: number }
  | { seq: number; turn: number; kind: "enemyDied"; id: number; enemyKind: EnemyKind; x: number; y: number; credits: string }
  | { seq: number; turn: number; kind: "enemySpawned"; id: number; enemyKind: EnemyKind; x: number; y: number }
  | { seq: number; turn: number; kind: "projectile"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "itemPicked"; id: number; itemKind: ItemKind; x: number; y: number }
  | { seq: number; turn: number; kind: "itemUsed"; itemKind: ItemKind }
  | { seq: number; turn: number; kind: "hazardTriggered"; hazard: HazardKind; x: number; y: number }
  | { seq: number; turn: number; kind: "throttled"; on: boolean }
  | { seq: number; turn: number; kind: "tripped" }
  | { seq: number; turn: number; kind: "deadlockPenalty"; creditsLost: string }
  | { seq: number; turn: number; kind: "descended"; depth: number }
  | { seq: number; turn: number; kind: "controlChanged"; control: "auto" | "manual" }
  // Additive: kernelPanic boss floors (every 5th depth).
  | { seq: number; turn: number; kind: "stairsLocked" }
  | { seq: number; turn: number; kind: "stairsUnlocked" };

export interface RenderSnapshot {
  /** run seed; the scene rebuilds its tilemap when runId or depth changes */
  runId: number;
  depth: number;
  width: number;
  height: number;
  /** row-major, index = y * width + x */
  tiles: readonly TileKindValue[];
  explored: readonly boolean[];
  visible: readonly boolean[];
  hazards: readonly { index: number; kind: HazardKind }[];
  hero: RenderHero;
  entities: readonly RenderEntity[];
  items: readonly RenderItem[];
  control: "auto" | "manual";
  turn: number;
  msPerTurn: number;
  /** 0..1 fraction of the current auto-turn elapsed */
  turnProgress: number;
  /** ring buffer of the most recent events (≤ 64), ascending seq */
  events: readonly RunEvent[];
  /** additive: depth-band theme for palette/tint selection */
  biome: Biome;
  /** additive: boss floor gate — stairs refuse `descend` until the boss dies */
  stairsLocked: boolean;
}

/** Commands the renderer / input layer may dispatch. The sim's GameAction is a superset. */
export type RenderCommand =
  | { type: "takeControl" }
  | { type: "releaseControl" }
  | { type: "heroMove"; dir: Dir }
  | { type: "heroWait" }
  | { type: "useItem"; slot: number }
  | { type: "descend" }
  | { type: "heroPathTo"; x: number; y: number };

// ---------------------------------------------------------------------------
// Implementation (additive; the types above are the committed contract).
// ---------------------------------------------------------------------------
import type { GameState, RunState } from "./types";
import { getRunMsPerTurn } from "./advance";

const heroAnimFor = (run: RunState): EntityAnim => {
  if (run.status === "dead") return "dead";
  let anim: EntityAnim = "idle";
  for (const event of run.events) {
    if (event.turn !== run.turn) continue;
    switch (event.kind) {
      case "heroMoved":
        anim = "walk";
        break;
      case "heroAttacked":
        anim = "attack";
        break;
      case "heroHurt":
        anim = "hurt";
        break;
      case "heroDied":
        anim = "dead";
        break;
      case "heroRevived":
        anim = "idle";
        break;
      default:
        break;
    }
  }
  return anim;
};

const enemyAnimsFor = (run: RunState): Map<number, EntityAnim> => {
  const anims = new Map<number, EntityAnim>();
  for (const event of run.events) {
    if (event.turn !== run.turn) continue;
    switch (event.kind) {
      case "enemyMoved":
        anims.set(event.id, "walk");
        break;
      case "enemyHurt":
        anims.set(event.id, "hurt");
        break;
      case "enemyDied":
        anims.set(event.id, "dead");
        break;
      case "enemySpawned":
        anims.set(event.id, "idle");
        break;
      case "heroHurt":
        if (event.sourceId !== null) anims.set(event.sourceId, "attack");
        break;
      default:
        break;
    }
  }
  return anims;
};

export const deriveRenderSnapshot = (state: GameState): RenderSnapshot | null => {
  const run = state.run;
  if (!run) return null;
  const msPerTurn = getRunMsPerTurn(state, run);
  const enemyAnims = enemyAnimsFor(run);
  return {
    runId: run.seed,
    depth: run.depth,
    width: run.floor.width,
    height: run.floor.height,
    tiles: run.floor.tiles,
    explored: run.floor.explored,
    visible: run.floor.visible,
    hazards: run.floor.hazards,
    hero: {
      x: run.hero.x,
      y: run.hero.y,
      facing: run.hero.facing,
      hp: run.hero.hp,
      maxHp: run.hero.maxHp,
      heat: run.hero.heat,
      throttled: run.hero.throttled,
      anim: heroAnimFor(run),
    },
    entities: run.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      x: enemy.x,
      y: enemy.y,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      facing: enemy.facing,
      anim: enemy.dormantTurns > 0 ? "dead" : (enemyAnims.get(enemy.id) ?? "idle"),
    })),
    items: run.items.map((item) => ({ id: item.id, kind: item.kind, x: item.x, y: item.y })),
    control: run.control,
    turn: run.turn,
    msPerTurn,
    turnProgress: msPerTurn > 0 ? Math.min(1, Math.max(0, run.turnAccumulatorMs / msPerTurn)) : 0,
    events: run.events,
    biome: getBiome(run.depth),
    stairsLocked: run.floor.stairsLocked,
  };
};

/** Biome by depth band: 1-5 network, 6-10 storage, 11+ kernel. */
export const getBiome = (depth: number): Biome =>
  depth <= 5 ? "network" : depth <= 10 ? "storage" : "kernel";
