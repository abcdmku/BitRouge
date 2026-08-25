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
  /** gate (door): corridor/bank mouth */
  door: 2,
  /** bus gate (exit / flush); keeps value 3 with new art */
  stairsDown: 3,
  /** additive v2: vent tile, +3 heat dissipation while stood on */
  vent: 4,
} as const;
export type TileKindValue = (typeof TileKind)[keyof typeof TileKind];

export type HazardKind = "hotTile" | "overloadPlate" | "corruptedSector" | "brownout";

/** Memory tier by depth band: 1-3 cache, 4-7 ram, 8-11 disk, 12+ kernel. */
export type Tier = "cache" | "ram" | "disk" | "kernel";

/** v2 work-site kinds: data nodes (mine), job stations (execute), I/O ports (deliver). */
export type WorkSiteKind = "dataNode" | "jobStation" | "ioPort";

/** Who holds a payload: on the floor, the hero, a daemon (its enemy id), or lost. */
export type PayloadHolder = "floor" | "hero" | number | "lost";

export type EnemyKind =
  | "bitFlip"
  | "nullPointer"
  | "memoryLeak"
  | "deadlock"
  | "forkBomb"
  | "daemon"
  | "zombieProcess"
  | "kernelPanic";

/**
 * @deprecated v1 depth-band theme, replaced by `Tier`. Kept exported only so
 * v1 consumers (selectors/render) keep compiling until workstream C lands.
 */
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
  /** site id the hero is channeling/executing this turn, null when idle */
  channeling: number | null;
  /** payload id carried by the hero, null when not hauling */
  carrying: number | null;
}

/** Work site as the renderer sees it (progress rings, squat markers). */
export interface RenderSite {
  id: number;
  kind: WorkSiteKind;
  x: number;
  y: number;
  totalUnits: number;
  remainingUnits: number;
  yieldData: number;
  /** exact credit payout on completion (Amount string) */
  payoutCredits: string;
  /** bitFlip corruption hits absorbed so far */
  corrupted: number;
  /** enemy id squatting the site (zombieProcess), null when usable */
  squattedBy: number | null;
  resolved: boolean;
}

/** Payload as the renderer sees it; `heldBy` lets the sprite attach to a carrier. */
export interface RenderPayload {
  id: number;
  x: number;
  y: number;
  /** id of the ioPort site it must reach */
  portId: number;
  heldBy: PayloadHolder;
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
  // Additive: kernelPanic controller floors + the v2 quota gate. `stairsLocked`
  // and `stairsUnlocked` are reused verbatim for the quota-locked bus gate.
  | { seq: number; turn: number; kind: "stairsLocked" }
  | { seq: number; turn: number; kind: "stairsUnlocked" }
  // Additive v2: work sites, payload hauls, leaks, overclock, quota.
  | { seq: number; turn: number; kind: "siteChanneled"; siteId: number; remaining: number }
  | { seq: number; turn: number; kind: "siteCompleted"; siteId: number; siteKind: WorkSiteKind; credits: string; data: number }
  | { seq: number; turn: number; kind: "siteCorrupted"; siteId: number }
  | { seq: number; turn: number; kind: "siteSquatted"; siteId: number; byId: number }
  | { seq: number; turn: number; kind: "payloadTaken"; id: number }
  | { seq: number; turn: number; kind: "payloadStolen"; id: number; byId: number }
  | { seq: number; turn: number; kind: "payloadDelivered"; id: number; credits: string }
  | { seq: number; turn: number; kind: "payloadLost"; id: number }
  | { seq: number; turn: number; kind: "leakSpawned"; index: number }
  | { seq: number; turn: number; kind: "leakCollected"; index: number; credits: string }
  | { seq: number; turn: number; kind: "overclocked"; on: boolean }
  | { seq: number; turn: number; kind: "quotaProgress"; done: number; required: number }
  | { seq: number; turn: number; kind: "floorScrambled" };

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
  /**
   * Memory tier for palette/tint selection. BREAKING (approved): replaces the
   * v1 `biome` field.
   */
  tier: Tier;
  /** the bus gate refuses `descend` until the quota is met (and the controller dies) */
  stairsLocked: boolean;
  // ---- additive v2 fields ---------------------------------------------------
  sites: readonly RenderSite[];
  payloads: readonly RenderPayload[];
  /** leak cell indices (impassable until garbage-collected) */
  leaks: readonly number[];
  quota: { required: number; done: number };
  /** turns of overclock remaining (0 = off) */
  overclockTurns: number;
}

/** Commands the renderer / input layer may dispatch. The sim's GameAction is a superset. */
export type RenderCommand =
  | { type: "takeControl" }
  | { type: "releaseControl" }
  | { type: "heroMove"; dir: Dir }
  | { type: "heroWait" }
  | { type: "useItem"; slot: number }
  | { type: "descend" }
  | { type: "heroPathTo"; x: number; y: number }
  // BREAKING (approved) v2 additions:
  | { type: "interact" }
  | { type: "overclock" };

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
      channeling: run.hero.channelSiteId,
      carrying: run.hero.carryingPayloadId,
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
    tier: getTier(run.depth),
    stairsLocked: run.floor.stairsLocked,
    sites: run.sites.map((site) => ({
      id: site.id,
      kind: site.kind,
      x: site.x,
      y: site.y,
      totalUnits: site.totalUnits,
      remainingUnits: site.remainingUnits,
      yieldData: site.yieldData,
      payoutCredits: site.payoutCredits,
      corrupted: site.corrupted,
      squattedBy: site.squattedBy,
      resolved: site.resolved,
    })),
    payloads: run.payloads.map((payload) => ({
      id: payload.id,
      x: payload.x,
      y: payload.y,
      portId: payload.portId,
      heldBy: payload.heldBy,
    })),
    leaks: run.leaks,
    quota: { required: run.quota.required, done: run.quota.done },
    overclockTurns: run.overclockTurns,
  };
};

/** Memory tier by depth band: 1-3 cache, 4-7 ram, 8-11 disk, 12+ kernel. */
export const getTier = (depth: number): Tier =>
  depth <= 3 ? "cache" : depth <= 7 ? "ram" : depth <= 11 ? "disk" : "kernel";

/** @deprecated v1 depth-band theme; use `getTier`. Kept for v1 consumers only. */
export const getBiome = (depth: number): Biome =>
  depth <= 5 ? "network" : depth <= 10 ? "storage" : "kernel";
